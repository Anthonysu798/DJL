import { afterAll, describe, expect, it, vi } from "vitest";
import { schema } from "@djl/db";
import { and, eq } from "drizzle-orm";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { SocialConnectionService } from "./SocialConnectionService.ts";
import type { SocialProvider } from "./providers/index.ts";
const { db, close } = testDatabase();
afterAll(close);
const exchangeCode = vi.fn(async () => ({
  accessToken: "fixture-token",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  scope: ["instagram_business_basic"],
}));
const provider: SocialProvider = {
  id: "instagram",
  authorizationUrl: ({ state }) => `https://instagram.com/oauth?state=${state}`,
  exchangeCode,
  refresh: async (token) => token,
  revoke: async () => {},
  account: async () => ({
    id: "fixture-account",
    username: "fixture",
    displayName: "Fixture",
    scopes: [],
    capabilities: { publish: false, metrics: false },
  }),
};
const service = new SocialConnectionService(
  db,
  { instagram: provider },
  { enabled: true, encryptionKey: "ab".repeat(32), publicUrl: "https://api.example.invalid" },
);
const startInput = {
  provider: "instagram" as const,
  threadId: "thread",
  campaignId: "campaign",
  revision: 1,
};
describe("browser login continuation", () => {
  it("stores callback code encrypted, invalidates original state, and lets only original user finish once even from another active org", async () => {
    const owner = await seedOrg(db, "continuation");
    const foreign = await seedOrg(db, "foreign-continuation");
    const started = await service.start(owner, startInput);
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const staged = await service.stageCallback("instagram", {
      state,
      code: "fixture-private-code",
    });
    expect(JSON.stringify(staged)).not.toContain("fixture-private-code");
    const [stored] = await db
      .select()
      .from(schema.socialOAuthAttempts)
      .where(eq(schema.socialOAuthAttempts.id, started.attemptId));
    expect(stored!.encryptedVerifier).not.toContain("fixture-private-code");
    await expect(
      service.stageCallback("instagram", { state, code: "replacement" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.continueCallback(foreign, "instagram", staged.continuation),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.status(owner, started.attemptId)).status).toBe("pending");
    const result = await service.continueCallback(
      { ...owner, orgId: foreign.orgId },
      "instagram",
      staged.continuation,
    );
    expect(result.status).toBe("connected");
    const exchanges = exchangeCode.mock.calls.length;
    expect(await service.continueCallback(owner, "instagram", staged.continuation)).toMatchObject({
      status: "connected",
    });
    expect(exchangeCode.mock.calls).toHaveLength(exchanges);
    await expect(
      service.continueCallback(foreign, "instagram", staged.continuation),
    ).rejects.toMatchObject({ status: 409 });
    expect(exchangeCode).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "fixture-private-code" }),
    );
    const [finished] = await db
      .select()
      .from(schema.socialOAuthAttempts)
      .where(eq(schema.socialOAuthAttempts.id, started.attemptId));
    expect(finished!.encryptedVerifier).toBe("");
  });
  it("rejects expired continuation", async () => {
    const owner = await seedOrg(db, "expired-continuation");
    const started = await service.start(owner, startInput);
    const staged = await service.stageCallback("instagram", {
      state: new URL(started.authorizationUrl).searchParams.get("state")!,
      code: "code",
    });
    await db
      .update(schema.socialOAuthAttempts)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.socialOAuthAttempts.id, started.attemptId));
    await expect(
      service.continueCallback(owner, "instagram", staged.continuation),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("does not consume a continuation after original organization membership is removed", async () => {
    const owner = await seedOrg(db, "removed-continuation");
    const started = await service.start(owner, startInput);
    const staged = await service.stageCallback("instagram", {
      state: new URL(started.authorizationUrl).searchParams.get("state")!,
      code: "code",
    });
    await db
      .delete(schema.member)
      .where(
        and(eq(schema.member.userId, owner.userId), eq(schema.member.organizationId, owner.orgId)),
      );
    await expect(
      service.continueCallback(owner, "instagram", staged.continuation),
    ).rejects.toMatchObject({ status: 403 });
    const [row] = await db
      .select()
      .from(schema.socialOAuthAttempts)
      .where(eq(schema.socialOAuthAttempts.id, started.attemptId));
    expect(row!.status).toBe("pending");
  });
  it.each(["cancelled", "failed"])(
    "returns stored %s without another token exchange",
    async (expected) => {
      const owner = await seedOrg(db, "terminal-continuation");
      const started = await service.start(owner, startInput);
      const staged = await service.stageCallback("instagram", {
        state: new URL(started.authorizationUrl).searchParams.get("state")!,
        ...(expected === "cancelled" ? { error: "denied" } : {}),
      });
      const before = exchangeCode.mock.calls.length;
      expect((await service.continueCallback(owner, "instagram", staged.continuation)).status).toBe(
        expected,
      );
      expect((await service.continueCallback(owner, "instagram", staged.continuation)).status).toBe(
        expected,
      );
      expect(exchangeCode.mock.calls).toHaveLength(before);
    },
  );
  it("concurrent authenticated continuations observe one exchange", async () => {
    const owner = await seedOrg(db, "concurrent-continuation");
    const started = await service.start(owner, startInput);
    const staged = await service.stageCallback("instagram", {
      state: new URL(started.authorizationUrl).searchParams.get("state")!,
      code: "code",
    });
    const before = exchangeCode.mock.calls.length;
    const results = await Promise.all([
      service.continueCallback(owner, "instagram", staged.continuation),
      service.continueCallback(owner, "instagram", staged.continuation),
    ]);
    expect(results.every((result) => ["processing", "connected"].includes(result.status))).toBe(
      true,
    );
    expect((await service.continueCallback(owner, "instagram", staged.continuation)).status).toBe(
      "connected",
    );
    expect(exchangeCode.mock.calls).toHaveLength(before + 1);
  });
});
