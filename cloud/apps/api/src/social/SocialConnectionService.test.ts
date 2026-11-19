import { afterAll, describe, expect, it, vi } from "vitest";
import { schema } from "@djl/db";
import { eq } from "drizzle-orm";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { SocialConnectionService } from "./SocialConnectionService.ts";
import { TikTokProvider } from "./providers/index.ts";
import { socialCredentialCipher } from "./credentials.ts";
import type { SocialProvider } from "./providers/index.ts";

const { db, close } = testDatabase();
afterAll(close);
const exchangeCode = vi.fn(async () => ({
  accessToken: "secret-access",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  scope: ["publish"],
}));
const provider: SocialProvider = {
  id: "instagram",
  authorizationUrl: ({ state }) => `https://example.invalid/authorize?state=${state}`,
  exchangeCode,
  refresh: async (tokens) => tokens,
  revoke: async () => {},
  account: async () => ({
    id: "provider-user",
    username: "tester",
    displayName: "Test",
    scopes: ["publish"],
    capabilities: { publish: true, metrics: false },
  }),
};
const service = new SocialConnectionService(
  db,
  { instagram: provider },
  { enabled: true, encryptionKey: "ab".repeat(32), publicUrl: "https://api.example.invalid" },
);
const input = {
  provider: "instagram" as const,
  threadId: "thread",
  campaignId: "campaign",
  revision: 2,
};
const state = (url: string) => new URL(url).searchParams.get("state")!;

describe("persisted social authorization", () => {
  it("claims state once under concurrent callbacks and persists bound context without credentials", async () => {
    const p = await seedOrg(db, "social-concurrent");
    const start = await service.start(p, input);
    const foreign = await seedOrg(db, "social-callback-foreign");
    await expect(
      service.callback(foreign, "instagram", {
        state: state(start.authorizationUrl),
        code: "code",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const before = exchangeCode.mock.calls.length;
    const results = await Promise.allSettled([
      service.callback(p, "instagram", { state: state(start.authorizationUrl), code: "code" }),
      service.callback(p, "instagram", { state: state(start.authorizationUrl), code: "code" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(exchangeCode.mock.calls.length - before).toBe(1);
    const status = await service.status(p, start.attemptId);
    expect(status).toMatchObject({
      status: "connected",
      threadId: "thread",
      campaignId: "campaign",
      revision: 2,
    });
    expect(JSON.stringify(await service.list(p))).not.toContain("secret-access");
    const [stored] = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, status.accountId!));
    expect(stored!.encryptedTokens).not.toContain("secret-access");
  });
  it("isolates status, reconnect, credentials and disconnect by both user and org", async () => {
    const p = await seedOrg(db, "social-owner");
    const other = await seedOrg(db, "social-other");
    const start = await service.start(p, input);
    await service.callback(p, "instagram", { state: state(start.authorizationUrl), code: "code" });
    const status = await service.status(p, start.attemptId);
    for (const foreign of [
      { ...p, userId: other.userId },
      { ...p, orgId: other.orgId },
    ]) {
      await expect(service.status(foreign, start.attemptId)).rejects.toMatchObject({ status: 404 });
      await expect(
        service.start(foreign, { ...input, accountId: status.accountId! }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.withAccountCredentials(foreign, status.accountId!, async () => undefined),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.disconnect(foreign, status.accountId!)).rejects.toMatchObject({
        status: 404,
      });
      expect((await service.list(foreign)).accounts).toHaveLength(0);
    }
    await service.disconnect(p, status.accountId!);
    await expect(
      service.withAccountCredentials(p, status.accountId!, async () => undefined),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("records cancellation and rejects expiry without token exchange", async () => {
    const p = await seedOrg(db, "social-cancel");
    const cancelled = await service.start(p, input);
    await service.callback(p, "instagram", {
      state: state(cancelled.authorizationUrl),
      error: "access_denied",
    });
    expect((await service.status(p, cancelled.attemptId)).status).toBe("cancelled");
    const expired = await service.start(p, input);
    await db
      .update(schema.socialOAuthAttempts)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.socialOAuthAttempts.id, expired.attemptId));
    await expect(
      service.callback(p, "instagram", { state: state(expired.authorizationUrl), code: "code" }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.status(p, expired.attemptId)).status).toBe("expired");
  });
  it("rejects reconnect to a different provider account and removes credentials on disconnect", async () => {
    const p = await seedOrg(db, "social-reconnect");
    const start = await service.start(p, input);
    await service.callback(p, "instagram", { state: state(start.authorizationUrl), code: "code" });
    const original = await service.status(p, start.attemptId);
    const changed = new SocialConnectionService(
      db,
      {
        instagram: {
          ...provider,
          account: async () => ({
            ...(await provider.account({ accessToken: "", scope: [], expiresAt: "" })),
            id: "different-account",
          }),
        },
      },
      { enabled: true, encryptionKey: "ab".repeat(32), publicUrl: "https://api.example.invalid" },
    );
    const reconnect = await changed.start(p, { ...input, accountId: original.accountId! });
    expect(
      await changed.callback(p, "instagram", {
        state: state(reconnect.authorizationUrl),
        code: "code",
      }),
    ).toEqual({ status: "failed" });
    expect((await service.list(p)).accounts).toHaveLength(1);
    await service.disconnect(p, original.accountId!);
    const [row] = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, original.accountId!));
    expect(row!.encryptedTokens).toBeNull();
  });
  it("fails closed while disabled without querying a missing schema", async () => {
    const disabled = new SocialConnectionService(
      db,
      {},
      { enabled: false, publicUrl: "https://api.example.invalid" },
    );
    const p = { userId: "unused", orgId: "unused" };
    expect((await disabled.list(p)).providers.every((item) => !item.available)).toBe(true);
    await expect(disabled.start(p, input)).rejects.toMatchObject({ status: 503 });
  });
  it("only exposes creator privacy settings to the owning user and organization", async () => {
    const p = await seedOrg(db, "creator-owner");
    const other = await seedOrg(db, "creator-other");
    const tiktok = new TikTokProvider({ clientKey: "test", clientSecret: "test" });
    const creator = vi.spyOn(tiktok, "creatorInfo").mockResolvedValue({
      creatorNickname: "Creator",
      creatorUsername: "creator",
      privacyLevels: ["SELF_ONLY"],
      duetDisabled: true,
      stitchDisabled: true,
      commentDisabled: false,
      maxVideoDurationSeconds: 60,
    });
    const svc = new SocialConnectionService(
      db,
      { tiktok },
      { enabled: true, encryptionKey: "ab".repeat(32), publicUrl: "https://api.example.invalid" },
    );
    const [account] = await db
      .insert(schema.socialAccounts)
      .values({
        ...p,
        provider: "tiktok",
        providerAccountId: "tt",
        username: "creator",
        displayName: "Creator",
        scopes: ["video.publish"],
        capabilities: { publish: true, metrics: false },
        status: "connected",
        expiresAt: new Date(Date.now() + 3600000),
        encryptedTokens: socialCredentialCipher("ab".repeat(32))!.encrypt(
          {
            accessToken: "test-only",
            scope: ["video.publish"],
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
          `${p.userId}:${p.orgId}:tiktok:tt`,
        ),
      })
      .returning();
    await expect(
      svc.creatorInfo({ ...p, userId: other.userId }, account!.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(svc.creatorInfo({ ...p, orgId: other.orgId }, account!.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(creator).not.toHaveBeenCalled();
    expect(await svc.creatorInfo(p, account!.id)).toMatchObject({
      nickname: "Creator",
      username: "creator",
      privacyLevels: ["SELF_ONLY"],
    });
    expect(creator).toHaveBeenCalledTimes(1);
  });
});
