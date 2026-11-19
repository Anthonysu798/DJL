import { createHash, randomBytes, randomUUID } from "node:crypto";
import { schema, type DjlDatabase } from "@djl/db";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type {
  CloudSocialAccountsResponse,
  CloudSocialOAuthStartInput,
  CloudSocialOAuthStatus,
} from "@synara/contracts/cloud";
import type { Principal } from "../auth/guard.ts";
import { isMember } from "../auth/guard.ts";
import { ApiError } from "../http/errors.ts";
import { socialCredentialCipher } from "./credentials.ts";
import { TikTokProvider } from "./providers/index.ts";
import type { SocialProvider, ProviderTokens } from "./providers/index.ts";

const accounts = schema.socialAccounts;
const attempts = schema.socialOAuthAttempts;
type Owner = Pick<Principal, "userId" | "orgId">;
const ownerKey = (p: Owner) => `${p.userId}:${p.orgId}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const missing = () => new ApiError(404, "social_not_found", "Social connection not found.");
const scope = (p: Owner) => and(eq(accounts.userId, p.userId), eq(accounts.orgId, p.orgId));

export class SocialConnectionService {
  private readonly cipher;
  constructor(
    private readonly db: DjlDatabase,
    private readonly providers: Partial<Record<"instagram" | "tiktok", SocialProvider>>,
    private readonly options: {
      encryptionKey?: string | undefined;
      publicUrl: string;
      enabled: boolean;
    },
  ) {
    this.cipher = socialCredentialCipher(options.encryptionKey);
  }
  private provider(id: "instagram" | "tiktok") {
    const provider = this.providers[id];
    if (!this.options.enabled || !this.cipher || !provider)
      throw new ApiError(503, "social_unavailable", "This connection is not configured.");
    return provider;
  }
  private redirectUri(id: string) {
    return `${this.options.publicUrl.replace(/\/$/, "")}/v1/social/oauth/${id}/callback`;
  }
  async list(p: Owner): Promise<CloudSocialAccountsResponse> {
    const rows = this.options.enabled ? await this.db.select().from(accounts).where(scope(p)) : [];
    return {
      providers: ["instagram", "tiktok", "xiaohongshu"].map((provider) => {
        const available =
          provider !== "xiaohongshu" &&
          this.options.enabled &&
          Boolean(this.cipher && this.providers[provider as "instagram" | "tiktok"]);
        return {
          provider: provider as "instagram" | "tiktok" | "xiaohongshu",
          available,
          reason: available
            ? null
            : provider === "xiaohongshu"
              ? "official_onboarding_unavailable"
              : "not_configured",
        };
      }),
      accounts: rows.map(
        ({
          id,
          provider,
          providerAccountId,
          username,
          displayName,
          scopes,
          capabilities,
          status,
          expiresAt,
        }) => ({
          id,
          provider,
          providerAccountId,
          username,
          displayName,
          scopes,
          capabilities,
          status,
          expiresAt: expiresAt.toISOString(),
        }),
      ),
    };
  }
  async start(p: Owner, input: CloudSocialOAuthStartInput) {
    const provider = this.provider(input.provider);
    if (input.accountId) {
      const [account] = await this.db
        .select()
        .from(accounts)
        .where(
          and(scope(p), eq(accounts.id, input.accountId), eq(accounts.provider, input.provider)),
        );
      if (!account) throw missing();
    }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const authorizationUrl = provider.authorizationUrl({
      state,
      redirectUri: this.redirectUri(input.provider),
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
    });
    await this.db.insert(attempts).values({
      id,
      ...p,
      provider: input.provider,
      threadId: input.threadId,
      campaignId: input.campaignId,
      revision: input.revision,
      reconnectAccountId: input.accountId ?? null,
      stateHash: hash(state),
      encryptedVerifier: this.cipher!.encrypt(verifier, `${ownerKey(p)}:${id}`),
      status: "pending",
      expiresAt,
    });
    return { attemptId: id, authorizationUrl, expiresAt: expiresAt.toISOString() };
  }
  private dto(row: typeof attempts.$inferSelect): CloudSocialOAuthStatus {
    return {
      attemptId: row.id,
      status:
        (row.status === "pending" || row.status === "processing") &&
        row.expiresAt.getTime() <= Date.now()
          ? "expired"
          : row.status,
      threadId: row.threadId,
      campaignId: row.campaignId,
      revision: row.revision,
      accountId: row.accountId,
      errorCode: row.errorCode,
    };
  }
  async status(p: Owner, id: string) {
    const [row] = await this.db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, p.userId), eq(attempts.orgId, p.orgId), eq(attempts.id, id)));
    if (!row) throw missing();
    return this.dto(row);
  }
  async listAttempts(p: Owner, threadId: string, campaignId: string) {
    const rows = await this.db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.userId, p.userId),
          eq(attempts.orgId, p.orgId),
          eq(attempts.threadId, threadId),
          eq(attempts.campaignId, campaignId),
        ),
      )
      .orderBy(desc(attempts.createdAt))
      .limit(50);
    return { attempts: rows.map((row) => this.dto(row)) };
  }
  /** Stage provider secrets before browser sign-in; redirects contain only an opaque handle. */
  async stageCallback(
    providerId: "instagram" | "tiktok",
    input: { state: string; code?: string; error?: string },
  ) {
    this.provider(providerId);
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.state) || (input.code?.length ?? 0) > 4096)
      throw missing();
    const continuation = randomBytes(32).toString("base64url");
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.stateHash, hash(input.state)),
            eq(attempts.provider, providerId),
            eq(attempts.status, "pending"),
            gt(attempts.expiresAt, new Date()),
          ),
        )
        .for("update");
      if (!row)
        throw new ApiError(
          409,
          "social_state_used_or_expired",
          "Authorization has expired or was already used.",
        );
      const verifier = this.cipher!.decrypt<unknown>(
        row.encryptedVerifier,
        `${ownerKey(row)}:${row.id}`,
      );
      if (typeof verifier !== "string")
        throw new ApiError(
          409,
          "social_state_used_or_expired",
          "Authorization has already continued.",
        );
      await tx
        .update(attempts)
        .set({
          stateHash: hash(continuation),
          encryptedVerifier: this.cipher!.encrypt(
            {
              verifier,
              callback: {
                ...(input.code ? { code: input.code } : {}),
                ...(input.error ? { error: "consent_denied" } : {}),
              },
            },
            `${ownerKey(row)}:${row.id}`,
          ),
        })
        .where(eq(attempts.id, row.id));
    });
    return { continuation };
  }
  async continueCallback(
    principal: Owner,
    providerId: "instagram" | "tiktok",
    continuation: string,
  ) {
    this.provider(providerId);
    if (!/^[A-Za-z0-9_-]{43}$/.test(continuation)) throw missing();
    const [row] = await this.db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.stateHash, hash(continuation)),
          eq(attempts.userId, principal.userId),
          eq(attempts.provider, providerId),
        ),
      );
    if (!row)
      throw new ApiError(
        409,
        "social_state_used_or_expired",
        "Sign in with the DJL account that started this connection, or restart authorization.",
      );
    if (!(await isMember(this.db, principal.userId, row.orgId)))
      throw new ApiError(
        403,
        "not_a_member",
        "You are no longer a member of the organization that started this connection.",
      );
    if (
      (row.status === "pending" || row.status === "processing") &&
      row.expiresAt.getTime() <= Date.now()
    )
      throw new ApiError(
        409,
        "social_state_used_or_expired",
        "Authorization has expired. Restart it from Agent Chat.",
      );
    if (row.status !== "pending") return { status: row.status, accountId: row.accountId };
    const staged = this.cipher!.decrypt<{
      verifier: string;
      callback: { code?: string; error?: string };
    }>(row.encryptedVerifier, `${ownerKey(row)}:${row.id}`);
    if (
      !staged ||
      typeof staged !== "object" ||
      typeof staged.verifier !== "string" ||
      !staged.callback
    )
      throw missing();
    try {
      return await this.callback(principal, providerId, {
        state: continuation,
        ...staged.callback,
      });
    } catch (error) {
      // Another authenticated remount may have won the atomic claim. Observe, never exchange twice.
      if (error instanceof ApiError && error.status === 409) {
        const [current] = await this.db
          .select()
          .from(attempts)
          .where(and(eq(attempts.id, row.id), eq(attempts.userId, principal.userId)));
        if (current && current.status !== "pending")
          return { status: current.status, accountId: current.accountId };
      }
      throw error;
    }
  }
  async callback(
    principal: Owner,
    providerId: "instagram" | "tiktok",
    input: { state: string; code?: string; error?: string },
  ) {
    const provider = this.provider(providerId);
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.state)) throw missing();
    // Resolve the original organization from server-held state, never a browser-supplied org.
    const [pending] = await this.db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.stateHash, hash(input.state)),
          eq(attempts.userId, principal.userId),
          eq(attempts.provider, providerId),
          eq(attempts.status, "pending"),
          gt(attempts.expiresAt, new Date()),
        ),
      );
    if (!pending)
      throw new ApiError(
        409,
        "social_state_used_or_expired",
        "Authorization has expired or was already used.",
      );
    if (!(await isMember(this.db, principal.userId, pending.orgId)))
      throw new ApiError(
        403,
        "not_a_member",
        "You are no longer a member of the organization that started this connection.",
      );
    // Atomic claim before the network call makes a state single-use across instances.
    const [row] = await this.db
      .update(attempts)
      .set({ status: "processing" })
      .where(
        and(
          eq(attempts.stateHash, hash(input.state)),
          eq(attempts.userId, principal.userId),
          eq(attempts.provider, providerId),
          eq(attempts.status, "pending"),
          gt(attempts.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!row)
      throw new ApiError(
        409,
        "social_state_used_or_expired",
        "Authorization has expired or was already used.",
      );
    const fail = async (status: "cancelled" | "failed", errorCode: string) => {
      await this.db
        .update(attempts)
        .set({ status, errorCode, encryptedVerifier: "" })
        .where(and(eq(attempts.id, row.id), eq(attempts.status, "processing")));
      return { status };
    };
    if (input.error) return fail("cancelled", "consent_denied");
    if (!input.code) return fail("failed", "missing_code");
    try {
      if (!(await isMember(this.db, row.userId, row.orgId)))
        return fail("failed", "membership_removed");
      const tokens = await provider.exchangeCode({
        code: input.code,
        redirectUri: this.redirectUri(providerId),
        codeVerifier: (() => {
          const value = this.cipher!.decrypt<string | { verifier: string }>(
            row.encryptedVerifier,
            `${ownerKey(row)}:${row.id}`,
          );
          return typeof value === "string" ? value : value.verifier;
        })(),
      });
      const profile = await provider.account(tokens);
      const accountId = await this.db.transaction(async (tx) => {
        const [active] = await tx
          .select()
          .from(attempts)
          .where(and(eq(attempts.id, row.id), eq(attempts.status, "processing")))
          .for("update");
        if (!active) throw new Error("Authorization cancelled");
        if (row.reconnectAccountId) {
          const [old] = await tx
            .select()
            .from(accounts)
            .where(and(scope(row), eq(accounts.id, row.reconnectAccountId)));
          if (!old || old.providerAccountId !== profile.id) throw new Error("Account mismatch");
        }
        const [account] = await tx
          .insert(accounts)
          .values({
            userId: row.userId,
            orgId: row.orgId,
            provider: providerId,
            providerAccountId: profile.id,
            username: profile.username,
            displayName: profile.displayName,
            scopes: profile.scopes,
            capabilities: profile.capabilities,
            status: "connected",
            encryptedTokens: this.cipher!.encrypt(
              tokens,
              `${ownerKey(row)}:${providerId}:${profile.id}`,
            ),
            expiresAt: new Date(tokens.expiresAt),
          })
          .onConflictDoUpdate({
            target: [
              accounts.userId,
              accounts.orgId,
              accounts.provider,
              accounts.providerAccountId,
            ],
            set: {
              username: profile.username,
              displayName: profile.displayName,
              scopes: profile.scopes,
              capabilities: profile.capabilities,
              status: "connected",
              encryptedTokens: this.cipher!.encrypt(
                tokens,
                `${ownerKey(row)}:${providerId}:${profile.id}`,
              ),
              expiresAt: new Date(tokens.expiresAt),
              updatedAt: new Date(),
            },
          })
          .returning({ id: accounts.id });
        await tx
          .update(attempts)
          .set({ status: "connected", accountId: account!.id, encryptedVerifier: "" })
          .where(eq(attempts.id, row.id));
        return account!.id;
      });
      return { status: "connected", accountId };
    } catch {
      // Never log provider errors or responses: they can contain credentials.
      return fail("failed", "authorization_failed");
    }
  }
  async withAccountCredentials<T>(
    p: Owner,
    id: string,
    fn: (account: {
      provider: SocialProvider;
      tokens: ProviderTokens;
      providerAccountId: string;
    }) => Promise<T>,
  ): Promise<T> {
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(accounts)
        .where(and(scope(p), eq(accounts.id, id), eq(accounts.status, "connected")))
        .for("update");
      if (!row || !row.encryptedTokens) throw missing();
      const provider = this.provider(row.provider);
      const aad = `${ownerKey(row)}:${row.provider}:${row.providerAccountId}`;
      let tokens = this.cipher!.decrypt<ProviderTokens>(row.encryptedTokens, aad);
      if (Date.parse(tokens.expiresAt) <= Date.now() + 60_000) {
        tokens = await provider.refresh(tokens);
        await tx
          .update(accounts)
          .set({
            encryptedTokens: this.cipher!.encrypt(tokens, aad),
            expiresAt: new Date(tokens.expiresAt),
            scopes: tokens.scope,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, id));
      }
      try {
        return {
          ok: true as const,
          value: await fn({ provider, tokens, providerAccountId: row.providerAccountId }),
        };
      } catch (error) {
        return { ok: false as const, error };
      }
    });
    if (!result.ok) throw result.error;
    return result.value;
  }
  async creatorInfo(p: Owner, accountId: string) {
    return this.withAccountCredentials(p, accountId, async ({ provider, tokens }) => {
      if (!(provider instanceof TikTokProvider))
        throw new ApiError(
          400,
          "creator_info_unavailable",
          "Creator privacy settings are available for TikTok accounts only.",
        );
      const { creatorNickname, creatorUsername, ...info } = await provider.creatorInfo(tokens);
      return { ...info, nickname: creatorNickname, username: creatorUsername };
    });
  }
  async disconnect(p: Owner, accountId: string) {
    // Erase locally first. Provider revoke failure must not retain usable credentials.
    const [row] = await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(accounts)
        .where(and(scope(p), eq(accounts.id, accountId)))
        .for("update");
      if (!rows[0]) throw missing();
      await tx
        .update(accounts)
        .set({ status: "disconnected", encryptedTokens: null, updatedAt: new Date() })
        .where(and(scope(p), eq(accounts.id, accountId)));
      await tx
        .update(attempts)
        .set({ status: "cancelled", errorCode: "account_disconnected", encryptedVerifier: "" })
        .where(
          and(
            eq(attempts.userId, p.userId),
            eq(attempts.orgId, p.orgId),
            eq(attempts.reconnectAccountId, accountId),
            inArray(attempts.status, ["pending", "processing"]),
          ),
        );
      return rows;
    });
    let revoked = false;
    if (row?.encryptedTokens && this.cipher) {
      try {
        await this.provider(row.provider).revoke(
          this.cipher.decrypt<ProviderTokens>(
            row.encryptedTokens,
            `${ownerKey(row)}:${row.provider}:${row.providerAccountId}`,
          ),
        );
        revoked = true;
      } catch {
        /* Disconnect remains effective locally. */
      }
    }
    return { disconnected: true, providerRevoked: revoked };
  }
}
