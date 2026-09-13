/**
 * Admin authentication: a separate population from users (decision: Admin).
 * Email + argon2id password, mandatory TOTP once enrolled, opaque session
 * tokens stored hashed, and an IP allowlist read from settings.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import * as OTPAuth from "otpauth";

import { hashIp, writeAudit } from "../audit/AuditLog.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { ApiError } from "../http/errors.ts";

export type AdminRole = "owner" | "support" | "finance" | "readonly";

export interface AdminPrincipal {
  readonly adminId: string;
  readonly email: string;
  readonly role: AdminRole;
  readonly sessionId: string;
  readonly mfaVerified: boolean;
}

export const ADMIN_SESSION_COOKIE = "djl_admin";
const SESSION_TTL_MS = 8 * 3_600_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_FAILURES = 5;

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** AES-GCM encryption of TOTP secrets with a key derived from the app secret. */
async function cipherKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`admin-totp:${secret}`),
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptSecret(plain: string, appSecret: string): Promise<string> {
  const key = await cipherKey(appSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `${Buffer.from(iv).toString("base64url")}.${Buffer.from(data).toString("base64url")}`;
}
export async function decryptSecret(encrypted: string, appSecret: string): Promise<string> {
  const [ivPart, dataPart] = encrypted.split(".");
  const key = await cipherKey(appSecret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(ivPart ?? "", "base64url") },
    key,
    Buffer.from(dataPart ?? "", "base64url"),
  );
  return new TextDecoder().decode(plain);
}

const ipv4ToInt = (addr: string) =>
  addr.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;

export function ipAllowed(ip: string | null, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true; // no list configured yet (local/staging)
  if (!ip) return false;
  return allowlist.some((entry) => {
    if (!entry.includes("/")) return entry === ip;
    const [network, bitsRaw] = entry.split("/");
    const bits = Number(bitsRaw);
    if (!network || !/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(network))
      return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
  });
}

export class AdminAuth {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly db: DjlDatabase,
    private readonly appSecret: string,
  ) {}

  async allowlist(): Promise<readonly string[]> {
    const row = await this.db.query.settings.findFirst({
      where: eq(schema.settings.key, "admin.ip_allowlist"),
    });
    return Array.isArray(row?.value) ? (row!.value as string[]) : [];
  }

  async assertIpAllowed(ip: string | null): Promise<void> {
    if (!ipAllowed(ip, await this.allowlist()))
      throw new ApiError(
        403,
        "ip_not_allowed",
        "This network is not allowed to reach the admin API.",
      );
  }

  private noteFailure(key: string): void {
    const now = Date.now();
    const arr = (this.failures.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    arr.push(now);
    this.failures.set(key, arr);
  }
  private lockedOut(key: string): boolean {
    const now = Date.now();
    return (
      (this.failures.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS).length >=
      LOGIN_MAX_FAILURES
    );
  }

  /** Create an admin. Only used by the bootstrap script and by owners inviting admins. */
  async create(input: {
    readonly email: string;
    readonly name: string;
    readonly role: AdminRole;
    readonly password: string;
    readonly invitedBy?: string | null;
  }) {
    const [row] = await this.db
      .insert(schema.admins)
      .values({
        email: input.email.toLowerCase(),
        name: input.name,
        role: input.role,
        passwordHash: await hashPassword(input.password),
        invitedBy: input.invitedBy ?? null,
      })
      .returning({ id: schema.admins.id, email: schema.admins.email, role: schema.admins.role });
    return row!;
  }

  async login(input: {
    readonly email: string;
    readonly password: string;
    readonly totp?: string;
    readonly ip: string | null;
    readonly userAgent: string | null;
  }): Promise<{
    readonly token: string;
    readonly principal: AdminPrincipal;
    readonly expiresAt: Date;
  }> {
    await this.assertIpAllowed(input.ip);
    const key = `${input.email.toLowerCase()}|${input.ip ?? ""}`;
    if (this.lockedOut(key))
      throw new ApiError(429, "locked_out", "Too many failed attempts. Try again later.");
    const admin = await this.db.query.admins.findFirst({
      where: eq(schema.admins.email, input.email.toLowerCase()),
    });
    const ok =
      admin &&
      !admin.disabled &&
      (await verifyPassword({ hash: admin.passwordHash, password: input.password }));
    if (!ok) {
      this.noteFailure(key);
      throw new ApiError(401, "bad_credentials", "Email or password is wrong.");
    }
    let mfaVerified = false;
    if (admin.totpEnabled) {
      if (!input.totp) throw new ApiError(401, "totp_required", "Enter your authenticator code.");
      if (!(await this.checkTotp(admin.id, input.totp))) {
        this.noteFailure(key);
        throw new ApiError(401, "bad_totp", "Authenticator code is wrong.");
      }
      mfaVerified = true;
    }
    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const [session] = await this.db
      .insert(schema.adminSessions)
      .values({
        adminId: admin.id,
        tokenHash: await sha256(token),
        ipHash: (await hashIp(input.ip, this.appSecret)) ?? "",
        userAgent: input.userAgent,
        mfaVerifiedAt: mfaVerified ? new Date() : null,
        expiresAt,
      })
      .returning({ id: schema.adminSessions.id });
    await this.db
      .update(schema.admins)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.admins.id, admin.id));
    await writeAudit(this.db, {
      actorType: "admin",
      actorId: admin.id,
      action: "admin.login",
      targetType: "admin",
      targetId: admin.id,
      ipHash: await hashIp(input.ip, this.appSecret),
    });
    return {
      token,
      expiresAt,
      principal: {
        adminId: admin.id,
        email: admin.email,
        role: admin.role,
        sessionId: session!.id,
        mfaVerified,
      },
    };
  }

  async resolve(token: string | null, ip: string | null): Promise<AdminPrincipal> {
    await this.assertIpAllowed(ip);
    if (!token) throw new ApiError(401, "unauthorized", "Admin sign-in required.");
    const session = await this.db.query.adminSessions.findFirst({
      where: and(
        eq(schema.adminSessions.tokenHash, await sha256(token)),
        isNull(schema.adminSessions.revokedAt),
        gt(schema.adminSessions.expiresAt, new Date()),
      ),
    });
    if (!session) throw new ApiError(401, "unauthorized", "Admin session expired.");
    const admin = await this.db.query.admins.findFirst({
      where: eq(schema.admins.id, session.adminId),
    });
    if (!admin || admin.disabled)
      throw new ApiError(401, "unauthorized", "Admin account disabled.");
    return {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      sessionId: session.id,
      mfaVerified: Boolean(session.mfaVerifiedAt),
    };
  }

  /** Every admin route except TOTP enrollment requires a verified second factor (decision: Admin). */
  requireMfa(principal: AdminPrincipal): void {
    if (!principal.mfaVerified)
      throw new ApiError(
        403,
        "mfa_required",
        "Enroll and verify an authenticator before using the admin API.",
      );
  }

  async logout(sessionId: string): Promise<void> {
    await this.db
      .update(schema.adminSessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.adminSessions.id, sessionId));
  }

  async beginTotpEnrollment(
    adminId: string,
    email: string,
  ): Promise<{ readonly secret: string; readonly uri: string }> {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: "DJL Admin",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });
    await this.db
      .update(schema.admins)
      .set({
        totpSecretEncrypted: await encryptSecret(secret.base32, this.appSecret),
        totpEnabled: false,
      })
      .where(eq(schema.admins.id, adminId));
    return { secret: secret.base32, uri: totp.toString() };
  }

  async confirmTotpEnrollment(adminId: string, sessionId: string, code: string): Promise<boolean> {
    if (!(await this.checkTotp(adminId, code))) return false;
    await this.db
      .update(schema.admins)
      .set({ totpEnabled: true })
      .where(eq(schema.admins.id, adminId));
    await this.db
      .update(schema.adminSessions)
      .set({ mfaVerifiedAt: new Date() })
      .where(eq(schema.adminSessions.id, sessionId));
    await writeAudit(this.db, {
      actorType: "admin",
      actorId: adminId,
      action: "admin.totp.enabled",
      targetType: "admin",
      targetId: adminId,
    });
    return true;
  }

  private async checkTotp(adminId: string, code: string): Promise<boolean> {
    const admin = await this.db.query.admins.findFirst({ where: eq(schema.admins.id, adminId) });
    if (!admin?.totpSecretEncrypted) return false;
    const base32 = await decryptSecret(admin.totpSecretEncrypted, this.appSecret);
    const totp = new OTPAuth.TOTP({
      issuer: "DJL Admin",
      label: admin.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(base32),
    });
    return totp.validate({ token: code.replace(/\s/g, ""), window: 1 }) !== null;
  }
}

export const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<string>> = {
  owner: new Set(["*"]),
  support: new Set([
    "users.read",
    "users.write",
    "users.suspend",
    "credits.grant",
    "limits.reset",
    "trials.review",
    "usage.read",
    "stats.read",
    "audit.read",
  ]),
  finance: new Set([
    "users.read",
    "ledger.read",
    "refunds.write",
    "stats.read",
    "audit.read",
    "usage.read",
  ]),
  readonly: new Set(["users.read", "stats.read", "usage.read", "audit.read"]),
};

export function can(principal: AdminPrincipal, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[principal.role];
  return perms.has("*") || perms.has(permission);
}

export function requirePermission(principal: AdminPrincipal, permission: string): void {
  if (!can(principal, permission))
    throw new ApiError(403, "forbidden", `Your admin role cannot ${permission}.`);
}
