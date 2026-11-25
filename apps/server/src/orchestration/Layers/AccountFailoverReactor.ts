// FILE: AccountFailoverReactor.ts
// Purpose: When a chat's Claude Code / Codex subscription account hits its usage limit mid-task,
//          continue on the signed-in account of the same app with the most usage left: note the
//          switch in the chat, then resend the user's message on the new account (the provider
//          reactor starts a fresh session there and carries the chat history over).
// Layer: Orchestration reactor. Rules live in `harnesses/accountFailover.ts`.

import {
  CommandId,
  DEFAULT_CLI_ACCOUNT_ID,
  EventId,
  type CliAccountProvider,
  type OrchestrationEvent,
  type OrchestrationThread,
} from "@djl/contracts";
import { makeDrainableWorker } from "@djl/shared/DrainableWorker";
import { Cause, Effect, Layer, Option, Stream } from "effect";

import { ServerConfig } from "../../config.ts";
import { isUsageLimitMessage, pickFailoverAccount } from "../../harnesses/accountFailover.ts";
import { cliAccountsRoot, cliAccountsUsage, listCliAccounts } from "../../harnesses/cliAccounts.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  AccountFailoverReactor,
  type AccountFailoverReactorShape,
} from "../Services/AccountFailoverReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

type FailoverTriggerEvent = Extract<
  OrchestrationEvent,
  { type: "thread.session-set" } | { type: "thread.activity-appended" }
>;

const ACCOUNT_SWITCHED = "account.switched";
const DEFAULT_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function isAccountProvider(value: string | null | undefined): value is CliAccountProvider {
  return value === "codex" || value === "claudeAgent";
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** The account a chat runs on now: its last switch, else the app-wide choice. */
export function currentChatAccountId(
  thread: Pick<OrchestrationThread, "activities">,
  provider: CliAccountProvider,
  activeId: string | undefined,
): string {
  for (let index = thread.activities.length - 1; index >= 0; index--) {
    const activity = thread.activities[index]!;
    if (activity.kind !== ACCOUNT_SWITCHED) continue;
    const payload = payloadRecord(activity.payload);
    if (payload.provider === provider && typeof payload.toId === "string") return payload.toId;
  }
  return activeId ?? DEFAULT_CLI_ACCOUNT_ID;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettingsService;
  const config = yield* ServerConfig;
  const accountOptions = { root: cliAccountsRoot(config.baseDir), homeDir: config.homeDir };

  // A rejected rate-limit event earlier in the turn (Claude / Codex), with its reset time.
  const rejectedByThread = new Map<string, { resetsAt: number | null }>();
  // Accounts already tried for a user message, so a chat never loops between limited accounts.
  const triedByMessage = new Map<string, Set<string>>();
  const limitedUntil = new Map<string, number>();

  const failOver = Effect.fnUntraced(function* (
    event: Extract<FailoverTriggerEvent, { type: "thread.session-set" }>,
  ) {
    const { session, threadId } = event.payload;
    if (session.status === "ready" || session.status === "stopped")
      rejectedByThread.delete(threadId);
    if (session.status !== "error" || !isAccountProvider(session.providerName)) return;
    const rejected = rejectedByThread.get(threadId);
    rejectedByThread.delete(threadId);
    if (!rejected && !isUsageLimitMessage(session.lastError)) return;
    const provider = session.providerName;
    const settings = yield* serverSettings.getSettings;
    if (!settings.cliAccounts.autoSwitch) return;

    const threadOption = yield* projectionSnapshotQuery.getThreadDetailById(threadId);
    if (Option.isNone(threadOption)) return;
    const thread = threadOption.value;
    const message = thread.messages.findLast((entry) => entry.role === "user");
    if (!message || !message.text.trim()) return;

    const now = Date.now();
    const fromId = currentChatAccountId(thread, provider, settings.cliAccounts.active[provider]);
    limitedUntil.set(fromId, rejected?.resetsAt ?? now + DEFAULT_LIMIT_WINDOW_MS);
    const tried = triedByMessage.get(message.id) ?? new Set<string>();
    tried.add(fromId);
    triedByMessage.set(message.id, tried);

    const [accounts, usage] = yield* Effect.tryPromise(() =>
      Promise.all([
        listCliAccounts(settings, accountOptions),
        cliAccountsUsage(settings, { homeDir: config.homeDir }),
      ]),
    );
    const next = pickFailoverAccount({
      provider,
      accounts,
      usage: usage.usage,
      tried,
      limitedUntil,
      now,
    });
    if (!next) return;
    tried.add(next.id);

    const createdAt = new Date().toISOString();
    const from = accounts.find((account) => account.provider === provider && account.id === fromId);
    const token = `${threadId}:${message.id}:${next.id}`;
    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: CommandId.makeUnsafe(`account-switch:${token}`),
      threadId,
      activity: {
        id: EventId.makeUnsafe(`account-switch-${Buffer.from(token).toString("base64url")}`),
        tone: "info",
        kind: ACCOUNT_SWITCHED,
        summary: "Switched account",
        payload: {
          provider,
          fromId,
          toId: next.id,
          fromName: from?.name ?? "",
          toName: next.name,
          toEmail: next.email,
          reason: "limit",
          ...(rejected?.resetsAt ? { resetsAt: new Date(rejected.resetsAt).toISOString() } : {}),
        },
        turnId: null,
        createdAt,
      },
      createdAt,
    });
    yield* orchestrationEngine.dispatch({
      type: "thread.message.edit-and-resend",
      commandId: CommandId.makeUnsafe(`account-resend:${token}`),
      threadId,
      messageId: message.id,
      text: message.text,
      modelSelection: thread.modelSelection,
      providerOptions: { [provider]: { cliAccountId: next.id } },
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt,
    });
  });

  const processEvent = (event: FailoverTriggerEvent) => {
    if (event.type === "thread.activity-appended") {
      const { activity, threadId } = event.payload;
      if (activity.kind !== "account.rate-limited") return Effect.void;
      const payload = payloadRecord(activity.payload);
      if (payload.status !== "rejected") return Effect.void;
      const resetsAt =
        typeof payload.resetsAt === "string" ? Date.parse(payload.resetsAt) : Number.NaN;
      rejectedByThread.set(threadId, { resetsAt: Number.isFinite(resetsAt) ? resetsAt : null });
      return Effect.void;
    }
    return failOver(event);
  };

  const processEventSafely = (event: FailoverTriggerEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logWarning("account failover reactor could not switch accounts", {
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);

  const start: AccountFailoverReactorShape["start"] = Effect.forkScoped(
    Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
      event.type === "thread.session-set" || event.type === "thread.activity-appended"
        ? worker.enqueue(event)
        : Effect.void,
    ),
  ).pipe(Effect.asVoid);

  return { start, drain: worker.drain } satisfies AccountFailoverReactorShape;
});

export const AccountFailoverReactorLive = Layer.effect(AccountFailoverReactor, make);
