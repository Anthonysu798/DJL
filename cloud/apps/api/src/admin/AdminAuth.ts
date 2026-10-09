/**
 * Admin authentication: a separate population from users (decision: Admin).
 * Email + argon2id password, mandatory TOTP once enrolled, opaque session
 * tokens stored hashed, and an IP allowlist read from settings.
 */
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import * as OTPAuth from "otpauth";

import { hashIp, writeAudit } from "../audit/AuditLog.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { ApiError } from "../http/errors.ts";
import type { Lockouts } from "../security/throttle.ts";

export type AdminRole = "admin" | "employee";
export const ADMIN_ROLES: readonly AdminRole[] = ["admin", "employee"];

/** What the browser reports about itself at sign-in. Stored verbatim for forensics, never trusted for auth. */
export interface LoginClient {
  readonly timezone?: string | undefined;
  readonly locale?: string | undefined;
  readonly platform?: string | undefined;
  readonly screen?: string | undefined;
  readonly deviceId?: string | undefined;
}

export type LoginOutcome =
  | "success"
  | "bad_password"
  | "bad_totp"
  | "totp_required"
  | "locked_out"
  | "disabled"
  | "ip_blocked"
  | "ip_not_allowed"
  | "not_active"
  | "unknown_email";

const INVITE_TTL_MS = 24 * 3_600_000;
const PASSWORD_MIN = 14;
const PASSWORD_MAX = 128;

/** Password rules for admin accounts: long, not the email, no trivial repeats. */
export function checkPasswordPolicy(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local))
    return "The password must not contain your email address.";
  if (/^(.)\1+$/.test(password)) return "The password cannot be one repeated character.";
  return null;
}

const clientField = (v: unknown, max = 128) =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;

export interface AdminPrincipal {
  readonly adminId: string;
  readonly email: string;
  readonly role: AdminRole;
  readonly sessionId: string;
  readonly mfaVerified: boolean;
}

export const ADMIN_SESSION_COOKIE = "djl_admin";
const SESSION_TTL_MS = 8 * 3_600_000;
/** Five failures per email+IP (or per IP for invites) inside 15 minutes lock that key. */
export const ADMIN_LOCKOUT = { maxFailures: 5, windowSeconds: 15 * 60 } as const;

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

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;
/** Accepts a bare IPv4/IPv6 address or an IPv4 CIDR like 203.0.113.0/24. */
export function isIpOrCidr(entry: string): boolean {
  const [addr, bits] = entry.split("/");
  if (!addr) return false;
  if (bits !== undefined) {
    if (!/^\d{1,2}$/.test(bits) || Number(bits) > 32) return false;
    return IPV4.test(addr) && addr.split(".").every((o) => Number(o) <= 255);
  }
  if (IPV4.test(addr)) return addr.split(".").every((o) => Number(o) <= 255);
  return IPV6.test(addr) && addr.includes(":") && addr.length <= 45;
}

export function ipMatches(ip: string | null, list: readonly string[]): boolean {
  if (!ip) return false;
  return list.some((entry) => {
    if (!entry.includes("/")) return entry === ip;
    const [network, bitsRaw] = entry.split("/");
    const bits = Number(bitsRaw);
    if (!network || !/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(network))
      return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
  });
}

export function ipAllowed(ip: string | null, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true; // no list configured yet (local/staging)
  return ipMatches(ip, allowlist);
}

export interface AdminAuthOptions {
  /** Encrypts TOTP secrets. */
  readonly appSecret: string;
  /** Salts IP hashes in sessions and audit rows. */
  readonly ipSalt: string;
  /** Failed sign-in counters; Redis in the server so they hold across instances and restarts. */
  readonly lockouts: Lockouts;
  /**
   * Local development only: when false, sessions count as MFA-verified so
   * the admin app can be used without an authenticator. The env loader
   * refuses to turn this off outside local/test.
   */
  readonly mfaRequired?: boolean;
}

export class AdminAuth {
  private readonly appSecret: string;
  private readonly ipSalt: string;
  private readonly lockouts: Lockouts;
  private readonly mfaRequired: boolean;

  constructor(
    private readonly db: DjlDatabase,
    options: AdminAuthOptions,
  ) {
    this.appSecret = options.appSecret;
    this.ipSalt = options.ipSalt;
    this.lockouts = options.lockouts;
    this.mfaRequired = options.mfaRequired ?? true;
  }

  private async ipList(
    key: "admin.ip_allowlist" | "admin.ip_blocklist",
  ): Promise<readonly string[]> {
    const row = await this.db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
    return Array.isArray(row?.value)
      ? (row!.value as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
  }
  allowlist() {
    return this.ipList("admin.ip_allowlist");
  }
  blocklist() {
    return this.ipList("admin.ip_blocklist");
  }

  /** Blocklist wins over allowlist; both are read on every request so a ban takes effect at once. */
  async assertIpAllowed(ip: string | null): Promise<void> {
    if (ipMatches(ip, await this.blocklist()))
      throw new ApiError(403, "ip_blocked", "This network is blocked from the admin API.");
    if (!ipAllowed(ip, await this.allowlist()))
      throw new ApiError(
        403,
        "ip_not_allowed",
        "This network is not allowed to reach the admin API.",
      );
  }

  private liveAdminByEmail(email: string) {
    return this.db.query.admins.findFirst({
      where: and(eq(schema.admins.email, email), isNull(schema.admins.deletedAt)),
    });
  }

  private async recordLogin(input: {
    readonly adminId: string | null;
    readonly email: string;
    readonly outcome: LoginOutcome;
    readonly ip: string | null;
    readonly country: string | null;
    readonly userAgent: string | null;
    readonly client: LoginClient | undefined;
  }): Promise<void> {
    await this.db.insert(schema.adminLoginEvents).values({
      adminId: input.adminId,
      email: input.email,
      outcome: input.outcome,
      ip: input.ip,
      country: input.country,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      timezone: clientField(input.client?.timezone, 64),
      locale: clientField(input.client?.locale, 32),
      platform: clientField(input.client?.platform, 64),
      screen: clientField(input.client?.screen, 32),
      deviceId: clientField(input.client?.deviceId, 64),
    });
  }

  /** Create a ready-to-use admin. Only the bootstrap script and tests use this; the UI invites. */
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
        email: input.email.trim().toLowerCase(),
        name: input.name,
        role: input.role,
        passwordHash: await hashPassword(input.password),
        emailVerifiedAt: new Date(),
        invitedBy: input.invitedBy ?? null,
      })
      .returning({ id: schema.admins.id, email: schema.admins.email, role: schema.admins.role });
    return row!;
  }

  // ---- invites -------------------------------------------------------------

  /** Issue a fresh single-use invite token, killing any earlier one for the same admin. */
  async issueInvite(adminId: string, createdBy: string | null): Promise<string> {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.adminInvites)
        .set({ expiresAt: new Date() })
        .where(and(eq(schema.adminInvites.adminId, adminId), isNull(schema.adminInvites.usedAt)));
      await tx.insert(schema.adminInvites).values({
        adminId,
        tokenHash: await sha256(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        createdBy,
      });
    });
    return token;
  }

  /** Same error for missing, used, expired, or revoked: the caller learns nothing. */
  private async liveInvite(token: string, ip: string | null) {
    const key = `invite|${ip ?? ""}`;
    if (await this.lockouts.isLocked(key))
      throw new ApiError(429, "locked_out", "Too many attempts. Try again later.");
    const invalid = async () => {
      await this.lockouts.noteFailure(key);
      return new ApiError(400, "invalid_invite", "This invite link is not valid any more.");
    };
    if (typeof token !== "string" || token.length < 16 || token.length > 128) throw await invalid();
    const invite = await this.db.query.adminInvites.findFirst({
      where: and(
        eq(schema.adminInvites.tokenHash, await sha256(token)),
        isNull(schema.adminInvites.usedAt),
        gt(schema.adminInvites.expiresAt, new Date()),
      ),
    });
    if (!invite) throw await invalid();
    const admin = await this.db.query.admins.findFirst({
      where: and(eq(schema.admins.id, invite.adminId), isNull(schema.admins.deletedAt)),
    });
    if (!admin || admin.disabled || admin.passwordHash) throw await invalid();
    return { invite, admin };
  }

  async inspectInvite(token: string, ip: string | null) {
    const { admin } = await this.liveInvite(token, ip);
    return { email: admin.email, name: admin.name, role: admin.role };
  }

  async acceptInvite(input: {
    readonly token: string;
    readonly password: string;
    readonly ip: string | null;
    readonly country: string | null;
    readonly userAgent: string | null;
    readonly client?: LoginClient | undefined;
  }): Promise<{ readonly email: string }> {
    const { invite, admin } = await this.liveInvite(input.token, input.ip);
    const problem = checkPasswordPolicy(input.password, admin.email);
    if (problem) throw new ApiError(400, "weak_password", problem);
    const passwordHash = await hashPassword(input.password);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      // Claim the token first; a concurrent accept with the same token loses here.
      const claimed = await tx
        .update(schema.adminInvites)
        .set({ usedAt: now })
        .where(and(eq(schema.adminInvites.id, invite.id), isNull(schema.adminInvites.usedAt)))
        .returning({ id: schema.adminInvites.id });
      if (claimed.length === 0)
        throw new ApiError(400, "invalid_invite", "This invite link is not valid any more.");
      await tx
        .update(schema.admins)
        .set({ passwordHash, emailVerifiedAt: now })
        .where(and(eq(schema.admins.id, admin.id), isNull(schema.admins.passwordHash)));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: admin.id,
        action: "admin.invite.accepted",
        targetType: "admin",
        targetId: admin.id,
        ipHash: await hashIp(input.ip, this.ipSalt),
      });
    });
    await this.recordLogin({
      adminId: admin.id,
      email: admin.email,
      outcome: "success",
      ip: input.ip,
      country: input.country,
      userAgent: input.userAgent,
      client: input.client,
    });
    return { email: admin.email };
  }

  async login(input: {
    readonly email: string;
    readonly password: string;
    readonly totp?: string;
    readonly ip: string | null;
    readonly country?: string | null;
    readonly userAgent: string | null;
    readonly client?: LoginClient | undefined;
  }): Promise<{
    readonly token: string;
    readonly principal: AdminPrincipal;
    readonly expiresAt: Date;
  }> {
    const email = input.email.trim().toLowerCase();
    const admin = await this.liveAdminByEmail(email);
    const record = (outcome: LoginOutcome) =>
      this.recordLogin({
        adminId: admin?.id ?? null,
        email,
        outcome,
        ip: input.ip,
        country: input.country ?? null,
        userAgent: input.userAgent,
        client: input.client,
      });
    const refuse = async (outcome: LoginOutcome, error: ApiError) => {
      await record(outcome);
      throw error;
    };
    try {
      await this.assertIpAllowed(input.ip);
    } catch (e) {
      if (e instanceof ApiError)
        await refuse(e.code === "ip_blocked" ? "ip_blocked" : "ip_not_allowed", e);
      throw e;
    }
    const key = `${email}|${input.ip ?? ""}`;
    const badCredentials = new ApiError(401, "bad_credentials", "Email or password is wrong.");
    if (await this.lockouts.isLocked(key))
      await refuse(
        "locked_out",
        new ApiError(429, "locked_out", "Too many failed attempts. Try again later."),
      );
    if (!admin) {
      await this.lockouts.noteFailure(key);
      await refuse("unknown_email", badCredentials);
    }
    const live = admin!;
    if (live.disabled) await refuse("disabled", badCredentials);
    if (!live.passwordHash) await refuse("not_active", badCredentials);
    if (!(await verifyPassword({ hash: live.passwordHash!, password: input.password }))) {
      await this.lockouts.noteFailure(key);
      await refuse("bad_password", badCredentials);
    }
    let mfaVerified = false;
    if (live.totpEnabled) {
      if (!input.totp)
        await refuse(
          "totp_required",
          new ApiError(401, "totp_required", "Enter your authenticator code."),
        );
      if (!(await this.checkTotp(live.id, input.totp!))) {
        await this.lockouts.noteFailure(key);
        await refuse("bad_totp", new ApiError(401, "bad_totp", "Authenticator code is wrong."));
      }
      mfaVerified = true;
    }
    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const [session] = await this.db
      .insert(schema.adminSessions)
      .values({
        adminId: live.id,
        tokenHash: await sha256(token),
        ipHash: (await hashIp(input.ip, this.ipSalt)) ?? "",
        userAgent: input.userAgent,
        mfaVerifiedAt: mfaVerified ? new Date() : null,
        expiresAt,
      })
      .returning({ id: schema.adminSessions.id });
    await this.db
      .update(schema.admins)
      .set({ lastLoginAt: new Date(), lastLoginIp: input.ip })
      .where(eq(schema.admins.id, live.id));
    await record("success");
    await writeAudit(this.db, {
      actorType: "admin",
      actorId: live.id,
      action: "admin.login",
      targetType: "admin",
      targetId: live.id,
      ipHash: await hashIp(input.ip, this.ipSalt),
    });
    return {
      token,
      expiresAt,
      principal: {
        adminId: live.id,
        email: live.email,
        role: live.role,
        sessionId: session!.id,
        mfaVerified: mfaVerified || !this.mfaRequired,
      },
    };
  }

  /** Revoke every live session of an admin, optionally sparing one (the caller's own). */
  async revokeSessions(adminId: string, except?: string): Promise<void> {
    await this.db
      .update(schema.adminSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.adminSessions.adminId, adminId),
          isNull(schema.adminSessions.revokedAt),
          ...(except ? [ne(schema.adminSessions.id, except)] : []),
        ),
      );
  }

  /** Revoke every live session that was opened from the given IP (used when banning it). */
  async revokeSessionsFromIp(ip: string): Promise<void> {
    const ipHash = await hashIp(ip, this.ipSalt);
    if (!ipHash) return;
    await this.db
      .update(schema.adminSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.adminSessions.ipHash, ipHash), isNull(schema.adminSessions.revokedAt)));
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
    if (!admin || admin.disabled || admin.deletedAt)
      throw new ApiError(401, "unauthorized", "Admin account disabled.");
    return {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      sessionId: session.id,
      mfaVerified: Boolean(session.mfaVerifiedAt) || !this.mfaRequired,
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

/**
 * Admin runs everything. Employee is the support desk: users, credits within
 * a cap, limit resets, trial reviews, and read access to usage, stats, and
 * the audit log. Team, settings, prices, plans, and kill switches are admin only.
 */
export const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<string>> = {
  admin: new Set(["*"]),
  employee: new Set([
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
};

export function can(principal: AdminPrincipal, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[principal.role];
  return perms.has("*") || perms.has(permission);
}

export function requirePermission(principal: AdminPrincipal, permission: string): void {
  if (!can(principal, permission))
    throw new ApiError(403, "forbidden", `Your admin role cannot ${permission}.`);
}
