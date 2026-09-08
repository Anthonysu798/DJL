import { Effect, Stream } from "effect";
import { ApprovalRequestId, ThreadId, type ProviderRuntimeEvent } from "@synara/contracts";
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
});
