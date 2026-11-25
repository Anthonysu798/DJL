// End to end through the real orchestration engine, runtime ingestion and provider reactor:
// a Codex turn that hits its usage limit is noted in the chat and resent on the signed-in
// account with the most usage left, in a fresh session that carries the chat over.
import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  type CliAccountSummary,
} from "@djl/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { vi } from "vitest";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";
import type { TestTurnResponse } from "./TestProviderAdapter.integration.ts";

// Three signed-in Codex accounts: the main one is out, "Work" has the most usage left.
const fakeAccounts = vi.hoisted(() => ({
  accounts: [
    ["default", "Personal"],
    ["codex-work", "Work"],
    ["codex-side", "Side"],
  ].map(([id, name]) => ({
    id: id!,
    provider: "codex" as const,
    name: name!,
    isDefault: id === "default",
    active: id === "default",
    status: "signedIn" as const,
    email: `${id}@example.com`,
  })),
  usage: (
    [
      ["default", 100],
      ["codex-work", 30],
      ["codex-side", 80],
    ] as const
  ).map(([accountId, usedPercent]) => ({
    accountId,
    provider: "codex" as const,
    snapshot: {
      provider: "codex",
      updatedAt: "2026-11-24T00:00:00.000Z",
      limits: [{ window: "5h", usedPercent }],
      usageLines: [],
      source: "test",
    },
  })),
}));
vi.mock("../src/harnesses/cliAccounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/harnesses/cliAccounts.ts")>()),
  listCliAccounts: async (): Promise<CliAccountSummary[]> => fakeAccounts.accounts,
  cliAccountsUsage: async () => ({ usage: fakeAccounts.usage }),
}));

const PROJECT_ID = ProjectId.makeUnsafe("project-failover");
const THREAD_ID = ThreadId.makeUnsafe("thread-failover");
const TURN = "fixture-turn";
const base = (eventId: string) => ({
  eventId: EventId.makeUnsafe(eventId),
  provider: "codex" as const,
  createdAt: new Date().toISOString(),
  threadId: THREAD_ID,
  turnId: TURN,
});

const limitedTurn: TestTurnResponse = {
  events: [
    { type: "turn.started", ...base("evt-limit-1") },
    {
      type: "account.rate-limits.updated",
      ...base("evt-limit-2"),
      payload: { rateLimits: { status: "rejected" } },
    },
    {
      type: "turn.completed",
      ...base("evt-limit-3"),
      payload: {
        state: "failed",
        errorMessage: "You've hit your usage limit. Try again at 3:40 PM.",
      },
    },
  ],
};
const answeredTurn: TestTurnResponse = {
  events: [
    { type: "turn.started", ...base("evt-ok-1") },
    {
      type: "content.delta",
      ...base("evt-ok-2"),
      payload: { streamKind: "assistant_text", delta: "Landing page ready." },
    },
    { type: "turn.completed", ...base("evt-ok-3"), payload: { state: "completed" } },
  ],
};

const seed = (harness: OrchestrationIntegrationHarness) =>
  Effect.gen(function* () {
    const createdAt = new Date().toISOString();
    const modelSelection = { provider: "codex" as const, model: DEFAULT_MODEL_BY_PROVIDER.codex };
    yield* harness.engine.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-project"),
      projectId: PROJECT_ID,
      title: "Failover",
      workspaceRoot: harness.workspaceDir,
      defaultModelSelection: modelSelection,
      createdAt,
    });
    yield* harness.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.makeUnsafe("cmd-thread"),
      threadId: THREAD_ID,
      projectId: PROJECT_ID,
      title: "Failover",
      modelSelection,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: harness.workspaceDir,
      createdAt,
    });
  });

it.live("continues a limited chat on the account with the most usage left", () =>
  Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({ provider: "codex", accountFailover: true }),
    (harness) =>
      Effect.gen(function* () {
        const adapter = harness.adapterHarness!;
        yield* seed(harness);
        yield* adapter.queueTurnResponseForNextSession(limitedTurn);

        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("cmd-turn-1"),
          threadId: THREAD_ID,
          message: {
            messageId: MessageId.makeUnsafe("msg-user-1"),
            role: "user",
            text: "Build me a landing page",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          createdAt: new Date().toISOString(),
        });

        // The first session fails on the limit; queue the answer for the session on the new account.
        yield* harness.waitForThread(THREAD_ID, (thread) => thread.session?.status === "error");
        yield* adapter.queueTurnResponseForNextSession(answeredTurn);

        const thread = yield* harness.waitForThread(
          THREAD_ID,
          (entry) =>
            entry.messages.some(
              (message) =>
                message.role === "assistant" && message.text.includes("Landing page ready."),
            ),
          15_000,
        );

        const switched = thread.activities.filter(
          (activity) => activity.kind === "account.switched",
        );
        assert.equal(switched.length, 1);
        assert.deepInclude(switched[0]!.payload as object, {
          provider: "codex",
          fromId: "default",
          toId: "codex-work",
          fromName: "Personal",
          toName: "Work",
          reason: "limit",
        });
        // The user's message is resent, not duplicated.
        assert.deepEqual(
          thread.messages
            .filter((message) => message.role === "user")
            .map((message) => message.text),
          ["Build me a landing page"],
        );
        assert.equal(adapter.getStartCount(), 2);
        const [first, second] = adapter.getStartProviderOptions() as Array<
          { codex?: { cliAccountId?: string } } | undefined
        >;
        assert.equal(first?.codex?.cliAccountId, undefined);
        assert.equal(second?.codex?.cliAccountId, "codex-work");
      }),
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer)),
);
