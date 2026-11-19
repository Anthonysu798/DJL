import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { createCampaign } from "@synara/contracts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { readDocument, saveDocument, MarketingError } from "./store";
import { executeWorkflowTool } from "./agentWorkflowTools";

const owner = { key: "owner-a", userId: "a", orgId: "org-a", apiBaseUrl: "https://cloud.test" };
const scope = {
  threadId: "workflow-chat",
  authorizedRoot: "/tmp",
  attachmentFiles: [],
  stateDir: "/tmp",
};
const step = {
  tool: "djl_prepare_marketing",
  label: "Prepare draft",
  args: { brief: "$source:product" },
};
const deps = {
  owner: () => Effect.succeed(owner),
  bridge: () => Effect.fail(new MarketingError("Unexpected bridge call")),
  now: () => new Date("2026-10-26T12:00:00Z"),
};

it.layer(SqlitePersistenceMemory)("owned social workflows", (it) => {
  it.effect("keeps a missing-source blocker when a supplied value is blank", () =>
    Effect.gen(function* () {
      const saved = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        { action: "save", name: "Blank source", steps: [step] },
        deps,
      );
      const started = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "run",
          workflowId: (saved.workflow as { value: { id: string } }).value.id,
          version: 1,
        },
        deps,
      );
      const run = (started.run as { value: { id: string; steps: { id: string }[] } }).value;
      const updated = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "progress",
          runId: run.id,
          version: 1,
          stepId: run.steps[0]!.id,
          status: "pending",
          sources: { product: "  " },
        },
        deps,
      );
      assert.strictEqual((updated.run as { value: { status: string } }).value.status, "blocked");
    }),
  );
  it.effect("resolves missing inputs on a persisted run without losing completed work", () =>
    Effect.gen(function* () {
      const saved = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "save",
          name: "Resume inputs",
          steps: [{ tool: "djl_inspect_social_media", label: "Inspect", args: {} }, step],
        },
        deps,
      );
      const workflowId = (saved.workflow as { value: { id: string } }).value.id;
      const started = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        { action: "run", workflowId, version: 1 },
        deps,
      );
      const run = (started.run as { value: { id: string; steps: { id: string }[] } }).value;
      yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "progress",
          runId: run.id,
          version: 1,
          stepId: run.steps[0]!.id,
          status: "completed",
          result: { actualEvidence: "inspected" },
        },
        deps,
      );
      const resumed = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "progress",
          runId: run.id,
          version: 2,
          stepId: run.steps[1]!.id,
          status: "pending",
          sources: { product: "Verified product facts" },
        },
        deps,
      );
      const updated = resumed.run as {
        version: number;
        value: {
          status: string;
          sources: Record<string, string>;
          steps: { args: unknown; reason: string | null; result: unknown }[];
        };
      };
      assert.strictEqual(updated.version, 3);
      assert.strictEqual(updated.value.status, "ready");
      assert.deepStrictEqual(updated.value.steps[0]!.result, { actualEvidence: "inspected" });
      assert.deepStrictEqual(updated.value.steps[1]!.args, { brief: "Verified product facts" });
      assert.strictEqual(updated.value.steps[1]!.reason, null);
      assert.strictEqual(updated.value.sources.product, "Verified product facts");
      const stale = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "progress",
          runId: run.id,
          version: 2,
          stepId: run.steps[1]!.id,
          status: "pending",
          sources: { product: "stale" },
        },
        deps,
      ).pipe(Effect.flip);
      assert.include(String(stale), "changed");
      const finished = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "progress",
          runId: run.id,
          version: 3,
          stepId: run.steps[1]!.id,
          status: "completed",
          result: { campaignId: "actual-draft" },
        },
        deps,
      );
      assert.strictEqual(
        (finished.run as { value: { status: string } }).value.status,
        "awaiting_review",
      );
    }),
  );
  it.effect("requires server session identity and rejects client-supplied owners", () =>
    Effect.gen(function* () {
      const signedOut = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        { action: "list" },
        {
          ...deps,
          owner: () => Effect.fail(new MarketingError("Sign in to DJL.", 401)),
        },
      ).pipe(Effect.flip);
      assert.strictEqual((signedOut as MarketingError).status, 401);
      const spoofed = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        { action: "list", ownerKey: owner.key },
        deps,
      ).pipe(Effect.flip);
      assert.include(String(spoofed), "Identity");
    }),
  );
  it.effect(
    "persists runnable steps, supplied sources and progress across calls without publishing",
    () =>
      Effect.gen(function* () {
        const saved = yield* executeWorkflowTool(
          scope,
          "djl_social_workflows",
          { action: "save", name: "Weekly", steps: [step] },
          deps,
        );
        const workflow = saved.workflow as { value: { id: string }; version: number };
        const replay = yield* executeWorkflowTool(
          scope,
          "djl_social_workflows",
          {
            action: "run",
            workflowId: workflow.value.id,
            version: 1,
            sources: { product: "Actual product facts" },
          },
          deps,
        );
        const run = replay.run as {
          value: { id: string; steps: { id: string; args: unknown }[] };
          version: number;
        };
        assert.deepStrictEqual(run.value.steps[0]!.args, { brief: "Actual product facts" });
        const complete = yield* executeWorkflowTool(
          scope,
          "djl_social_workflows",
          {
            action: "progress",
            runId: run.value.id,
            version: 1,
            stepId: run.value.steps[0]!.id,
            status: "completed",
            result: { campaignId: "prepared" },
          },
          deps,
        );
        assert.strictEqual(
          (complete.run as { value: { status: string } }).value.status,
          "awaiting_review",
        );
        const reopened = yield* executeWorkflowTool(
          scope,
          "djl_social_workflows",
          { action: "list" },
          deps,
        );
        assert.isTrue(
          (reopened.runs as { value: { id: string } }[]).some(
            (item) => item.value.id === run.value.id,
          ),
        );
        assert.strictEqual((yield* readDocument("agent-workflow-run", run.value.id))?.version, 2);
        const stale = yield* executeWorkflowTool(
          scope,
          "djl_social_workflows",
          { action: "archive", workflowId: workflow.value.id, version: 0 },
          deps,
        ).pipe(Effect.flip);
        assert.include(String(stale), "changed");
      }),
  );

  it.effect("isolates users and organizations, and rejects publication steps", () =>
    Effect.gen(function* () {
      const saved = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        { action: "save", name: "Private", steps: [step] },
        deps,
      );
      const id = (saved.workflow as { value: { id: string } }).value.id;
      for (const other of [
        { ...owner, key: "owner-b", userId: "b" },
        { ...owner, key: "owner-c", orgId: "org-b" },
      ]) {
        const foreign = { ...deps, owner: () => Effect.succeed(other) };
        const listed = yield* executeWorkflowTool(
          scope,
          "djl_social_workflows",
          { action: "list" },
          foreign,
        );
        assert.deepStrictEqual(listed.workflows, []);
        const denied = yield* executeWorkflowTool(
          scope,
          "djl_social_workflows",
          { action: "run", workflowId: id, version: 1 },
          foreign,
        ).pipe(Effect.flip);
        assert.include(String(denied), "missing");
      }
      const denied = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "save",
          name: "Unsafe",
          steps: [{ ...step, tool: "djl_prepare_social_publish" }],
        },
        deps,
      ).pipe(Effect.flip);
      assert.include(String(denied), "preparation");
    }),
  );

  it.effect("persists unresolved sources as blockers and prevents out-of-order completion", () =>
    Effect.gen(function* () {
      const saved = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        { action: "save", name: "Missing source", steps: [step, { ...step, label: "Second" }] },
        deps,
      );
      const id = (saved.workflow as { value: { id: string } }).value.id;
      const replay = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        { action: "run", workflowId: id, version: 1 },
        deps,
      );
      const run = (
        replay.run as {
          value: { id: string; status: string; steps: { id: string; status: string }[] };
        }
      ).value;
      assert.strictEqual(run.status, "blocked");
      const denied = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "progress",
          runId: run.id,
          version: 1,
          stepId: run.steps[1]!.id,
          status: "completed",
        },
        deps,
      ).pipe(Effect.flip);
      assert.include(String(denied), "current step");
      yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "progress",
          runId: run.id,
          version: 1,
          stepId: run.steps[0]!.id,
          status: "pending",
        },
        deps,
      );
      const bypass = yield* executeWorkflowTool(
        scope,
        "djl_social_workflows",
        {
          action: "progress",
          runId: run.id,
          version: 2,
          stepId: run.steps[0]!.id,
          status: "completed",
        },
        deps,
      ).pipe(Effect.flip);
      assert.include(String(bypass), "missing sources");
    }),
  );

  it.effect("only reads owned bindings, preserves partial failures and null official metrics", () =>
    Effect.gen(function* () {
      const campaign = { ...createCampaign("Owned"), threadId: "owned-chat", ownerKey: owner.key };
      yield* saveDocument("campaign", campaign.id, campaign, null);
      yield* saveDocument(
        "campaign",
        "legacy-unowned",
        { ...campaign, id: "legacy-unowned", ownerKey: undefined },
        null,
      );
      yield* saveDocument(
        "social-draft-link",
        "draft-a",
        {
          ...owner,
          campaignId: campaign.id,
          campaignRevision: campaign.revision,
          draftId: "draft-a",
          cloudRevision: 1,
        },
        null,
      );
      const other = { ...createCampaign("Foreign"), threadId: "foreign-chat", ownerKey: "other" };
      yield* saveDocument("campaign", other.id, other, null);
      const offline = {
        ...createCampaign("Owned offline"),
        threadId: "offline-chat",
        ownerKey: owner.key,
      };
      yield* saveDocument("campaign", offline.id, offline, null);
      const calls: Record<string, unknown>[] = [];
      const live = {
        ...deps,
        bridge: (_config: unknown, raw: unknown) => {
          const input = raw as Record<string, unknown>;
          calls.push(input);
          if (input.action === "metrics")
            return Effect.succeed({
              postUrl: "https://www.instagram.com/p/real/",
              metrics: { views: null, likes: 5, comments: 0, shares: null },
            });
          if (input.campaignId !== campaign.id)
            return Effect.fail(new MarketingError("Offline", 503));
          return Effect.succeed({
            drafts: [
              {
                id: "draft-a",
                userId: owner.userId,
                orgId: owner.orgId,
                threadId: campaign.threadId,
                revision: 1,
                confirmedAt: "2026-10-25T12:00:00Z",
                content: {
                  accountIds: ["ig"],
                  mediaFileIds: [],
                  captions: {},
                  caption: "actual",
                  scheduledAt: "2026-10-25T12:00:00Z",
                  timezone: "UTC",
                },
                tasks: [
                  {
                    id: "task-a",
                    revision: 1,
                    accountId: "ig",
                    state: "published",
                    updatedAt: "2026-10-25T12:00:00Z",
                    dueAt: "2026-10-25T12:00:00Z",
                    postId: "post",
                    errorCode: null,
                  },
                ],
              },
            ],
            accounts: { accounts: [{ id: "ig", provider: "instagram" }], providers: [] },
          });
        },
      };
      const inbox = yield* executeWorkflowTool(scope, "djl_social_inbox", { action: "list" }, live);
      assert.isTrue(
        (inbox.items as { campaignId: string }[]).every((item) => item.campaignId === campaign.id),
      );
      assert.isTrue((inbox.limitations as string[]).some((item) => item.includes(offline.id)));
      const coach = yield* executeWorkflowTool(scope, "djl_social_coach", { days: 7 }, live);
      const posts = coach.posts as {
        metrics: { views: number | null; likes: number | null };
        postUrl: string;
      }[];
      assert.strictEqual(posts.length, 1);
      assert.strictEqual(posts[0]!.metrics.views, null);
      assert.strictEqual(posts[0]!.metrics.likes, 5);
      assert.include(posts[0]!.postUrl, "/real/");
      const providers = coach.providers as {
        provider: string;
        averages: { views: number | null; likes: number | null };
        availableSamples: { views: number; likes: number };
      }[];
      assert.strictEqual(providers[0]!.averages.views, null);
      assert.strictEqual(providers[0]!.availableSamples.views, 0);
      assert.strictEqual(providers[0]!.availableSamples.likes, 1);
      assert.isFalse(
        calls.some((call) => call.campaignId === other.id || call.campaignId === "legacy-unowned"),
      );
      const denied = yield* executeWorkflowTool(
        scope,
        "djl_social_inbox",
        {
          action: "retry",
          campaignId: campaign.id,
          threadId: campaign.threadId,
          version: 2,
          draftId: "draft-a",
          taskId: "task-a",
          revision: 1,
        },
        live,
      ).pipe(Effect.flip);
      assert.include(String(denied), "changed");
    }),
  );

  it.effect("binds inbox actions to exact task revisions and leaves rescheduling unconfirmed", () =>
    Effect.gen(function* () {
      const accountOwner = { ...owner, key: "actions-owner" };
      const campaign = {
        ...createCampaign("Actions"),
        threadId: "actions-chat",
        ownerKey: accountOwner.key,
      };
      yield* saveDocument("campaign", campaign.id, campaign, null);
      yield* saveDocument(
        "social-draft-link",
        "action-draft",
        {
          ...accountOwner,
          campaignId: campaign.id,
          campaignRevision: campaign.revision,
          draftId: "action-draft",
          cloudRevision: 2,
        },
        null,
      );
      const calls: Record<string, unknown>[] = [];
      const live = {
        ...deps,
        owner: () => Effect.succeed(accountOwner),
        bridge: (_config: unknown, raw: unknown) => {
          const input = raw as Record<string, unknown>;
          calls.push(input);
          return Effect.succeed(
            input.action === "state"
              ? {
                  drafts: [
                    {
                      id: "action-draft",
                      userId: owner.userId,
                      orgId: owner.orgId,
                      threadId: campaign.threadId,
                      revision: 2,
                      confirmedAt: "2026-10-25T12:00:00Z",
                      content: {
                        accountIds: ["ig"],
                        mediaFileIds: [],
                        captions: {},
                        caption: "actual",
                        scheduledAt: "2026-10-30T12:00:00Z",
                        timezone: "UTC",
                      },
                      tasks: [
                        {
                          id: "action-task",
                          revision: 2,
                          accountId: "ig",
                          state: "queued",
                          updatedAt: "2026-10-25T12:00:00Z",
                          dueAt: "2026-10-30T12:00:00Z",
                          postId: null,
                          errorCode: null,
                        },
                      ],
                    },
                  ],
                  accounts: { accounts: [{ id: "ig", provider: "instagram" }], providers: [] },
                }
              : { revision: 3, confirmedAt: null, tasks: [] },
          );
        },
      };
      const base = {
        campaignId: campaign.id,
        threadId: campaign.threadId,
        version: 1,
        draftId: "action-draft",
        taskId: "action-task",
        revision: 2,
      };
      const denied = yield* executeWorkflowTool(
        scope,
        "djl_social_inbox",
        { ...base, action: "cancel", revision: 1 },
        live,
      ).pipe(Effect.flip);
      assert.include(String(denied), "changed");
      yield* executeWorkflowTool(scope, "djl_social_inbox", { ...base, action: "cancel" }, live);
      assert.isTrue(
        calls.some(
          (call) =>
            call.action === "task" &&
            call.taskAction === "cancel" &&
            call.taskId === "action-task" &&
            call.revision === 2,
        ),
      );
      const rescheduled = yield* executeWorkflowTool(
        scope,
        "djl_social_inbox",
        {
          ...base,
          action: "reschedule",
          scheduledAt: "2026-11-01T12:00:00Z",
          timezone: "America/Toronto",
        },
        live,
      );
      assert.strictEqual(rescheduled.requiresReview, true);
      assert.isTrue(
        calls.some((call) => call.action === "prepare" && call.publicationMode === "scheduled"),
      );
      assert.isFalse(calls.some((call) => call.action === "confirm"));
    }),
  );
});
