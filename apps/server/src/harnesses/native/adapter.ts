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
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type ProviderApprovalDecision,
  type ProviderListModelsResult,
  type ProviderModelDescriptor,
} from "@djl/contracts";
import {
  backendKeyLabel,
  modelBackendKey,
  modelBackendLabel,
  parseModelBackend,
} from "../../codingPlans/backend";
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
  /** Coding plan / Ollama backend the native session was started on (absent = default). */
  modelBackend: Schema.optional(Schema.String),
});

// Only Claude Code and Codex route plan or local models through a model-slug prefix.
const backendOf = (provider: NativeProvider, model: string | undefined) =>
  provider === "claudeAgent" || provider === "codex" ? parseModelBackend(model) : undefined;

const assertSameBackend = (
  provider: NativeProvider,
  current: string,
  model: string | undefined,
) => {
  const next = backendOf(provider, model);
  if (next && modelBackendKey(next) !== current)
    throw new Error(
      `This chat runs on ${backendKeyLabel(current)}. Start a new chat to use ${modelBackendLabel(next)}.`,
    );
};

// Waits briefly for a finishing turn to clear, so a late steer can start the next turn.
const settled = async (state: SessionState, turnId: string) => {
  for (let attempt = 0; attempt < 100 && state.session.activeTurnId === turnId; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 20));
};

interface SessionState {
  session: ProviderSession;
  modelBackend: string;
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
  /** Extra picker models (connected coding plans, local Ollama) appended to the live list. */
  extraModels: () => Promise<ReadonlyArray<ProviderModelDescriptor>> = async () => [],
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
    const validateTurn = (input: ProviderSendTurnInput, state: SessionState) => {
      if (!input.input?.trim()) throw new Error("A text prompt is required");
      // Groups pass attachment paths and skills to members as text; other bridges cannot.
      const acceptsFiles = provider === "group";
      if (
        (!acceptsFiles && (input.attachments?.length || input.skills?.length)) ||
        input.mentions?.length ||
        input.workTurnPolicy
      )
        throw new Error("This native bridge currently accepts text prompts only");
      if (input.modelSelection && input.modelSelection.provider !== provider)
        throw new Error("Model provider does not match runtime");
      if (input.modelSelection)
        assertSameBackend(provider, state.modelBackend, input.modelSelection.model);
      if (input.interactionMode === "plan" && provider === "codex")
        throw new Error("Native Codex plan mode is not implemented");
    };
    const beginTurn = (state: SessionState, input: ProviderSendTurnInput) => {
      validateTurn(input, state);
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
    };
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
        supportsTurnSteering: provider === "group" || provider === "codex",
        supportsLiveTurnDiffPatch: false,
      },
      startSession: (input) =>
        attempt("startSession", async () => {
          // Hosted chat never reads the local workspace; local runtimes still require it.
          if (provider !== "djlCloud") {
            if (!input.cwd || !isAbsolute(input.cwd))
              throw new Error("Native sessions require an explicit absolute project directory");
            const directory = await stat(input.cwd).catch(() => null);
            if (!directory?.isDirectory())
              throw new Error(
                `Working folder is unavailable: ${input.cwd}. Choose an existing project folder before retrying.`,
              );
          }
          const configured = await readProfile();
          if (sessions.has(input.threadId)) throw new Error("Native session already exists");
          if (input.modelSelection && input.modelSelection.provider !== provider)
            throw new Error("Model provider does not match runtime");
          const saved =
            input.resumeCursor === undefined
              ? undefined
              : Schema.decodeUnknownSync(NativeResumeCursor)(input.resumeCursor);
          const startBackend = backendOf(provider, input.modelSelection?.model);
          const modelBackend = startBackend ? modelBackendKey(startBackend) : "default";
          if (saved && startBackend)
            assertSameBackend(
              provider,
              saved.modelBackend ?? "default",
              input.modelSelection?.model,
            );
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
            modelBackend,
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
                ...(modelBackend !== "default" ? { modelBackend } : {}),
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
          return beginTurn(state, input);
        }),
      // A group round takes a new message at any time; a steer with no round running starts one.
      ...(provider === "group"
        ? {
            steerTurn: (input: ProviderSendTurnInput) =>
              attempt("steerTurn", async () => {
                const state = requireSession(input.threadId);
                if (!state.driver!.steer)
                  throw new Error(`The native ${provider} bridge cannot steer`);
                const turnId = state.session.activeTurnId;
                if (turnId) {
                  if (!input.input?.trim()) throw new Error("A text prompt is required");
                  if ((await state.driver!.steer(input)) !== false)
                    return {
                      threadId: input.threadId,
                      turnId,
                      resumeCursor: state.session.resumeCursor,
                    };
                  // The running turn was finishing; start the message as the next turn.
                  await settled(state, turnId);
                  if (state.session.activeTurnId)
                    throw new Error("A native turn is already running");
                }
                return beginTurn(state, input);
              }),
          }
        : {}),
      // Codex steers only a turn that is still running.
      ...(provider === "codex"
        ? {
            steerTurn: (input: ProviderSendTurnInput) =>
              attempt("steerTurn", async () => {
                const state = requireSession(input.threadId);
                const turnId = state.session.activeTurnId;
                if (!turnId || state.completed)
                  throw new Error("No active native turn available to steer");
                validateTurn(input, state);
                if (!state.driver?.steer)
                  throw new Error("The native driver does not support steering");
                await state.driver.steer(input);
                return {
                  threadId: input.threadId,
                  turnId,
                  resumeCursor: state.session.resumeCursor,
                };
              }),
          }
        : {}),
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
          const withExtras = async (result: ProviderListModelsResult) => {
            const extras = await extraModels().catch(() => []);
            return extras.length ? { ...result, models: [...result.models, ...extras] } : result;
          };
          const nativeModels = async (): Promise<ProviderListModelsResult> => {
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
          };
          try {
            return await withExtras(await nativeModels());
          } catch (error) {
            // A signed-out harness cannot list its own models, but coding-plan and local models
            // need no harness login, so they stay selectable.
            const extras = await extraModels().catch(() => []);
            if (extras.length) return { models: [...extras] };
            throw error;
          }
        }),
      streamEvents: Stream.fromQueue(queue),
    };
    return adapter;
  });
