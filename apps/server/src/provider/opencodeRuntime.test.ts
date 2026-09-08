// FILE: opencodeRuntime.test.ts
// Purpose: Covers OpenCode runtime parsing and local server startup diagnostics.
// Layer: Provider runtime tests
// Exports: Vitest suites for opencodeRuntime.ts

import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Duration, Effect, Exit, Layer, Scope, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { TestClock } from "effect/testing";
import type { ChatAttachment } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  buildOpenCodePermissionRules,
  buildOpenCodeServerProcessEnv,
  buildOpenCodeProcessInvocation,
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  OpenCodeRuntimeLive,
  OPENCODE_LOCAL_SERVER_IDLE_TTL_MS,
  parseOpenCodeCliModelsOutput,
  parseOpenCodeCredentialProviderIDs,
  resolveDjlOpenCodeBinaryPath,
  resolveOpenCodeAuthFilePath,
  sendOpenCodePromptAsync,
  toOpenCodeFileParts,
} from "./opencodeRuntime.ts";

// Pool/lifecycle unit tests use a synthetic process; protocol has separate live tests.
vi.mock("./openCodeInstalledProtocol", () => ({
  assertOpenCodeServerCompatibility: async () => undefined,
}));

const encoder = new TextEncoder();

describe("buildOpenCodePermissionRules", () => {
  it("automatically allows normal actions while retaining OpenCode safety guards", () => {
    expect(buildOpenCodePermissionRules("auto-approval" as never)).toEqual([
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "external_directory", pattern: "*", action: "ask" },
      { permission: "doom_loop", pattern: "*", action: "ask" },
    ]);
  });

  it("allows edits while asking for other OpenCode permissions", () => {
    expect(buildOpenCodePermissionRules("accept-edits" as never)).toEqual([
      { permission: "*", pattern: "*", action: "ask" },
      { permission: "edit", pattern: "*", action: "allow" },
      { permission: "question", pattern: "*", action: "allow" },
    ]);
  });
});

describe("sendOpenCodePromptAsync", () => {
  it("keeps fork-only policy fields off the official OpenCode wire format", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      client: {
        post: async (input: Record<string, unknown>) => {
          requests.push(input);
          return { data: null };
        },
      },
      session: {
        promptAsync: async () => {
          throw new Error("generated SDK promptAsync must not be used");
        },
      },
    };

    await sendOpenCodePromptAsync(client as never, {
      sessionID: "ses_test",
      parts: [{ type: "text", text: "Check RAM." }],
      visibleTools: ["djl_system_info"],
      requiredToolCall: true,
      instructionScope: "work-isolated",
    });

    expect(requests).toEqual([
      {
        url: "/session/{sessionID}/prompt_async",
        path: { sessionID: "ses_test" },
        body: {
          parts: [{ type: "text", text: "Check RAM." }],
        },
        headers: { "Content-Type": "application/json" },
      },
    ]);
  });
});

function mockOpenCodeServerHandle(input: {
  stdout: string;
  stderr: string;
  exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode, never>;
  kill?: () => Effect.Effect<void, never>;
}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: input.exitCode ?? Effect.never,
    isRunning: Effect.succeed(true),
    kill: input.kill ?? (() => Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(input.stdout)),
    stderr: Stream.make(encoder.encode(input.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockOpenCodeServerSpawnerLayer(input: { stdout: string; stderr: string }) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.succeed(mockOpenCodeServerHandle(input))),
  );
}

function mockPooledOpenCodeServerSpawnerLayer(state: {
  spawnUrls: Array<string>;
  spawnCwds?: Array<string | undefined>;
  killUrls: Array<string>;
}) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cmd = command as unknown as {
        options?: { cwd?: string };
      };
      const url = `http://127.0.0.1:${59000 + state.spawnUrls.length}`;
      state.spawnUrls.push(url);
      state.spawnCwds?.push(cmd.options?.cwd);
      return Effect.succeed(
        mockOpenCodeServerHandle({
          stdout: `opencode server listening on ${url}\n`,
          stderr: "",
          kill: () =>
            Effect.sync(() => {
              state.killUrls.push(url);
            }),
        }),
      );
    }),
  );
}

const advanceOpenCodePoolIdleClock = Effect.gen(function* () {
  yield* Effect.yieldNow;
  yield* TestClock.adjust(Duration.millis(OPENCODE_LOCAL_SERVER_IDLE_TTL_MS + 1));
  yield* Effect.yieldNow;
});

const advanceOpenCodePoolAlmostToIdle = Effect.gen(function* () {
  yield* Effect.yieldNow;
  yield* TestClock.adjust(Duration.millis(OPENCODE_LOCAL_SERVER_IDLE_TTL_MS - 1));
  yield* Effect.yieldNow;
});

function openCodeRuntimePoolTestLayer(state: {
  spawnUrls: Array<string>;
  killUrls: Array<string>;
}) {
  return Layer.merge(
    OpenCodeRuntimeLive.pipe(Layer.provide(mockPooledOpenCodeServerSpawnerLayer(state))),
    TestClock.layer(),
  );
}

describe("toOpenCodeFileParts", () => {
  it("materializes image attachments as SDK file parts", () => {
    const attachment = {
      type: "image",
      id: "thread-attachment-image",
      name: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 12,
    } satisfies ChatAttachment;

    expect(
      toOpenCodeFileParts({
        attachments: [attachment],
        resolveAttachmentPath: () => "/tmp/synara-attachments/screenshot.png",
      }),
    ).toEqual([
      {
        type: "file",
        mime: "image/png",
        filename: "screenshot.png",
        url: "file:///tmp/synara-attachments/screenshot.png",
      },
    ]);
  });

  it("leaves generic files for prompt-path projection", () => {
    const attachment = {
      type: "file",
      id: "thread-attachment-file",
      name: "notes.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 12,
    } satisfies ChatAttachment;

    expect(
      toOpenCodeFileParts({
        attachments: [attachment],
        resolveAttachmentPath: () => "/tmp/synara-attachments/notes.docx",
      }),
    ).toEqual([]);
  });
});

describe("buildOpenCodeServerProcessEnv", () => {
  it("shares CLI config and credentials while retaining process-local authentication", () => {
    const env = buildOpenCodeServerProcessEnv({
      managedRootDir: "/tmp/djl/legacy",
      serverPassword: "process-secret",
      baseEnv: {
        HOME: "/Users/example",
        XDG_DATA_HOME: "/shared/data",
        OPENAI_API_KEY: "shared",
        OPENCODE_CONFIG: "/shared/config.json",
        OPENCODE_SERVER_USERNAME: "custom-user",
        DJL_MANAGED_AUTH: "1",
      },
    });
    expect(env).toMatchObject({
      HOME: "/Users/example",
      XDG_DATA_HOME: "/shared/data",
      OPENAI_API_KEY: "shared",
      OPENCODE_CONFIG: "/shared/config.json",
      OPENCODE_SERVER_PASSWORD: "process-secret",
      OPENCODE_SERVER_USERNAME: "opencode",
    });
    expect(env.DJL_MANAGED_AUTH).toBeUndefined();
    expect(env.XDG_CONFIG_HOME).toBeUndefined();
  });
});

describe("buildOpenCodeProcessInvocation", () => {
  it("executes installed CLI paths directly without a bundled TypeScript fallback", () => {
    expect(buildOpenCodeProcessInvocation("/opt/OpenCode CLI/opencode", ["--version"])).toEqual({
      command: "/opt/OpenCode CLI/opencode",
      args: ["--version"],
    });
  });
  it("preserves a Windows npm shim for the existing safe process launcher", () => {
    expect(
      buildOpenCodeProcessInvocation("C:\\Program Files\\OpenCode\\opencode.cmd", ["serve"]),
    ).toEqual({ command: "C:\\Program Files\\OpenCode\\opencode.cmd", args: ["serve"] });
  });
});

describe("resolveDjlOpenCodeBinaryPath", () => {
  it("honors a configured executable before PATH", () => {
    expect(resolveDjlOpenCodeBinaryPath(" /opt/OpenCode CLI/opencode ")).toBe(
      "/opt/OpenCode CLI/opencode",
    );
  });
  it("uses the installed PATH command when no executable is configured", () => {
    expect(resolveDjlOpenCodeBinaryPath()).toBe("opencode");
    expect(resolveDjlOpenCodeBinaryPath("  ")).toBe("opencode");
  });
});

describe("OpenCodeRuntime startup diagnostics", () => {
  it("includes command and partial process output when server startup times out", async () => {
    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          return yield* runtime
            .startOpenCodeServerProcess({
              binaryPath: "/custom/bin/opencode",
              hostname: "127.0.0.1",
              port: 58123,
              timeoutMs: 5,
            })
            .pipe(Effect.flip);
        }),
      ).pipe(
        Effect.provide(
          OpenCodeRuntimeLive.pipe(
            Layer.provide(
              mockOpenCodeServerSpawnerLayer({
                stdout: "booting custom OpenCode wrapper\n",
                stderr: "loading provider credentials\n",
              }),
            ),
          ),
        ),
      ),
    );

    expect(OpenCodeRuntimeError.is(error)).toBe(true);
    expect(error.detail).toContain("Timed out waiting for OpenCode server start after 5ms.");
    expect(error.detail).toContain(
      "command: /custom/bin/opencode serve --hostname 127.0.0.1 --port 58123",
    );
    expect(error.detail).toContain('OpenCode ready prefix: "opencode server listening"');
    expect(error.detail).toContain("stdout:\nbooting custom OpenCode wrapper");
    expect(error.detail).toContain("stderr:\nloading provider credentials");
  });

  it("redacts likely secrets from startup timeout diagnostics and causes", async () => {
    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          return yield* runtime
            .startOpenCodeServerProcess({
              binaryPath: "/custom/bin/opencode",
              hostname: "127.0.0.1",
              port: 58123,
              timeoutMs: 5,
            })
            .pipe(Effect.flip);
        }),
      ).pipe(
        Effect.provide(
          OpenCodeRuntimeLive.pipe(
            Layer.provide(
              mockOpenCodeServerSpawnerLayer({
                stdout: "OPENAI_API_KEY=sk-live-123\nauth_token: token-abc\nsafe line\n",
                stderr: 'Authorization: Bearer auth-secret\nserverPassword="pw-secret"\n',
              }),
            ),
          ),
        ),
      ),
    );
    const causeJson = JSON.stringify(error.cause);

    expect(error.detail).toContain("OPENAI_API_KEY=[redacted]");
    expect(error.detail).toContain("auth_token: [redacted]");
    expect(error.detail).toContain("Authorization: Bearer [redacted]");
    expect(error.detail).toContain('serverPassword="[redacted]"');
    expect(error.detail).toContain("safe line");
    for (const secret of ["sk-live-123", "token-abc", "auth-secret", "pw-secret"]) {
      expect(error.detail).not.toContain(secret);
      expect(causeJson).not.toContain(secret);
    }
  });
});

describe("OpenCodeRuntime local server pool", () => {
  it("reuses a local server while scoped sessions are active and closes it after idling", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const firstScope = yield* Scope.make();
          const secondScope = yield* Scope.make();

          const first = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, firstScope));
          const second = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, secondScope));

          expect(first.external).toBe(false);
          expect(first.url).toBe(second.url);
          expect(state.spawnUrls).toEqual(["http://127.0.0.1:59000"]);

          yield* Scope.close(firstScope, Exit.void);
          yield* advanceOpenCodePoolIdleClock;
          expect(state.killUrls).toEqual([]);

          yield* Scope.close(secondScope, Exit.void);
          yield* advanceOpenCodePoolIdleClock;
          expect(state.killUrls).toEqual(["http://127.0.0.1:59000"]);

          const thirdScope = yield* Scope.make();
          const third = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, thirdScope));
          expect(third.url).toBe("http://127.0.0.1:59001");
          expect(state.spawnUrls).toEqual(["http://127.0.0.1:59000", "http://127.0.0.1:59001"]);
          yield* Scope.close(thirdScope, Exit.void);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state))),
    );
  });

  it("does not spawn or pool when an external OpenCode server URL is configured", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const connection = yield* runtime.connectToOpenCodeServer({
            binaryPath: "opencode",
            serverUrl: " http://127.0.0.1:9999 ",
          });

          expect(connection).toMatchObject({
            url: "http://127.0.0.1:9999",
            exitCode: null,
            external: true,
          });
          expect(state.spawnUrls).toEqual([]);
          expect(state.killUrls).toEqual([]);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state))),
    );
  });

  it("starts a fresh managed server after an atomic config revision", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };
    const managedRootDir = await mkdtemp(join(tmpdir(), "synara-opencode-config-"));
    const configDir = join(managedRootDir, "config", "opencode");
    const configPath = join(configDir, "opencode.json");
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, '{"provider":{}}\n');

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* OpenCodeRuntime;
            const firstScope = yield* Scope.make();
            const secondScope = yield* Scope.make();
            const first = yield* runtime
              .connectToOpenCodeServer({ binaryPath: "opencode", managedRootDir })
              .pipe(Effect.provideService(Scope.Scope, firstScope));

            const temporaryPath = `${configPath}.tmp`;
            yield* Effect.promise(() => writeFile(temporaryPath, '{"provider":{"ollama":{}}}\n'));
            yield* Effect.promise(() => rename(temporaryPath, configPath));

            const second = yield* runtime
              .connectToOpenCodeServer({ binaryPath: "opencode", managedRootDir })
              .pipe(Effect.provideService(Scope.Scope, secondScope));

            expect(first.url).toBe("http://127.0.0.1:59000");
            expect(second.url).toBe("http://127.0.0.1:59001");
            expect(state.killUrls).toEqual([]);
            yield* Scope.close(firstScope, Exit.void);
            yield* Scope.close(secondScope, Exit.void);
          }),
        ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state))),
      );
    } finally {
      await rm(managedRootDir, { recursive: true, force: true });
    }
  });

  it("starts a fresh server after shared CLI credentials change", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };
    const managedRootDir = await mkdtemp(join(tmpdir(), "synara-opencode-auth-"));
    vi.stubEnv("XDG_DATA_HOME", join(managedRootDir, "data"));
    const authDir = join(managedRootDir, "data", "opencode");
    const authPath = join(authDir, "auth.json");
    await mkdir(authDir, { recursive: true });
    await writeFile(authPath, "{}\n");

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* OpenCodeRuntime;
            const firstScope = yield* Scope.make();
            const secondScope = yield* Scope.make();
            const first = yield* runtime
              .connectToOpenCodeServer({ binaryPath: "opencode", managedRootDir })
              .pipe(Effect.provideService(Scope.Scope, firstScope));

            const temporaryPath = `${authPath}.tmp`;
            yield* Effect.promise(() =>
              writeFile(temporaryPath, '{"deepseek":{"type":"api","key":"test"}}\n'),
            );
            yield* Effect.promise(() => rename(temporaryPath, authPath));

            const second = yield* runtime
              .connectToOpenCodeServer({ binaryPath: "opencode", managedRootDir })
              .pipe(Effect.provideService(Scope.Scope, secondScope));

            expect(first.url).toBe("http://127.0.0.1:59000");
            expect(second.url).toBe("http://127.0.0.1:59001");
            expect(state.killUrls).toEqual([]);
            yield* Scope.close(firstScope, Exit.void);
            yield* Scope.close(secondScope, Exit.void);
          }),
        ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state))),
      );
    } finally {
      vi.unstubAllEnvs();
      await rm(managedRootDir, { recursive: true, force: true });
    }
  });

  it("starts a new runtime after the installed executable changes without stopping active users", async () => {
    const root = await mkdtemp(join(tmpdir(), "djl-cli-update-"));
    const binaryPath = join(root, "opencode");
    const state = { spawnUrls: [] as string[], killUrls: [] as string[] };
    await writeFile(binaryPath, "old-cli");
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* OpenCodeRuntime;
            const firstScope = yield* Scope.make();
            const secondScope = yield* Scope.make();
            const first = yield* runtime
              .connectToOpenCodeServer({ binaryPath })
              .pipe(Effect.provideService(Scope.Scope, firstScope));
            yield* Effect.promise(() => writeFile(binaryPath, "new-cli-version"));
            const second = yield* runtime
              .connectToOpenCodeServer({ binaryPath })
              .pipe(Effect.provideService(Scope.Scope, secondScope));
            expect(first.url).not.toBe(second.url);
            expect(state.killUrls).toEqual([]);
            yield* Scope.close(firstScope, Exit.void);
            yield* Scope.close(secondScope, Exit.void);
          }),
        ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state))),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the warm server alive when a new session starts before idle expiry", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const firstScope = yield* Scope.make();
          const first = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, firstScope));

          yield* Scope.close(firstScope, Exit.void);
          yield* advanceOpenCodePoolAlmostToIdle;

          const secondScope = yield* Scope.make();
          const second = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, secondScope));

          expect(second.url).toBe(first.url);
          expect(state.spawnUrls).toEqual(["http://127.0.0.1:59000"]);

          yield* advanceOpenCodePoolIdleClock;
          expect(state.killUrls).toEqual([]);

          yield* Scope.close(secondScope, Exit.void);
          yield* advanceOpenCodePoolIdleClock;
          expect(state.killUrls).toEqual(["http://127.0.0.1:59000"]);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state))),
    );
  });

  it("keeps incompatible local server keys separate", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const firstScope = yield* Scope.make();
          const secondScope = yield* Scope.make();

          const defaultServer = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, firstScope));
          const customServer = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "/custom/bin/opencode" })
            .pipe(Effect.provideService(Scope.Scope, secondScope));

          expect(defaultServer.url).toBe("http://127.0.0.1:59000");
          expect(customServer.url).toBe("http://127.0.0.1:59001");
          expect(state.spawnUrls).toEqual(["http://127.0.0.1:59000", "http://127.0.0.1:59001"]);

          yield* Scope.close(firstScope, Exit.void);
          yield* Scope.close(secondScope, Exit.void);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state))),
    );
  });

  it("shares one local server across cwd-scoped clients", async () => {
    const state = {
      spawnUrls: [] as Array<string>,
      spawnCwds: [] as Array<string | undefined>,
      killUrls: [] as Array<string>,
    };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const firstScope = yield* Scope.make();
          const secondScope = yield* Scope.make();
          const thirdScope = yield* Scope.make();

          const first = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode", cwd: "/repo/alpha" })
            .pipe(Effect.provideService(Scope.Scope, firstScope));
          const second = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode", cwd: "/repo/beta" })
            .pipe(Effect.provideService(Scope.Scope, secondScope));
          const third = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode", cwd: "/repo/alpha" })
            .pipe(Effect.provideService(Scope.Scope, thirdScope));

          expect(first.url).toBe("http://127.0.0.1:59000");
          expect(second.url).toBe(first.url);
          expect(third.url).toBe(first.url);
          expect(state.spawnCwds).toEqual(["/repo/alpha"]);

          yield* Scope.close(firstScope, Exit.void);
          yield* Scope.close(secondScope, Exit.void);
          yield* Scope.close(thirdScope, Exit.void);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state))),
    );
  });
});

describe("parseOpenCodeCliModelsOutput", () => {
  it("parses verbose OpenCode model output with metadata blocks", () => {
    const models = parseOpenCodeCliModelsOutput(`
openai/gpt-5.4
{
  "id": "gpt-5.4",
  "providerID": "openai",
  "name": "GPT-5.4",
  "variants": {
    "low": {
      "reasoningEffort": "low"
    },
    "high": {
      "reasoningEffort": "high"
    }
  }
}
opencode/gpt-5-nano
{
  "id": "gpt-5-nano",
  "providerID": "opencode",
  "name": "GPT-5 Nano",
  "variants": {}
}
`);

    expect(models).toEqual([
      {
        slug: "opencode/gpt-5-nano",
        providerID: "opencode",
        modelID: "gpt-5-nano",
        name: "GPT-5 Nano",
        variants: [],
        supportedReasoningEfforts: [],
      },
      {
        slug: "openai/gpt-5.4",
        providerID: "openai",
        modelID: "gpt-5.4",
        name: "GPT-5.4",
        variants: ["high", "low"],
        supportedReasoningEfforts: [
          {
            value: "low",
          },
          {
            value: "high",
          },
        ],
      },
    ]);
  });

  it("falls back to slug-derived metadata when only plain model lines are present", () => {
    const models = parseOpenCodeCliModelsOutput(`
warning: cached model metadata is unavailable
openai/gpt-5.4
opencode/minimax-m2.5-free
`);

    expect(models).toEqual([
      {
        slug: "openai/gpt-5.4",
        providerID: "openai",
        modelID: "gpt-5.4",
        name: "gpt-5.4",
        variants: [],
        supportedReasoningEfforts: [],
      },
      {
        slug: "opencode/minimax-m2.5-free",
        providerID: "opencode",
        modelID: "minimax-m2.5-free",
        name: "minimax-m2.5-free",
        variants: [],
        supportedReasoningEfforts: [],
      },
    ]);
  });

  it("deduplicates repeated slug entries by keeping the latest descriptor", () => {
    const models = parseOpenCodeCliModelsOutput(`
openai/gpt-5.4
{
  "id": "gpt-5.4",
  "providerID": "openai",
  "name": "GPT-5.4"
}
openai/gpt-5.4
{
  "id": "gpt-5.4",
  "providerID": "openai",
  "name": "GPT-5.4 Latest"
}
`);

    expect(models).toEqual([
      {
        slug: "openai/gpt-5.4",
        providerID: "openai",
        modelID: "gpt-5.4",
        name: "GPT-5.4 Latest",
        variants: [],
        supportedReasoningEfforts: [],
      },
    ]);
  });

  it("keeps verbose reasoning metadata from CLI output", () => {
    const models = parseOpenCodeCliModelsOutput(`
openai/gpt-5.4
{
  "id": "gpt-5.4",
  "providerID": "openai",
  "name": "GPT-5.4",
  "options": {
    "reasoningEffort": "medium"
  },
  "variants": {
    "none": {
      "reasoningEffort": "none"
    },
    "low": {
      "reasoningEffort": "low"
    },
    "medium": {
      "reasoningEffort": "medium"
    },
    "high": {
      "reasoningEffort": "high"
    }
  }
}
`);

    expect(models).toEqual([
      {
        slug: "openai/gpt-5.4",
        providerID: "openai",
        modelID: "gpt-5.4",
        name: "GPT-5.4",
        variants: ["high", "low", "medium", "none"],
        supportedReasoningEfforts: [
          { value: "none" },
          { value: "low" },
          { value: "medium" },
          { value: "high" },
        ],
        defaultReasoningEffort: "medium",
      },
    ]);
  });

  it("reads current OpenCode variant effort shapes from verbose CLI output", () => {
    const models = parseOpenCodeCliModelsOutput(`
opencode/claude-opus-4-7
{
  "id": "claude-opus-4-7",
  "providerID": "opencode",
  "name": "Claude Opus 4.7",
  "options": {
    "effort": "high"
  },
  "variants": {
    "low": {
      "thinking": {
        "type": "adaptive"
      }
    },
    "medium": {
      "thinking": {
        "type": "adaptive"
      },
      "effort": "medium"
    },
    "high": {
      "thinking": {
        "type": "adaptive"
      },
      "effort": "high"
    },
    "xhigh": {
      "thinking": {
        "type": "adaptive"
      },
      "effort": "xhigh"
    },
    "max": {
      "thinking": {
        "type": "adaptive"
      },
      "effort": "max"
    }
  }
}
opencode/gemini-3-flash
{
  "id": "gemini-3-flash",
  "providerID": "opencode",
  "name": "Gemini 3 Flash",
  "variants": {
    "minimal": {
      "thinkingConfig": {
        "thinkingLevel": "minimal"
      }
    },
    "high": {
      "thinkingConfig": {
        "thinkingLevel": "high"
      }
    }
  }
}
openrouter/grok-3-mini
{
  "id": "grok-3-mini",
  "providerID": "openrouter",
  "name": "Grok 3 Mini",
  "variants": {
    "low": {
      "reasoning": {
        "effort": "low"
      }
    },
    "high": {
      "reasoning": {
        "effort": "high"
      }
    }
  }
}
amazon-bedrock/nova-reel
{
  "id": "nova-reel",
  "providerID": "amazon-bedrock",
  "name": "Nova Reel",
  "variants": {
    "medium": {
      "reasoningConfig": {
        "maxReasoningEffort": "medium"
      }
    }
  }
}
`);

    expect(models).toEqual([
      {
        slug: "opencode/claude-opus-4-7",
        providerID: "opencode",
        modelID: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        variants: ["high", "low", "max", "medium", "xhigh"],
        supportedReasoningEfforts: [
          { value: "low" },
          { value: "medium" },
          { value: "high" },
          { value: "xhigh" },
          { value: "max" },
        ],
        defaultReasoningEffort: "high",
      },
      {
        slug: "opencode/gemini-3-flash",
        providerID: "opencode",
        modelID: "gemini-3-flash",
        name: "Gemini 3 Flash",
        variants: ["high", "minimal"],
        supportedReasoningEfforts: [{ value: "minimal" }, { value: "high" }],
      },
      {
        slug: "openrouter/grok-3-mini",
        providerID: "openrouter",
        modelID: "grok-3-mini",
        name: "Grok 3 Mini",
        variants: ["high", "low"],
        supportedReasoningEfforts: [{ value: "low" }, { value: "high" }],
      },
      {
        slug: "amazon-bedrock/nova-reel",
        providerID: "amazon-bedrock",
        modelID: "nova-reel",
        name: "Nova Reel",
        variants: ["medium"],
        supportedReasoningEfforts: [{ value: "medium" }],
      },
    ]);
  });
});

describe("parseOpenCodeCredentialProviderIDs", () => {
  it("returns top-level provider ids from the OpenCode credential store", () => {
    const providerIDs = parseOpenCodeCredentialProviderIDs(`{
  "openai": {
    "type": "oauth"
  },
  "opencode": {
    "type": "api"
  }
}`);

    expect(providerIDs).toEqual(["openai", "opencode"]);
  });

  it("ignores non-object entries and empty keys", () => {
    const providerIDs = parseOpenCodeCredentialProviderIDs(`{
  "": {
    "type": "oauth"
  },
  "openai": {
    "type": "oauth"
  },
  "broken": "nope"
}`);

    expect(providerIDs).toEqual(["openai"]);
  });
});

describe("shared OpenCode credential paths", () => {
  it("uses XDG data on every platform even when Windows APPDATA is present", () => {
    vi.stubEnv("XDG_DATA_HOME", join(tmpdir(), "shared-cli-data"));
    vi.stubEnv("APPDATA", join(tmpdir(), "legacy-windows-data"));
    try {
      expect(resolveOpenCodeAuthFilePath({ home: tmpdir() })).toBe(
        join(tmpdir(), "shared-cli-data", "opencode", "auth.json"),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
