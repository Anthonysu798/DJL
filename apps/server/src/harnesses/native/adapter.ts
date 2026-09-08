import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  ProviderRuntimeEvent,
  ProviderApprovalPolicy,
  ProviderSandboxMode,
  ProviderStartOptions,
  ThreadId,
  TurnId,
  type CanonicalRequestType,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type ProviderApprovalDecision,
} from "@synara/contracts";
import { Effect, Queue, Schema, Stream } from "effect";
import { ProviderAdapterRequestError, type ProviderAdapterError } from "../../provider/Errors";
import type { ProviderAdapterShape } from "../../provider/Services/ProviderAdapter";
import { mergeNativeProfile } from "./profile";
import { nativeQuestions, nativeApprovalDetail } from "./requests";
import { bounded } from "./protocol";
import type { NativeDriver, NativeDriverFactory, NativeProvider, NativeSink } from "./types";
import { nativePermissionModes, recordPermissionRejection } from "./permissionCapabilities";

const NativeResumeCursor = Schema.Struct({
  nativeSessionId: Schema.String,
  approvalPolicy: Schema.optional(ProviderApprovalPolicy),
  sandboxMode: Schema.optional(ProviderSandboxMode),
  providerOptions: Schema.optional(ProviderStartOptions),
});

interface SessionState {
  session: ProviderSession;
  profileOptions: ProviderStartOptions;
  driver?: NativeDriver;
  stopped: boolean;
  completed: boolean;
  pending: Map<
    string,
    {
      type: CanonicalRequestType;
      resolve: (answer: ProviderApprovalDecision | ProviderUserInputAnswers) => void;
    }
  >;
}

export const makeNativeAdapter = (
  provider: NativeProvider,
  factory: NativeDriverFactory,
  readProfile: () => Promise<ProviderStartOptions> = async () => ({}),
) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<string, SessionState>();
    const decode = Schema.decodeUnknownSync(ProviderRuntimeEvent);
    const emit = (state: SessionState, event: Record<string, unknown>) => {
      const canonical = decode({
        eventId: randomUUID(),
        provider,
        threadId: state.session.threadId,
        createdAt: new Date().toISOString(),
        ...(state.session.activeTurnId ? { turnId: state.session.activeTurnId } : {}),
        ...(state.driver ? { providerRefs: { providerThreadId: state.driver.id } } : {}),
        ...event,
        ...(typeof event.itemId === "string" && state.session.activeTurnId
          ? { itemId: `${state.session.activeTurnId}:${event.itemId}` }
          : {}),
      });
      Effect.runSync(Queue.offer(queue, canonical));
    };
    const complete = (
      state: SessionState,
      status: "completed" | "failed" | "interrupted",
      errorMessage?: string,
    ) => {
      if (!state.session.activeTurnId || state.completed) return;
      state.completed = true;
      emit(state, {
        type: "turn.completed",
        payload: { state: status, ...(errorMessage ? { errorMessage } : {}) },
      });
      for (const pending of state.pending.values()) pending.resolve("cancel");
      const { activeTurnId: _, ...session } = state.session;
      state.session = {
        ...session,
        status: status === "failed" ? "error" : "ready",
        updatedAt: new Date().toISOString(),
      };
    };
    const stop = (state: SessionState) => {
      if (state.stopped) return;
      state.stopped = true;
      complete(state, "interrupted");
      for (const pending of state.pending.values()) pending.resolve("cancel");
      state.driver?.close();
      state.session = { ...state.session, status: "closed" };
      sessions.delete(state.session.threadId);
      emit(state, {
        type: "session.exited",
        payload: { reason: "Native runtime stopped", exitKind: "graceful" },
      });
    };
    const requireSession = (threadId: string) => {
      const state = sessions.get(threadId);
      if (!state?.driver || state.stopped)
        throw new Error(`No active ${provider} session for this task`);
      return state;
    };
    const attempt = <A>(method: string, run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider,
            method,
            detail: cause instanceof Error ? cause.message : "Native runtime operation failed",
          }),
      });
    const unsupported = (method: string) =>
      attempt(method, async () => {
        throw new Error(`${method} is not supported by the native ${provider} bridge`);
      });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const state of sessions.values()) stop(state);
      }),
    );
    const adapter: ProviderAdapterShape<ProviderAdapterError> = {
      provider,
      getComposerCapabilities: () =>
        attempt("getComposerCapabilities", async () => ({
          provider,
          supportsSkillMentions: false,
          supportsSkillDiscovery: false,
          supportsNativeSlashCommandDiscovery: false,
          supportsPluginMentions: false,
          supportsPluginDiscovery: false,
          supportsRuntimeModelList: true,
          permissionModes: await nativePermissionModes(provider, await readProfile()),
        })),
      capabilities: {
        sessionModelSwitch: "in-session",
        conversationRollback: "restart-session",
        supportsRuntimeModelList: true,
        supportsSkillMentions: false,
        supportsSkillDiscovery: false,
        supportsNativeSlashCommandDiscovery: false,
        supportsPluginMentions: false,
        supportsPluginDiscovery: false,
        supportsTurnSteering: false,
        supportsLiveTurnDiffPatch: false,
      },
      startSession: (input) =>
        attempt("startSession", async () => {
          if (!input.cwd || !isAbsolute(input.cwd))
            throw new Error("Native sessions require an explicit absolute project directory");
          const directory = await stat(input.cwd).catch(() => null);
          if (!directory?.isDirectory())
            throw new Error(
              `Working folder is unavailable: ${input.cwd}. Choose an existing project folder before retrying.`,
            );
          const configured = await readProfile();
          if (sessions.has(input.threadId)) throw new Error("Native session already exists");
          if (input.modelSelection && input.modelSelection.provider !== provider)
            throw new Error("Model provider does not match runtime");
          const saved =
            input.resumeCursor === undefined
              ? undefined
              : Schema.decodeUnknownSync(NativeResumeCursor)(input.resumeCursor);
          const approvalPolicy = input.approvalPolicy ?? saved?.approvalPolicy;
          const sandboxMode = input.sandboxMode ?? saved?.sandboxMode;
          const providerOptions = mergeNativeProfile(
            provider,
            saved?.providerOptions ?? configured,
            input.providerOptions,
          );
          const effectiveInput = {
            ...input,
            providerOptions,
            ...(approvalPolicy !== undefined ? { approvalPolicy } : {}),
            ...(sandboxMode !== undefined ? { sandboxMode } : {}),
          };
          const now = new Date().toISOString();
          const state: SessionState = {
            profileOptions: providerOptions,
            session: {
              provider,
              threadId: input.threadId,
              cwd: input.cwd,
              ...(input.modelSelection ? { model: input.modelSelection.model } : {}),
              runtimeMode: input.runtimeMode,
              status: "connecting",
              createdAt: now,
              updatedAt: now,
            },
            stopped: false,
            completed: false,
            pending: new Map(),
          };
          sessions.set(input.threadId, state);
          const sink: NativeSink = {
            emit: (event) => {
              if (state.stopped || !state.session.activeTurnId || state.completed) return;
              if (event.type === "turn.completed") {
                complete(state, "interrupted");
                return;
              }
              emit(state, event);
            },
            fail: (error) => {
              if (!state.stopped) {
                recordPermissionRejection(provider, input.runtimeMode, providerOptions, error);
                complete(state, "failed", error.message);
                stop(state);
              }
            },
            request: (type, args, signal) => {
              if (
                state.stopped ||
                !state.session.activeTurnId ||
                state.completed ||
                signal?.aborted
              )
                return Promise.resolve("cancel");
              let requestPayload: Record<string, unknown>;
              try {
                requestPayload =
                  type === "tool_user_input"
                    ? { questions: nativeQuestions(args) }
                    : { requestType: type, args, detail: nativeApprovalDetail(args) };
              } catch (error) {
                return Promise.reject(error);
              }
              return new Promise((resolve) => {
                const id = randomUUID();
                const done = (answer: ProviderApprovalDecision | ProviderUserInputAnswers) => {
                  if (!state.pending.delete(id)) return;
                  clearTimeout(timer);
                  signal?.removeEventListener("abort", cancel);
                  emit(state, {
                    type: type === "tool_user_input" ? "user-input.resolved" : "request.resolved",
                    requestId: id,
                    payload:
                      type === "tool_user_input"
                        ? { answers: typeof answer === "string" ? {} : answer }
                        : {
                            requestType: type,
                            ...(typeof answer === "string"
                              ? { decision: answer }
                              : { resolution: answer }),
                          },
                  });
                  resolve(answer);
                };
                const cancel = () => done("cancel");
                const timer = setTimeout(cancel, 5 * 60_000);
                state.pending.set(id, { type, resolve: done });
                signal?.addEventListener("abort", cancel, { once: true });
                emit(state, {
                  type: type === "tool_user_input" ? "user-input.requested" : "request.opened",
                  requestId: id,
                  payload: requestPayload,
                });
              });
            },
          };
          try {
            state.driver = await factory(effectiveInput, sink);
            if (state.stopped) {
              state.driver.close();
              throw new Error("Session stopped during initialization");
            }
            state.session = {
              ...state.session,
              status: "ready",
              resumeCursor: {
                nativeSessionId: state.driver.id,
                ...(Object.keys(providerOptions[provider] ?? {}).length ? { providerOptions } : {}),
                ...(approvalPolicy !== undefined ? { approvalPolicy } : {}),
                ...(sandboxMode !== undefined ? { sandboxMode } : {}),
              },
            };
            emit(state, {
              type: "session.started",
              payload: { resume: state.session.resumeCursor },
            });
            return state.session;
          } catch (error) {
            recordPermissionRejection(provider, input.runtimeMode, providerOptions, error);
            stop(state);
            throw error;
          }
        }),
      sendTurn: (input) =>
        attempt("sendTurn", async () => {
          const state = requireSession(input.threadId);
          if (state.session.activeTurnId) throw new Error("A native turn is already running");
          if (!input.input?.trim()) throw new Error("A text prompt is required");
          if (
            input.attachments?.length ||
            input.skills?.length ||
            input.mentions?.length ||
            input.workTurnPolicy
          )
            throw new Error("This native bridge currently accepts text prompts only");
          if (input.modelSelection && input.modelSelection.provider !== provider)
            throw new Error("Model provider does not match runtime");
          if (input.interactionMode === "plan" && provider === "codex")
            throw new Error("Native Codex plan mode is not implemented");
          const turnId = TurnId.makeUnsafe(randomUUID());
          state.completed = false;
          state.session = {
            ...state.session,
            status: "running",
            activeTurnId: turnId,
            updatedAt: new Date().toISOString(),
          };
          emit(state, { type: "turn.started", payload: {} });
          void state.driver!.send(input).then(
            () => complete(state, "completed"),
            (error: unknown) => {
              if (!state.stopped) {
                recordPermissionRejection(
                  provider,
                  state.session.runtimeMode,
                  state.profileOptions,
                  error,
                );
                complete(
                  state,
                  "failed",
                  error instanceof Error ? error.message : "Native turn failed",
                );
                stop(state);
              }
            },
          );
          return { threadId: input.threadId, turnId, resumeCursor: state.session.resumeCursor };
        }),
      interruptTurn: (threadId) =>
        attempt("interruptTurn", async () => {
          const state = requireSession(threadId);
          try {
            await bounded(state.driver!.interrupt(), 5000);
          } finally {
            stop(state);
          }
        }),
      respondToRequest: (threadId, requestId, decision) =>
        attempt("respondToRequest", async () => {
          const pending = requireSession(threadId).pending.get(requestId);
          if (!pending || pending.type === "tool_user_input")
            throw new Error("Unknown or expired native approval request");
          pending.resolve(decision);
        }),
      respondToUserInput: (threadId, requestId, answers) =>
        attempt("respondToUserInput", async () => {
          const pending = requireSession(threadId).pending.get(requestId);
          if (!pending || pending.type !== "tool_user_input")
            throw new Error("Unknown or expired native input request");
          pending.resolve(answers);
        }),
      stopSession: (threadId) =>
        Effect.sync(() => {
          const state = sessions.get(threadId);
          if (state) stop(state);
        }),
      stopAll: () =>
        Effect.sync(() => {
          for (const state of sessions.values()) stop(state);
        }),
      listSessions: () => Effect.sync(() => [...sessions.values()].map((state) => state.session)),
      hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
      readThread: () => unsupported("readThread"),
      rollbackThread: () => unsupported("rollbackThread"),
      listModels: (input) =>
        attempt("listModels", async () => {
          const providerOptions = mergeNativeProfile(provider, await readProfile(), {
            [provider]: {
              ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}),
              ...(provider === "codex" && input.homePath ? { homePath: input.homePath } : {}),
              ...(provider === "cursor" && input.apiEndpoint
                ? { apiEndpoint: input.apiEndpoint }
                : {}),
            },
          });
          const existing = [...sessions.values()].find((state) => {
            const saved =
              state.session.resumeCursor === undefined
                ? undefined
                : Schema.decodeUnknownSync(NativeResumeCursor)(state.session.resumeCursor);
            return (
              state.session.cwd === input.cwd &&
              !state.stopped &&
              JSON.stringify(saved?.providerOptions) === JSON.stringify(providerOptions)
            );
          });
          if (existing?.driver) return existing.driver.models();
          // Discovery uses the current configured profile, never another active account/profile.
          const driver = await factory(
            {
              threadId: ThreadId.makeUnsafe(randomUUID()),
              provider,
              cwd: input.cwd ?? process.cwd(),
              runtimeMode: "approval-required",
              providerOptions,
            },
            { emit: () => {}, request: async () => "cancel", fail: () => {} },
          );
          try {
            return await driver.models();
          } finally {
            driver.close();
          }
        }),
      streamEvents: Stream.fromQueue(queue),
    };
    return adapter;
  });
