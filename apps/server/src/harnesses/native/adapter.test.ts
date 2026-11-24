import { Effect, Stream } from "effect";
import { ApprovalRequestId, ThreadId, type ProviderRuntimeEvent } from "@djl/contracts";
import { describe, expect, it } from "vitest";
import { makeNativeAdapter } from "./adapter";
import { codexPermissions } from "./codex";
import type { NativeDriverFactory, NativeSink } from "./types";

const threadId = ThreadId.makeUnsafe("native-test");
const start = { threadId, cwd: "/tmp", runtimeMode: "approval-required" as const };
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

const resumeFactory = async (input: Parameters<import("./types").NativeDriverFactory>[0]) => ({
  id: input.resumeCursor
    ? (input.resumeCursor as { nativeSessionId: string }).nativeSessionId
    : "persisted-native-session",
  send: async () => new Promise<void>(() => {}),
  interrupt: async () => {},
  close: () => {},
  models: async () => ({ models: [] }),
});

describe("fresh native adapter lifecycle", () => {
  it("steers Codex on the existing canonical turn without a second send or start event", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sent: unknown[] = [],
            steered: unknown[] = [],
            events: ProviderRuntimeEvent[] = [];
          let release!: () => void;
          const adapter = yield* makeNativeAdapter("codex", async () => ({
            id: "steer-session",
            send: (input) => {
              sent.push(input);
              return new Promise<void>((resolve) => {
                release = resolve;
              });
            },
            steer: async (input) => {
              steered.push(input);
            },
            interrupt: async () => {},
            close: () => {},
            models: async () => ({ models: [] }),
          }));
          expect(adapter.capabilities.supportsTurnSteering).toBe(true);
          expect(adapter.steerTurn).toBeTypeOf("function");
          yield* Stream.runForEach(adapter.streamEvents, (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          ).pipe(Effect.forkChild);
          yield* adapter.startSession(start);
          const running = yield* adapter.sendTurn({ threadId, input: "original" });
          for (const invalid of [
            { input: "" },
            {
              input: "image",
              attachments: [
                {
                  type: "image" as const,
                  id: "qa-image",
                  name: "qa.png",
                  mimeType: "image/png",
                  sizeBytes: 1,
                },
              ],
            },
            { input: "foreign", modelSelection: { provider: "grok" as const, model: "other" } },
            { input: "plan", interactionMode: "plan" as const },
          ]) {
            expect((yield* Effect.exit(adapter.steerTurn!({ threadId, ...invalid })))._tag).toBe(
              "Failure",
            );
          }
          expect(steered).toHaveLength(0);
          const result = yield* adapter.steerTurn!({ threadId, input: "redirect" });
          expect(result.turnId).toBe(running.turnId);
          expect(sent).toHaveLength(1);
          expect(steered).toEqual([{ threadId, input: "redirect" }]);
          yield* Effect.promise(tick);
          expect(events.filter((event) => event.type === "turn.started")).toHaveLength(1);
          expect((yield* adapter.listSessions())[0]?.activeTurnId).toBe(running.turnId);
          release();
          yield* Effect.promise(tick);
          const failure = yield* Effect.exit(adapter.steerTurn!({ threadId, input: "late" }));
          expect(failure._tag).toBe("Failure");
          expect(steered).toHaveLength(1);
        }),
      ),
    );
  });

  it("does not advertise steering for other native providers", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = yield* makeNativeAdapter("djlCloud", resumeFactory);
          expect(adapter.capabilities.supportsTurnSteering).toBe(false);
          expect(adapter.steerTurn).toBeUndefined();
        }),
      ),
    );
  });

  it("starts hosted DJL Cloud chat without a local project folder", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = yield* makeNativeAdapter("djlCloud", resumeFactory);
          const session = yield* adapter.startSession({
            threadId,
            runtimeMode: "approval-required",
            modelSelection: { provider: "djlCloud", model: "cloud-live" },
          });
          expect(session.provider).toBe("djlCloud");
          yield* adapter.stopSession(threadId);
        }),
      ),
    );
  });
  it("preserves explicit restrictive Codex policies through serialized cursor recovery", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const calls: Parameters<NativeDriverFactory>[0][] = [];
          const factory: NativeDriverFactory = async (input) => {
            calls.push(input);
            return resumeFactory(input);
          };
          const original = yield* makeNativeAdapter("codex", factory);
          const saved = yield* original.startSession({
            ...start,
            runtimeMode: "full-access",
            sandboxMode: "read-only",
            approvalPolicy: "on-request",
          });
          yield* original.sendTurn({ threadId, input: "read" });
          yield* original.interruptTurn(threadId);
          const restarted = yield* makeNativeAdapter("codex", factory);
          const restored = yield* restarted.startSession({
            ...start,
            runtimeMode: "full-access",
            resumeCursor: JSON.parse(JSON.stringify(saved.resumeCursor)),
          });
          expect(codexPermissions(calls[1]!)).toEqual({
            approvalsReviewer: "user",
            sandbox: "read-only",
            approvalPolicy: "on-request",
          });
          expect(restored.resumeCursor).toEqual({
            nativeSessionId: "persisted-native-session",
            sandboxMode: "read-only",
            approvalPolicy: "on-request",
          });
        }),
      ),
    );
  });

  it("restores the saved provider cursor in a fresh adapter after interrupt or restart", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const original = yield* makeNativeAdapter("codex", resumeFactory);
          const saved = yield* original.startSession(start);
          yield* original.sendTurn({ threadId, input: "hello" });
          yield* original.interruptTurn(threadId);
          expect(yield* original.hasSession(threadId)).toBe(false);
          const restarted = yield* makeNativeAdapter("codex", resumeFactory);
          const restored = yield* restarted.startSession({
            ...start,
            resumeCursor: saved.resumeCursor,
          });
          expect(restored.resumeCursor).toEqual({ nativeSessionId: "persisted-native-session" });
          expect(restored.status).toBe("ready");
        }),
      ),
    );
  });

  it("streams canonical events, rejects overlapping turns and scopes approvals to the task", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let sink!: NativeSink;
          let resolveTurn!: () => void;
          const events: ProviderRuntimeEvent[] = [];
          const adapter = yield* makeNativeAdapter("codex", async (_input, value) => {
            sink = value;
            return {
              id: "official-session",
              send: () =>
                new Promise<void>((resolve) => {
                  resolveTurn = resolve;
                }),
              interrupt: async () => {},
              close: () => {},
              models: async () => ({ models: [] }),
            };
          });
          yield* Stream.runForEach(adapter.streamEvents, (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          ).pipe(Effect.forkChild);
          yield* Effect.promise(async () => {
            const session = await Effect.runPromise(adapter.startSession(start));
            expect(session.resumeCursor).toEqual({ nativeSessionId: "official-session" });
            await Effect.runPromise(adapter.sendTurn({ threadId, input: "Hello" }));
            await expect(
              Effect.runPromise(adapter.sendTurn({ threadId, input: "Another" })),
            ).rejects.toThrow("already running");
            sink.emit({
              type: "content.delta",
              itemId: "text",
              payload: { streamKind: "assistant_text", delta: "Hello back" },
            });
            let answered = false;
            const approval = sink
              .request("command_execution_approval", { command: "echo hello" })
              .then((answer) => {
                answered = true;
                return answer;
              });
            await tick();
            expect(answered).toBe(false);
            const request = events.find((event) => event.type === "request.opened")!;
            await expect(
              Effect.runPromise(
                adapter.respondToRequest(
                  ThreadId.makeUnsafe("wrong-task"),
                  ApprovalRequestId.makeUnsafe(request.requestId!),
                  "accept",
                ),
              ),
            ).rejects.toThrow("No active");
            await Effect.runPromise(
              adapter.respondToRequest(
                threadId,
                ApprovalRequestId.makeUnsafe(request.requestId!),
                "decline",
              ),
            );
            expect(await approval).toBe("decline");
            await expect(
              Effect.runPromise(
                adapter.respondToRequest(
                  threadId,
                  ApprovalRequestId.makeUnsafe(request.requestId!),
                  "accept",
                ),
              ),
            ).rejects.toThrow("expired");
            resolveTurn();
            await tick();
            expect(
              events.some(
                (event) => event.type === "content.delta" && event.payload.delta === "Hello back",
              ),
            ).toBe(true);
            expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
          });
        }),
      ),
    );
  });

  it("interrupts, cancels pending permission and disposes a session exactly once", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let sink!: NativeSink;
          let stopped = 0;
          let interrupted = 0;
          const adapter = yield* makeNativeAdapter("cursor", async (_input, value) => {
            sink = value;
            return {
              id: "cursor-session",
              send: async () => new Promise<void>(() => {}),
              interrupt: async () => {
                interrupted++;
              },
              close: () => {
                stopped++;
              },
              models: async () => ({ models: [] }),
            };
          });
          yield* adapter.startSession(start);
          yield* adapter.sendTurn({ threadId, input: "Edit file" });
          const approval = sink.request("file_change_approval", {});
          yield* adapter.interruptTurn(threadId);
          expect(yield* Effect.promise(() => approval)).toBe("cancel");
          expect(yield* adapter.hasSession(threadId)).toBe(false);
          yield* adapter.stopAll();
          expect(interrupted).toBe(1);
          expect(stopped).toBe(1);
        }),
      ),
    );
  });

  it("fails closed for native startup errors, unsupported inputs and expired approvals", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = yield* makeNativeAdapter("claudeAgent", async () => {
            throw new Error("Login required in official runtime");
          });
          yield* Effect.promise(async () => {
            await expect(
              Effect.runPromise(adapter.startSession({ ...start, cwd: "relative" })),
            ).rejects.toThrow("absolute project directory");
            await expect(
              Effect.runPromise(
                adapter.startSession({ ...start, cwd: "/tmp/djl-missing-workspace-" + Date.now() }),
              ),
            ).rejects.toThrow("Working folder is unavailable");
            await expect(Effect.runPromise(adapter.startSession(start))).rejects.toThrow(
              "Login required",
            );
            expect(await Effect.runPromise(adapter.hasSession(threadId))).toBe(false);
            await expect(Effect.runPromise(adapter.rollbackThread(threadId, 1))).rejects.toThrow(
              "not supported",
            );
          });
        }),
      ),
    );
  });

  it("lists plan and local models and refuses to switch a running chat to another backend", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started: string[] = [];
          const factory: NativeDriverFactory = async (input) => {
            started.push(input.modelSelection?.model ?? "");
            return {
              ...(await resumeFactory(input)),
              send: async () => {},
              models: async () => ({ models: [{ slug: "claude-sonnet-4-6", name: "Sonnet" }] }),
            };
          };
          const adapter = yield* makeNativeAdapter(
            "claudeAgent",
            factory,
            async () => ({}),
            async () => [
              {
                slug: "plan/zai-coding-plan/glm-5.3",
                name: "GLM-5.3",
                upstreamProviderName: "Z.AI Coding Plan",
              },
            ],
          );
          const listed = yield* adapter.listModels!({ provider: "claudeAgent", cwd: "/tmp" });
          expect(listed.models.map((model) => model.slug)).toEqual([
            "claude-sonnet-4-6",
            "plan/zai-coding-plan/glm-5.3",
          ]);

          yield* adapter.startSession({
            ...start,
            modelSelection: { provider: "claudeAgent", model: "plan/zai-coding-plan/glm-5.3" },
          });
          const sameBackend = yield* adapter
            .sendTurn({
              threadId,
              input: "hi",
              modelSelection: {
                provider: "claudeAgent",
                model: "plan/zai-coding-plan/glm-5.3-flash",
              },
            })
            .pipe(Effect.result);
          expect(sameBackend._tag).toBe("Success");
          yield* Effect.promise(tick);
          const switched = yield* adapter
            .sendTurn({
              threadId,
              input: "hi",
              modelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
            })
            .pipe(Effect.flip);
          expect(switched.message).toContain("Start a new chat to use the default provider");
          const sessions = yield* adapter.listSessions();
          const cursor = sessions[0]?.resumeCursor as { modelBackend?: string };
          expect(cursor.modelBackend).toBe("plan:zai-coding-plan");
          yield* adapter.stopSession(threadId);

          const resumed = yield* adapter
            .startSession({
              ...start,
              resumeCursor: cursor,
              modelSelection: { provider: "claudeAgent", model: "ollama/llama3.2" },
            })
            .pipe(Effect.flip);
          expect(resumed.message).toContain("This chat runs on Z.AI Coding Plan");
          // The first, model-less start is listModels' discovery driver.
          expect(started.filter(Boolean)).toEqual(["plan/zai-coding-plan/glm-5.3"]);
        }),
      ),
    );
  });

  it("still lists plan and local models when the signed-out harness cannot list its own", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = yield* makeNativeAdapter(
            "claudeAgent",
            async () => {
              throw new Error("Not logged in");
            },
            async () => ({}),
            async () => [{ slug: "ollama/qwen3:1.7b", name: "qwen3:1.7b" }],
          );
          const listed = yield* adapter.listModels!({ provider: "claudeAgent", cwd: "/tmp" });
          expect(listed.models.map((model) => model.slug)).toEqual(["ollama/qwen3:1.7b"]);
          const plain = yield* makeNativeAdapter("claudeAgent", async () => {
            throw new Error("Not logged in");
          });
          const failure = yield* plain.listModels!({ provider: "claudeAgent", cwd: "/tmp" }).pipe(
            Effect.flip,
          );
          expect(failure.message).toContain("Not logged in");
        }),
      ),
    );
  });
});
