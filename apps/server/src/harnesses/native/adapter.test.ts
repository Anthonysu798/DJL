import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { Effect, Stream } from "effect";
import { ApprovalRequestId, ThreadId, type ProviderRuntimeEvent } from "@djl/contracts";
import { describe, expect, it } from "vitest";
import { makeNativeAdapter } from "./adapter";
import { codexPermissions } from "./codex";
import type { NativeDriverFactory, NativeProvider, NativeSink, NativeTurn } from "./types";

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

  it("replaces a live session when the chat is restarted, without announcing an exit", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const closed: string[] = [];
          const events: ProviderRuntimeEvent[] = [];
          let started = 0;
          const adapter = yield* makeNativeAdapter("claudeAgent", async () => {
            const id = `native-${(started += 1)}`;
            return {
              id,
              send: async () => {},
              interrupt: async () => {},
              close: () => {
                closed.push(id);
              },
              models: async () => ({ models: [] }),
            };
          });
          yield* Stream.runForEach(adapter.streamEvents, (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          ).pipe(Effect.forkChild);
          yield* adapter.startSession(start);
          // A permission-mode change restarts the chat while its session is still alive.
          const restarted = yield* adapter.startSession({ ...start, runtimeMode: "full-access" });
          yield* Effect.promise(tick);
          expect(restarted.runtimeMode).toBe("full-access");
          expect(closed).toEqual(["native-1"]);
          expect(yield* adapter.listSessions()).toHaveLength(1);
          expect(events.some((event) => event.type === "session.exited")).toBe(false);
          // The replacement must still take a turn: the retired session may not delete it.
          yield* adapter.sendTurn({ threadId, input: "hello" });
        }),
      ),
    );
  });

  describe("attachments", () => {
    const imageId = "native-test-11111111-1111-4111-8111-111111111111";
    const fileId = "native-test-22222222-2222-4222-8222-222222222222";
    const image = {
      type: "image" as const,
      id: imageId as never,
      name: "screen.png",
      mimeType: "image/png",
      sizeBytes: 3,
    };
    const file = {
      type: "file" as const,
      id: fileId as never,
      name: "notes.v2.md",
      mimeType: "text/markdown",
      sizeBytes: 5,
    };
    const scenario = async (
      provider: NativeProvider,
      attachments: ReadonlyArray<unknown>,
      saved: Record<string, Buffer> = {},
    ) => {
      const attachmentsDir = mkdtempSync(join(tmpdir(), "djl-native-attachments-"));
      writeFileSync(join(attachmentsDir, `${imageId}.png`), "png");
      writeFileSync(join(attachmentsDir, `${fileId}.md`), "notes");
      for (const [name, bytes] of Object.entries(saved))
        writeFileSync(join(attachmentsDir, name), bytes);
      const sent: NativeTurn[] = [];
      const extracted: string[] = [];
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const adapter = yield* makeNativeAdapter(
              provider,
              async () => ({
                id: "native",
                send: async (turn) => {
                  sent.push(turn);
                  // Read now: the extracted text lives only as long as the adapter.
                  for (const file of turn.files ?? [])
                    if (file.textPath) extracted.push(readFileSync(file.textPath, "utf8"));
                },
                interrupt: async () => {},
                close: () => {},
                models: async () => ({ models: [] }),
              }),
              undefined,
              undefined,
              undefined,
              attachmentsDir,
            );
            yield* adapter.startSession(start);
            yield* adapter.sendTurn({
              threadId,
              input: "what is this?",
              attachments: attachments as never,
            });
            yield* Effect.promise(tick);
          }),
        ),
      );
      return { sent, attachmentsDir, extracted };
    };

    it("lists every attachment's saved path and hands images to the driver", async () => {
      const { sent, attachmentsDir } = await scenario("claudeAgent", [image, file]);
      expect(sent).toHaveLength(1);
      const imagePath = join(attachmentsDir, `${imageId}.png`);
      expect(sent[0]!.input).toMatch(/^what is this\?\n\n<attached_files>/);
      expect(sent[0]!.input).toContain(`"screen.png" - image/png - 3 B - ${imagePath}`);
      expect(sent[0]!.input).toContain(join(attachmentsDir, `${fileId}.md`));
      expect(sent[0]!.files).toEqual([
        { path: imagePath, name: "screen.png", mimeType: "image/png", sizeBytes: 3, image: true },
        {
          path: join(attachmentsDir, `${fileId}.md`),
          name: "notes.v2.md",
          mimeType: "text/markdown",
          sizeBytes: 5,
          image: false,
        },
      ]);
    });

    it("adds the text of an Office file beside its path, for runtimes that cannot open one", async () => {
      // A one-entry stored ZIP is the smallest valid .docx body.
      const name = Buffer.from("word/document.xml");
      const data = Buffer.from(
        "<w:document><w:body><w:p><w:r><w:t>Quarterly revenue rose</w:t></w:r></w:p></w:body></w:document>",
      );
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt32LE(crc32(data) >>> 0, 14);
      local.writeUInt32LE(data.byteLength, 18);
      local.writeUInt32LE(data.byteLength, 22);
      local.writeUInt16LE(name.byteLength, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt32LE(crc32(data) >>> 0, 16);
      central.writeUInt32LE(data.byteLength, 20);
      central.writeUInt32LE(data.byteLength, 24);
      central.writeUInt16LE(name.byteLength, 28);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(1, 8);
      end.writeUInt16LE(1, 10);
      end.writeUInt32LE(central.byteLength + name.byteLength, 12);
      end.writeUInt32LE(local.byteLength + name.byteLength + data.byteLength, 16);
      const docx = Buffer.concat([local, name, data, central, name, end]);
      const docxId = "native-test-44444444-4444-4444-8444-444444444444";
      const { sent, attachmentsDir, extracted } = await scenario(
        "codex",
        [
          {
            type: "file",
            id: docxId,
            name: "report.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: docx.byteLength,
          },
        ],
        { [`${docxId}.docx`]: docx },
      );
      const report = sent[0]!.files![0]!;
      expect(report.path).toBe(join(attachmentsDir, `${docxId}.docx`));
      expect(extracted.join()).toContain("Quarterly revenue rose");
      expect(sent[0]!.input).toContain(`${report.path} (text extracted to ${report.textPath})`);
    });

    it("leaves a group turn alone, because the group lists the paths for its members", async () => {
      const { sent } = await scenario("group", [image]);
      expect(sent[0]!.input).toBe("what is this?");
      expect(sent[0]!.files).toBeUndefined();
    });

    it("stops with a readable reason when a file is gone or the model cannot see images", async () => {
      await expect(
        scenario("claudeAgent", [
          { ...image, id: "native-test-33333333-3333-4333-8333-333333333333" },
        ]),
      ).rejects.toThrow("'screen.png' is no longer available");
      await expect(scenario("deepseek", [image])).rejects.toThrow("cannot read images");
      await expect(scenario("djlCloud", [file])).rejects.toThrow("cannot open attached files");
    });
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
