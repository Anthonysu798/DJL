import type {
  CliAccountSummary,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationThreadActivity,
  ServerProviderUsageSnapshot,
} from "@djl/contracts";
import { ThreadId } from "@djl/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, ManagedRuntime, Option, Queue, Scope, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { AccountFailoverReactor } from "../Services/AccountFailoverReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { AccountFailoverReactorLive, currentChatAccountId } from "./AccountFailoverReactor";

// The signed-in accounts and their usage, as Settings → AI accounts would report them.
const accountsState = vi.hoisted(() => ({
  accounts: [] as CliAccountSummary[],
  usage: [] as Array<{ accountId: string; provider: string; snapshot: unknown }>,
}));
vi.mock("../../harnesses/cliAccounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../harnesses/cliAccounts.ts")>()),
  listCliAccounts: async () => accountsState.accounts,
  cliAccountsUsage: async () => ({ usage: accountsState.usage }),
}));

const activity = (kind: string, payload: unknown) =>
  ({
    id: kind,
    kind,
    tone: "info",
    summary: kind,
    payload,
    turnId: null,
    createdAt: "now",
  }) as unknown as OrchestrationThreadActivity;

describe("currentChatAccountId", () => {
  it("follows the latest switch for the provider, else the app-wide account", () => {
    const activities = [
      activity("account.switched", { provider: "codex", toId: "codex-a" }),
      activity("account.switched", { provider: "claudeAgent", toId: "claude-b" }),
      activity("tool.completed", {}),
    ];
    expect(currentChatAccountId({ activities }, "codex", undefined)).toBe("codex-a");
    expect(currentChatAccountId({ activities }, "claudeAgent", "claude-x")).toBe("claude-b");
    expect(currentChatAccountId({ activities: [] }, "codex", "codex-z")).toBe("codex-z");
    expect(currentChatAccountId({ activities: [] }, "codex", undefined)).toBe("default");
  });
});

const threadId = ThreadId.makeUnsafe("thread-limit");
const account = (id: string, overrides: Partial<CliAccountSummary> = {}): CliAccountSummary => ({
  id,
  provider: "codex",
  name: id === "default" ? "Codex" : `Account ${id}`,
  isDefault: id === "default",
  active: false,
  status: "signedIn",
  email: `${id}@example.com`,
  ...overrides,
});
const usage = (accountId: string, fiveHourUsed: number) => ({
  accountId,
  provider: "codex",
  snapshot: {
    provider: "codex",
    updatedAt: "now",
    limits: [{ window: "5h", usedPercent: fiveHourUsed }],
    usageLines: [],
    source: "test",
  } as unknown as ServerProviderUsageSnapshot,
});

const sessionSet = (status: string, lastError: string | null = null) =>
  ({
    type: "thread.session-set",
    payload: {
      threadId,
      session: {
        threadId,
        status,
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError,
        updatedAt: "2026-11-24T00:00:00.000Z",
      },
    },
  }) as unknown as OrchestrationEvent;

const rateLimited = (status: string, resetsAt?: string) =>
  ({
    type: "thread.activity-appended",
    payload: {
      threadId,
      activity: activity("account.rate-limited", { status, ...(resetsAt ? { resetsAt } : {}) }),
    },
  }) as unknown as OrchestrationEvent;

describe("AccountFailoverReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<AccountFailoverReactor, unknown> | null = null;
  let scope: Scope.Closeable | null = null;
  let dispatched: OrchestrationCommand[] = [];
  let thread: { activities: OrchestrationThreadActivity[]; [key: string]: unknown };

  beforeEach(() => {
    dispatched = [];
    accountsState.accounts = [account("default"), account("codex-a"), account("codex-b")];
    accountsState.usage = [usage("default", 100), usage("codex-a", 60), usage("codex-b", 20)];
    thread = {
      id: threadId,
      activities: [],
      messages: [
        { id: "msg-1", role: "user", text: "Build the landing page" },
        { id: "msg-2", role: "assistant", text: "" },
      ],
      modelSelection: { provider: "codex", model: "gpt-5.5" },
      runtimeMode: "full-access",
      interactionMode: "default",
    };
  });

  afterEach(async () => {
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
    scope = null;
    await runtime?.dispose();
    runtime = null;
  });

  async function start(settings: { autoSwitch?: boolean } = {}) {
    const events = await Effect.runPromise(Queue.unbounded<OrchestrationEvent>());
    const engine = {
      streamDomainEvents: Stream.fromQueue(events),
      dispatch: (command: OrchestrationCommand) =>
        Effect.sync(() => {
          dispatched.push(command);
          // Keep the projected thread in step, as the real projection would.
          if (command.type === "thread.activity.append") thread.activities.push(command.activity);
          return { sequence: dispatched.length };
        }),
    };
    const snapshots = {
      getThreadDetailById: () => Effect.succeed(Option.some(thread)),
    };
    const layer = AccountFailoverReactorLive.pipe(
      Layer.provide(Layer.succeed(OrchestrationEngineService, engine as never)),
      Layer.provide(Layer.succeed(ProjectionSnapshotQuery, snapshots as never)),
      Layer.provide(
        ServerSettingsService.layerTest({
          cliAccounts: { autoSwitch: settings.autoSwitch ?? true },
        }),
      ),
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "djl-failover-test-" })),
      Layer.provide(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer as Layer.Layer<AccountFailoverReactor, unknown>);
    const reactor = await runtime.runPromise(Effect.service(AccountFailoverReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await runtime.runPromise(reactor.start.pipe(Scope.provide(scope)));
    return async (...sent: OrchestrationEvent[]) => {
      for (const event of sent) await Effect.runPromise(Queue.offer(events, event));
      // Let the stream hand every event to the worker, then wait for the worker to finish.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await runtime!.runPromise(reactor.drain);
    };
  }

  const resends = () =>
    dispatched.filter(
      (
        command,
      ): command is Extract<OrchestrationCommand, { type: "thread.message.edit-and-resend" }> =>
        command.type === "thread.message.edit-and-resend",
    );
  const switches = () =>
    dispatched.flatMap((command) =>
      command.type === "thread.activity.append"
        ? [command.activity.payload as Record<string, unknown>]
        : [],
    );

  it("continues on the account with the most usage left after a rejected rate limit", async () => {
    const send = await start();
    await send(
      rateLimited("rejected", "2026-11-24T15:40:00.000Z"),
      sessionSet("error", "Turn failed"),
    );

    expect(switches()).toEqual([
      expect.objectContaining({
        provider: "codex",
        fromId: "default",
        toId: "codex-b",
        fromName: "Codex",
        toName: "Account codex-b",
        reason: "limit",
        resetsAt: "2026-11-24T15:40:00.000Z",
      }),
    ]);
    expect(resends()).toEqual([
      expect.objectContaining({
        threadId,
        messageId: "msg-1",
        text: "Build the landing page",
        providerOptions: { codex: { cliAccountId: "codex-b" } },
      }),
    ]);
  });

  it("recognises a usage-limit error message without a rate-limit event", async () => {
    const send = await start();
    await send(sessionSet("error", "You've hit your usage limit. Try again at 3:40 PM."));
    expect(resends().map((command) => command.providerOptions)).toEqual([
      { codex: { cliAccountId: "codex-b" } },
    ]);
  });

  it("leaves other failures alone", async () => {
    const send = await start();
    await send(sessionSet("error", "Working folder is unavailable"));
    expect(dispatched).toEqual([]);
  });

  it("forgets a rejected rate limit once the session recovers", async () => {
    const send = await start();
    await send(rateLimited("rejected"), sessionSet("ready"), sessionSet("error", "Turn failed"));
    expect(dispatched).toEqual([]);
  });

  it("ignores rate-limit warnings that were not rejected", async () => {
    const send = await start();
    await send(rateLimited("allowed_warning"), sessionSet("error", "Turn failed"));
    expect(dispatched).toEqual([]);
  });

  it("does nothing when automatic switching is off", async () => {
    const send = await start({ autoSwitch: false });
    await send(sessionSet("error", "You've hit your usage limit."));
    expect(dispatched).toEqual([]);
  });

  it("tries each account once, then stops when every account is out", async () => {
    const send = await start();
    await send(sessionSet("error", "You've hit your usage limit."));
    await send(sessionSet("error", "You've hit your usage limit."));
    await send(sessionSet("error", "You've hit your usage limit."));

    expect(switches().map((payload) => [payload.fromId, payload.toId])).toEqual([
      ["default", "codex-b"],
      ["codex-b", "codex-a"],
    ]);
    expect(resends()).toHaveLength(2);
  });

  it("skips signed-out and nearly used-up accounts", async () => {
    accountsState.accounts = [
      account("default"),
      account("codex-a", { status: "signedOut" }),
      account("codex-b"),
    ];
    accountsState.usage = [usage("default", 100), usage("codex-a", 0), usage("codex-b", 97)];
    const send = await start();
    await send(sessionSet("error", "You've hit your usage limit."));
    expect(dispatched).toEqual([]);
  });

  it("does not resend when the chat has no user message", async () => {
    thread.messages = [];
    const send = await start();
    await send(sessionSet("error", "You've hit your usage limit."));
    expect(dispatched).toEqual([]);
  });
});
