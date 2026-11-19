import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import {
  createCampaign,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@synara/contracts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { readDocument, saveDocument } from "./store";
import {
  resumeSocialOAuth,
  SOCIAL_OAUTH_WAIT_KIND,
  type PendingSocialOAuth,
} from "./SocialOAuthResumeReactor";

it.layer(SqlitePersistenceMemory)("persisted social OAuth resume", (it) => {
  const session = {
    apiBaseUrl: "https://cloud.test",
    token: "never-in-context",
    userId: "u",
    orgId: "o",
    email: "",
    createdAt: "",
  };
  function setup(label: string) {
    const campaign = {
      ...createCampaign(label),
      threadId: `thread-${label}`,
      platforms: ["instagram"],
    };
    const wait: PendingSocialOAuth = {
      attemptId: `attempt-${label}`,
      userId: "u",
      orgId: "o",
      apiBaseUrl: session.apiBaseUrl,
      campaignId: campaign.id,
      threadId: campaign.threadId,
      revision: campaign.revision,
      provider: "instagram",
      state: "waiting",
    };
    const thread = {
      id: ThreadId.makeUnsafe(campaign.threadId),
      deletedAt: null,
      archivedAt: null,
      modelSelection: { provider: "codex", model: "test" },
      runtimeMode: "full-access",
      interactionMode: "default",
    };
    const commands: OrchestrationCommand[] = [];
    const receipts = new Set<string>();
    const engine = {
      getReadModel: () =>
        Effect.succeed({ threads: [thread] } as unknown as OrchestrationReadModel),
      dispatch: (command: OrchestrationCommand) =>
        Effect.sync(() => {
          if (!receipts.has(command.commandId)) {
            commands.push(command);
            receipts.add(command.commandId);
          }
          return { sequence: 1 };
        }),
    };
    let reads = 0;
    const deps = {
      session: async () => session,
      client: () => ({
        get: async (path: string) => {
          reads++;
          if (path === "/v1/social/accounts")
            return {
              accounts: [{ id: "account", provider: "instagram", status: "connected" }],
              providers: [],
            };
          return {
            attemptId: wait.attemptId,
            status: "connected",
            accountId: "account",
            threadId: wait.threadId,
            campaignId: wait.campaignId,
            revision: wait.revision,
            errorCode: null,
          };
        },
      }),
    };
    return { campaign, wait, engine, deps, commands, reads: () => reads };
  }
  it.effect("resumes once and reuses stable receipts after crash before saving completion", () =>
    Effect.gen(function* () {
      const f = setup("once");
      yield* saveDocument("campaign", f.campaign.id, f.campaign, null);
      yield* saveDocument(SOCIAL_OAUTH_WAIT_KIND, f.wait.attemptId, f.wait, null);
      yield* resumeSocialOAuth("/unused", f.engine, f.deps as never);
      yield* resumeSocialOAuth("/unused", f.engine, f.deps as never);
      assert.strictEqual(f.commands.length, 1);
      assert.notInclude(JSON.stringify(f.commands), "never-in-context");
      const stored = yield* readDocument(SOCIAL_OAUTH_WAIT_KIND, f.wait.attemptId);
      assert.strictEqual((stored!.value as PendingSocialOAuth).state, "resumed");
      // Simulate a crash after dispatch committed its receipt but before our completion write.
      yield* saveDocument(SOCIAL_OAUTH_WAIT_KIND, f.wait.attemptId, f.wait, stored!.version);
      yield* resumeSocialOAuth("/unused", f.engine, f.deps as never);
      assert.strictEqual(f.commands.length, 1);
      assert.strictEqual(f.commands[0]!.commandId, `social-oauth:${f.wait.attemptId}:resume`);
      assert.deepInclude(f.commands[0], { dispatchMode: "queue", dispatchOrigin: "automation" });
    }),
  );
  it.effect("never contacts cloud or resumes waits bound to another user or organization", () =>
    Effect.gen(function* () {
      const f = setup("foreign");
      yield* saveDocument("campaign", f.campaign.id, f.campaign, null);
      yield* saveDocument(
        SOCIAL_OAUTH_WAIT_KIND,
        f.wait.attemptId,
        { ...f.wait, userId: "other" },
        null,
      );
      yield* resumeSocialOAuth("/unused", f.engine, f.deps as never);
      assert.strictEqual(f.reads(), 0);
      assert.strictEqual(f.commands.length, 0);
      const row = yield* readDocument(SOCIAL_OAUTH_WAIT_KIND, f.wait.attemptId);
      yield* saveDocument(
        SOCIAL_OAUTH_WAIT_KIND,
        f.wait.attemptId,
        { ...f.wait, orgId: "other" },
        row!.version,
      );
      yield* resumeSocialOAuth("/unused", f.engine, f.deps as never);
      assert.strictEqual(f.reads(), 0);
    }),
  );
  it.effect("marks changed revisions and removed platforms obsolete without continuation", () =>
    Effect.gen(function* () {
      for (const change of ["revision", "platform"]) {
        const f = setup(change);
        yield* saveDocument(
          "campaign",
          f.campaign.id,
          {
            ...f.campaign,
            ...(change === "revision" ? { revision: f.campaign.revision + 1 } : { platforms: [] }),
          },
          null,
        );
        yield* saveDocument(SOCIAL_OAUTH_WAIT_KIND, f.wait.attemptId, f.wait, null);
        yield* resumeSocialOAuth("/unused", f.engine, f.deps as never);
        assert.strictEqual(f.commands.length, 0);
        assert.strictEqual(
          (
            (yield* readDocument(SOCIAL_OAUTH_WAIT_KIND, f.wait.attemptId))!
              .value as PendingSocialOAuth
          ).state,
          "obsolete",
        );
      }
    }),
  );
});
