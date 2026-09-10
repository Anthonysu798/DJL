import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@synara/contracts";
import { Effect, Fiber, Layer, Stream } from "effect";
import { expect, it, vi } from "vitest";
import { prepareInstalledOpenCodeFixture } from "../../../../scripts/lib/installed-opencode-fixture.ts";

import { ServerConfig } from "../config.ts";
import { makeOpenCodeAdapterLive } from "./Layers/OpenCodeAdapter.ts";
import { OpenCodeAdapter } from "./Services/OpenCodeAdapter.ts";

interface ModelRequest {
  tools?: Array<{ function: { name: string } }>;
  tool_choice?: unknown;
  messages?: unknown;
}

it.skipIf(!process.env.DJL_TEST_OPENCODE_BINARY)(
  "runs isolated Work policy and textual tool repair through the real installed adapter",
  async () => {
    const binary = process.env.DJL_TEST_OPENCODE_BINARY!;
    const root = await realpath(await mkdtemp(join(tmpdir(), "djl-installed-adapter-")));
    const project = join(root, "project");
    const marker = "DJL_ADAPTER_UNTRUSTED_PROJECT_INSTRUCTION";
    const resultMarker = "DJL_ADAPTER_READ_RESULT";
    const requests: ModelRequest[] = [];
    const mock = createServer(async (request, response) => {
      try {
        if (request.method !== "POST") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({ object: "list", data: [{ id: "parity", object: "model" }] }),
          );
          return;
        }
        let body = "";
        for await (const chunk of request) body += String(chunk);
        requests.push(JSON.parse(body) as ModelRequest);
        const text =
          requests.length === 1
            ? JSON.stringify({
                name: "read",
                arguments: { filePath: join(project, "fixture.txt") },
              })
            : "Fixture read completed.";
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const [delta, finishReason] of [
          [{ role: "assistant" }, null],
          [{ content: text }, null],
          [{}, "stop"],
        ] as const) {
          response.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-adapter",
              object: "chat.completion.chunk",
              created: 1,
              model: "parity",
              choices: [{ index: 0, delta, finish_reason: finishReason }],
            })}\n\n`,
          );
        }
        response.end("data: [DONE]\n\n");
      } catch {
        response.writeHead(500);
        response.end("Invalid loopback fixture request");
      }
    });
    try {
      await mkdir(project);
      await prepareInstalledOpenCodeFixture(join(root, "config"));
      await writeFile(join(project, "AGENTS.md"), marker);
      await writeFile(join(project, "fixture.txt"), resultMarker);
      const listening = once(mock, "listening");
      mock.listen(0, "127.0.0.1");
      await listening;
      const address = mock.address();
      if (!address || typeof address === "string")
        throw new Error("Missing loopback fixture address");
      const env = {
        HOME: root,
        USERPROFILE: root,
        APPDATA: join(root, "appdata"),
        LOCALAPPDATA: join(root, "localappdata"),
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_DATA_HOME: join(root, "data"),
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_STATE_HOME: join(root, "state"),
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        OPENCODE_DISABLE_MODELS_FETCH: "true",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          autoupdate: false,
          enabled_providers: ["ollama"],
          provider: {
            ollama: {
              npm: "@ai-sdk/openai-compatible",
              name: "Loopback adapter fixture",
              options: { baseURL: `http://127.0.0.1:${address.port}/v1` },
              models: {
                parity: { name: "Parity", tool_call: true, limit: { context: 32768, output: 512 } },
              },
            },
          },
          permission: { "*": "allow" },
        }),
      };
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      // Prevent caller-provided inline settings or alternative config paths from escaping the fixture.
      vi.stubEnv("OPENCODE_CONFIG", undefined);
      vi.stubEnv("OPENCODE_CONFIG_DIR", undefined);
      const events = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const adapter = yield* OpenCodeAdapter;
            const eventsFiber = yield* Stream.runCollect(
              Stream.takeUntil(
                adapter.streamEvents,
                (event) =>
                  event.type === "turn.completed" ||
                  event.type === "turn.aborted" ||
                  event.type === "runtime.error",
              ),
            ).pipe(Effect.forkChild);
            const threadId = ThreadId.makeUnsafe("installed-adapter-work-fixture");
            const modelSelection = { provider: "opencode" as const, model: "ollama/parity" };
            yield* adapter.startSession({
              provider: "opencode",
              threadId,
              cwd: project,
              runtimeMode: "full-access",
              providerOptions: { opencode: { binaryPath: binary } },
              modelSelection,
            });
            yield* adapter.sendTurn({
              threadId,
              input: `Read ${join(project, "fixture.txt")} and report the result.`,
              attachments: [],
              modelSelection,
              workTurnPolicy: {
                route: "file",
                visibleTools: ["read"],
                requireSuccessfulTool: true,
                evidenceRequired: true,
                instructionScope: "work-isolated",
              },
            });
            return Array.from(yield* Fiber.join(eventsFiber));
          }).pipe(
            Effect.provide(
              makeOpenCodeAdapterLive().pipe(
                Layer.provideMerge(ServerConfig.layerTest(project, join(root, "djl"))),
                Layer.provideMerge(NodeServices.layer),
              ),
            ),
            Effect.timeout("75 seconds"),
          ),
        ),
      );
      expect(events.at(-1), JSON.stringify(events)).toMatchObject({
        type: "turn.completed",
        payload: { state: "completed" },
      });
      expect(requests).toHaveLength(2);
      expect(requests[0]?.tools?.map((tool) => tool.function.name)).toEqual(["read"]);
      expect(requests[0]?.tool_choice).toBe("required");
      expect(JSON.stringify(requests)).not.toContain(marker);
      expect(JSON.stringify(requests[1]?.messages)).toContain(resultMarker);
      expect(
        events.some(
          (event) =>
            event.type === "item.completed" &&
            event.payload.status === "completed" &&
            typeof event.payload.data === "object" &&
            event.payload.data !== null &&
            "toolName" in event.payload.data &&
            event.payload.data.toolName === "read",
        ),
        JSON.stringify(events),
      ).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      mock.closeAllConnections();
      await new Promise<void>((resolve) => mock.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
  90_000,
);

it.skipIf(!process.env.DJL_TEST_OPENCODE_BINARY)(
  "migrates a legacy transcript on actual adapter resume and resumes the same ID after restart",
  async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { readdir, readFile } = await import("node:fs/promises");
    const execute = promisify(execFile);
    const binary = process.env.DJL_TEST_OPENCODE_BINARY!;
    const root = await realpath(await mkdtemp(join(tmpdir(), "djl-adapter-resume-")));
    const project = join(root, "project");
    const baseDir = join(root, "djl");
    const legacyRoot = join(baseDir, "userdata", "opencode");
    const id = "ses_abcdef0123456789abcdef012346";
    try {
      await mkdir(project);
      await prepareInstalledOpenCodeFixture(join(root, "config"));
      await prepareInstalledOpenCodeFixture(join(legacyRoot, "config"));
      const isolatedEnv = {
        HOME: root,
        USERPROFILE: root,
        APPDATA: join(root, "appdata"),
        LOCALAPPDATA: join(root, "localappdata"),
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_DATA_HOME: join(root, "shared-data"),
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_STATE_HOME: join(root, "state"),
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        OPENCODE_DISABLE_MODELS_FETCH: "true",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          autoupdate: false,
          enabled_providers: ["ollama"],
          provider: {
            ollama: {
              npm: "@ai-sdk/openai-compatible",
              name: "Resume fixture",
              options: { baseURL: "http://127.0.0.1:9/v1" },
              models: {
                parity: { name: "Parity", tool_call: true, limit: { context: 32768, output: 512 } },
              },
            },
          },
          permission: { "*": "allow" },
        }),
      };
      for (const [key, value] of Object.entries(isolatedEnv)) vi.stubEnv(key, value);
      vi.stubEnv("OPENCODE_CONFIG", undefined);
      vi.stubEnv("OPENCODE_CONFIG_DIR", undefined);
      const legacyEnv = {
        ...process.env,
        XDG_DATA_HOME: join(legacyRoot, "data"),
        XDG_CONFIG_HOME: join(legacyRoot, "config"),
        XDG_STATE_HOME: join(legacyRoot, "state"),
        XDG_CACHE_HOME: join(legacyRoot, "cache"),
      };
      const fixturePath = join(root, "legacy.json");
      await writeFile(
        fixturePath,
        JSON.stringify({
          info: {
            id,
            slug: "legacy-adapter-fixture",
            version: "1.18.29",
            projectID: "global",
            directory: project,
            title: "Preserved legacy conversation",
            time: { created: 1700000000000, updated: 1700000000000 },
          },
          messages: [
            {
              info: {
                id: "msg_abcdef0123456789abcdef012346",
                sessionID: id,
                role: "user",
                time: { created: 1700000000000 },
                agent: "build",
                model: { providerID: "openai", modelID: "gpt-4" },
              },
              parts: [
                {
                  id: "prt_abcdef0123456789abcdef012346",
                  sessionID: id,
                  messageID: "msg_abcdef0123456789abcdef012346",
                  type: "text",
                  text: "Retain this historical adapter transcript.",
                },
              ],
            },
          ],
        }),
      );
      await execute(binary, ["import", fixturePath], { cwd: project, env: legacyEnv });
      const original = JSON.parse(
        (await execute(binary, ["export", id], { cwd: project, env: legacyEnv })).stdout,
      );
      const resume = () =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const adapter = yield* OpenCodeAdapter;
              return yield* adapter.startSession({
                provider: "opencode",
                threadId: ThreadId.makeUnsafe("legacy-resume-fixture"),
                cwd: project,
                runtimeMode: "full-access",
                providerOptions: { opencode: { binaryPath: binary } },
                modelSelection: { provider: "opencode", model: "ollama/parity" },
                resumeCursor: { openCodeSessionId: id, cwd: project },
              });
            }).pipe(
              Effect.provide(
                makeOpenCodeAdapterLive().pipe(
                  Layer.provideMerge(ServerConfig.layerTest(project, baseDir)),
                  Layer.provideMerge(NodeServices.layer),
                ),
              ),
              Effect.timeout("60 seconds"),
            ),
          ),
        );
      const first = await resume();
      expect(first.resumeCursor).toMatchObject({ openCodeSessionId: id, cwd: project });
      const shared = JSON.parse(
        (await execute(binary, ["export", id], { cwd: project, env: process.env })).stdout,
      );
      expect(shared.info).toMatchObject({ id, title: original.info.title });
      expect(shared.messages).toEqual(original.messages);
      const migrationRoot = join(legacyRoot, "installed-cli-migrations");
      const files = (await readdir(migrationRoot, { recursive: true })).toSorted();
      const completed = files.find((file) => file.endsWith("complete.json"));
      expect(completed).toBeDefined();
      const record = await readFile(join(migrationRoot, completed!), "utf8");
      const second = await resume();
      expect(second.resumeCursor).toMatchObject({ openCodeSessionId: id, cwd: project });
      expect((await readdir(migrationRoot, { recursive: true })).toSorted()).toEqual(files);
      expect(await readFile(join(migrationRoot, completed!), "utf8")).toBe(record);
      const resumed = JSON.parse(
        (await execute(binary, ["export", id], { cwd: project, env: process.env })).stdout,
      );
      expect(resumed.messages).toEqual(original.messages);
      const legacy = JSON.parse(
        (await execute(binary, ["export", id], { cwd: project, env: legacyEnv })).stdout,
      );
      expect(legacy.messages).toEqual(original.messages);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  },
  90_000,
);
