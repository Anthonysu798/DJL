import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { createCampaign } from "@djl/contracts";
import { readDocument, saveDocument } from "./store";
import { agentOwnerFromSession } from "./agentScope";
import { socialBridge } from "./socialBridge";

const session = {
  apiBaseUrl: "https://cloud.test",
  token: "private-session",
  userId: "u",
  orgId: "o",
  email: "",
  createdAt: "",
};
it.layer(SqlitePersistenceMemory)("chat social authorization bridge", (it) => {
  const campaign = {
    ...createCampaign("Launch"),
    ownerKey: agentOwnerFromSession(session).key,
    threadId: "thread-a",
    platforms: ["instagram"],
  };
  const calls: unknown[] = [];
  const deps = {
    session: async () => session,
    client: () => ({
      baseUrl: "https://cloud.test",
      get: async () => ({ providers: [], accounts: [] }),
      post: async (...args: unknown[]) => {
        calls.push(args);
        return {
          attemptId: "attempt",
          authorizationUrl: "https://www.instagram.com/oauth/authorize",
          expiresAt: "",
        };
      },
    }),
  };
  it.effect("rejects cross-thread and stale-card authorization before contacting cloud", () =>
    Effect.gen(function* () {
      yield* saveDocument("campaign", campaign.id, campaign, null);
      const foreign = yield* socialBridge(
        "/tmp",
        {
          action: "connect",
          campaignId: campaign.id,
          threadId: "other",
          version: 1,
          provider: "instagram",
        },
        deps as never,
      ).pipe(Effect.flip);
      assert.include(String(foreign), "conversation");
      const stale = yield* socialBridge(
        "/tmp",
        {
          action: "connect",
          campaignId: campaign.id,
          threadId: "thread-a",
          version: 0,
          provider: "instagram",
        },
        deps as never,
      ).pipe(Effect.flip);
      assert.include(String(stale), "changed");
      assert.strictEqual(calls.length, 0);
    }),
  );
  it.effect(
    "derives the OAuth context from the saved campaign and never returns session credentials",
    () =>
      Effect.gen(function* () {
        const result = yield* socialBridge(
          "/tmp",
          {
            action: "connect",
            campaignId: campaign.id,
            threadId: "thread-a",
            version: 1,
            provider: "instagram",
          },
          deps as never,
        );
        assert.notInclude(JSON.stringify(result), "private-session");
        const wait = yield* readDocument("social-oauth-wait", "attempt");
        assert.deepInclude(wait!.value, {
          userId: "u",
          orgId: "o",
          state: "waiting",
          campaignId: campaign.id,
          revision: campaign.revision,
        });
        assert.notInclude(JSON.stringify(wait), "private-session");
        assert.deepStrictEqual((calls[0] as unknown[])[1], {
          provider: "instagram",
          threadId: "thread-a",
          campaignId: campaign.id,
          revision: campaign.revision,
        });
      }),
  );
  it.effect("rejects foreign and unbound legacy campaigns before account or OAuth calls", () =>
    Effect.gen(function* () {
      let calls = 0;
      const deniedDeps = {
        session: async () => session,
        client: () => {
          calls++;
          throw new Error("Cloud must not be contacted");
        },
      };
      for (const ownerKey of ["foreign-owner", undefined]) {
        const item = {
          ...createCampaign("Denied"),
          threadId: "denied-social",
          ...(ownerKey ? { ownerKey } : {}),
        };
        yield* saveDocument("campaign", item.id, item, null);
        const error = yield* socialBridge(
          "/tmp",
          { action: "state", campaignId: item.id, threadId: item.threadId },
          deniedDeps as never,
        ).pipe(Effect.flip);
        assert.include(String(error), "owner");
      }
      assert.strictEqual(calls, 0);
    }),
  );
});
