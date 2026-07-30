import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnOptions } from "node:child_process";

import type { LocalModelsSnapshot } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usableModelBytes } from "./hardwareProfile";
import { LocalModelManager } from "./LocalModelManager";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "synara-local-models-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function speedOf(snapshot: LocalModelsSnapshot, modelId: string) {
  return snapshot.installedModels.find((model) => model.modelId === modelId)?.tokensPerSecond;
}

async function managedLmStudioContextHost(options: {
  readonly initialLoadedContext: number | null;
  readonly initialLoadedInstanceId?: string;
  readonly loadEchoContext?: number;
  readonly modelId?: string;
  readonly supportsToolCalls?: boolean;
  readonly waitForLoad?: Promise<void>;
}) {
  const stateDir = await temporaryRoot();
  const command = join(
    stateDir,
    "local-models",
    "runtimes",
    "lmstudio",
    "current",
    ".lmstudio",
    "bin",
    "lms.exe",
  );
  await mkdir(join(command, ".."), { recursive: true });
  await writeFile(command, "cli");
  const modelId = options.modelId ?? "ibm/granite-4.1-3b";
  let loadedContext = options.initialLoadedContext;
  let loadedInstanceId =
    loadedContext === null ? null : (options.initialLoadedInstanceId ?? modelId);
  const loadBodies: unknown[] = [];
  const unloadBodies: unknown[] = [];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/api/version") || url.endsWith("/api/tags")) {
        throw new Error("Ollama unavailable");
      }
      if (url.endsWith("/api/v1/models/unload")) {
        const body = JSON.parse(String(init?.body)) as unknown;
        unloadBodies.push(body);
        loadedContext = null;
        loadedInstanceId = null;
        return json({ instance_id: modelId });
      }
      if (url.endsWith("/api/v1/models/load")) {
        const body = JSON.parse(String(init?.body)) as unknown;
        loadBodies.push(body);
        await options.waitForLoad;
        loadedContext = options.loadEchoContext ?? 16_384;
        loadedInstanceId = modelId;
        return json({
          type: "llm",
          instance_id: modelId,
          load_time_seconds: 1.2,
          status: "loaded",
          load_config: { context_length: loadedContext },
        });
      }
      if (url.endsWith("/api/v1/models")) {
        return json({
          models: [
            {
              type: "llm",
              key: modelId,
              display_name: "Granite 4.1 3B",
              size_bytes: 2_099_546_710,
              params_string: "3B",
              loaded_instances:
                loadedContext === null || loadedInstanceId === null
                  ? []
                  : [
                      {
                        id: loadedInstanceId,
                        config: { context_length: loadedContext },
                      },
                    ],
              max_context_length: 131_072,
              format: "gguf",
              capabilities: { trained_for_tool_use: options.supportsToolCalls ?? true },
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  );
  return {
    stateDir,
    loadBodies,
    unloadBodies,
    fetchMock,
    setLoadedContext(value: number | null) {
      loadedContext = value;
    },
    manager: new LocalModelManager({
      stateDir,
      fetch: fetchMock,
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
    }),
  };
}

describe("LocalModelManager", () => {
  it("runs the recommended Ollama setup through ready and synchronizes OpenCode", async () => {
    const stateDir = await temporaryRoot();
    let running = false;
    let installed = false;
    const installOllama = vi.fn(async () => ({
      command: join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama"),
      version: "v0.32.0",
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/version")) {
        if (!running) throw new Error("not running");
        return json({ version: "0.32.0" });
      }
      if (url.endsWith("/api/tags")) {
        return json({
          models: installed ? [{ name: "qwen3.5:2b-q4_K_M", size: 100 }] : [],
        });
      }
      if (url.endsWith("/api/v1/models")) return json({ models: [] });
      if (url.endsWith("/v1/chat/completions")) {
        return json({ choices: [{ message: { content: "READY" } }] });
      }
      if (url.endsWith("/api/pull")) {
        installed = true;
        return new Response(
          new TextEncoder().encode(
            '{"status":"pulling","completed":50,"total":100}\n' +
              '{"status":"success","completed":100,"total":100}\n',
          ),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = new LocalModelManager({
      stateDir,
      fetch: fetchMock,
      totalMemoryBytes: 8 * 1024 ** 3,
      freeDiskBytes: 20 * 1024 ** 3,
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      hardwareProfileProvider: async () => ({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 8 * 1024 ** 3,
        availableMemoryBytes: 8 * 1024 ** 3,
        cpuLogicalCores: 8,
        cpuArchitecture: "x64",
        gpus: [],
        freeDiskBytes: 20 * 1024 ** 3,
      }),
      installOllama,
      spawnRuntime: () => {
        running = true;
        return { once: vi.fn(), unref: vi.fn() };
      },
    });

    const started = await manager.startSetup({
      runtime: "ollama",
      recommendationId: "qwen3.5-2b",
    });
    await vi.waitFor(async () => {
      const snapshot = await manager.getSnapshot();
      expect(snapshot.setupJobs.find(({ id }) => id === started.id)?.state).toBe("ready");
    });

    expect(installOllama).toHaveBeenCalledOnce();
    const config = JSON.parse(
      await readFile(join(stateDir, "opencode", "config", "opencode", "opencode.json"), "utf8"),
    );
    // The 2B tier is measured as unable to drive tools, so OpenCode must be told so explicitly
    // rather than inheriting its `tool_call ?? true` default.
    expect(config.provider.ollama.models["qwen3.5:2b-q4_K_M"]?.tool_call).toBe(false);
  });

  describe("starting an installed runtime at launch", () => {
    // A stopped Ollama reports no inventory, so without this the user's installed models silently
    // disappear from the chat picker until they find the start button in settings.
    function ollamaHost(options: { readonly installedCommand: boolean }) {
      const state = { running: false, spawned: 0 };
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version")) {
          if (!state.running) throw new Error("not running");
          return json({ version: "0.32.0" });
        }
        if (url.endsWith("/api/tags")) {
          if (!state.running) throw new Error("not running");
          return json({
            models: [{ name: "qwen2.5:7b", size: 100, details: { parameter_size: "7.6B" } }],
          });
        }
        if (url.endsWith("/api/v1/models")) throw new Error("LM Studio unavailable");
        throw new Error(`Unexpected request: ${url}`);
      });
      return {
        state,
        fetchMock,
        spawnRuntime: () => {
          state.spawned += 1;
          if (options.installedCommand) state.running = true;
          return { once: vi.fn(), unref: vi.fn() };
        },
      };
    }

    // win32 with a sandboxed env: the posix resolver falls back to /usr/local/bin/ollama, which
    // exists on developer Macs and would make "not installed" depend on the test host.
    async function managerWith(host: ReturnType<typeof ollamaHost>, ollamaOnPath: boolean) {
      const stateDir = await temporaryRoot();
      const binDir = join(stateDir, "bin");
      if (ollamaOnPath) {
        await mkdir(binDir, { recursive: true });
        await writeFile(join(binDir, "ollama.exe"), "", { mode: 0o755 });
      }
      return new LocalModelManager({
        stateDir,
        fetch: host.fetchMock,
        totalMemoryBytes: 32 * 1024 ** 3,
        freeDiskBytes: 200 * 1024 ** 3,
        platform: "win32",
        env: { PATH: ollamaOnPath ? binDir : "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        spawnRuntime: host.spawnRuntime,
      });
    }

    it("starts a stopped Ollama and surfaces its models", async () => {
      const host = ollamaHost({ installedCommand: true });
      const manager = await managerWith(host, true);

      const before = await manager.getSnapshot();
      expect(before.runtimes.find(({ runtime }) => runtime === "ollama")?.state).toBe("stopped");
      expect(before.installedModels).toHaveLength(0);

      await manager.startInstalledRuntimes();

      expect(host.state.spawned).toBeGreaterThan(0);
      const after = await manager.getSnapshot();
      expect(after.runtimes.find(({ runtime }) => runtime === "ollama")?.state).toBe("running");
      expect(after.installedModels.map(({ modelId }) => modelId)).toContain("qwen2.5:7b");
    });

    it("does not try to start Ollama when it is not installed", async () => {
      const host = ollamaHost({ installedCommand: false });
      const manager = await managerWith(host, false);

      await manager.startInstalledRuntimes();

      expect(host.state.spawned).toBe(0);
    });

    it("does not respawn a runtime that is already running", async () => {
      const host = ollamaHost({ installedCommand: true });
      host.state.running = true;
      const manager = await managerWith(host, true);

      await manager.startInstalledRuntimes();

      expect(host.state.spawned).toBe(0);
    });

    it("never throws when the runtime refuses to start", async () => {
      const host = ollamaHost({ installedCommand: false });
      const stateDir = await temporaryRoot();
      const binDir = join(stateDir, "bin");
      await mkdir(binDir, { recursive: true });
      await writeFile(join(binDir, "ollama.exe"), "", { mode: 0o755 });
      const manager = new LocalModelManager({
        stateDir,
        fetch: host.fetchMock,
        totalMemoryBytes: 32 * 1024 ** 3,
        freeDiskBytes: 200 * 1024 ** 3,
        platform: "win32",
        env: { PATH: binDir, LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        // Fails immediately rather than letting the 90s readiness poll run in the test.
        spawnRuntime: () => {
          throw new Error("spawn refused");
        },
      });

      // Launch must not be blocked or crashed by a runtime that will not come up.
      await expect(manager.startInstalledRuntimes()).resolves.toBeUndefined();
    });

    it("leaves LM Studio alone", async () => {
      const host = ollamaHost({ installedCommand: true });
      const manager = await managerWith(host, true);

      await manager.startInstalledRuntimes();

      const snapshot = await manager.getSnapshot();
      expect(snapshot.runtimes.find(({ runtime }) => runtime === "lmstudio")?.state).not.toBe(
        "running",
      );
    });
  });

  describe("tool support lookup", () => {
    async function managerWithModels() {
      const stateDir = await temporaryRoot();
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version")) return json({ version: "0.32.0" });
        if (url.endsWith("/api/tags")) {
          return json({
            models: [
              { name: "llama3.2:1b", size: 100, details: { parameter_size: "1.2B" } },
              { name: "qwen2.5:7b", size: 100, details: { parameter_size: "7.6B" } },
            ],
          });
        }
        if (url.endsWith("/api/v1/models")) throw new Error("LM Studio unavailable");
        throw new Error(`Unexpected request: ${url}`);
      });
      const manager = new LocalModelManager({
        stateDir,
        fetch: fetchMock,
        totalMemoryBytes: 32 * 1024 ** 3,
        freeDiskBytes: 200 * 1024 ** 3,
        platform: "win32",
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      });
      await manager.getSnapshot();
      return manager;
    }

    it("reports a model too small to drive tools", async () => {
      const manager = await managerWithModels();
      expect(await manager.toolSupportForModel("ollama/llama3.2:1b")).toBe(false);
    });

    it("leaves a capable model undecided rather than claiming support", async () => {
      const manager = await managerWithModels();
      expect(await manager.toolSupportForModel("ollama/qwen2.5:7b")).toBeNull();
    });

    it("has no opinion about hosted models", async () => {
      const manager = await managerWithModels();
      expect(await manager.toolSupportForModel("anthropic/claude-opus")).toBeNull();
    });

    it("has no opinion about a local model it has never seen", async () => {
      const manager = await managerWithModels();
      expect(await manager.toolSupportForModel("ollama/never-installed:9b")).toBeNull();
    });

    it("uses LM Studio parameter metadata for an uncurated small model", async () => {
      const stateDir = await temporaryRoot();
      const manager = new LocalModelManager({
        stateDir,
        fetch: vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith("/api/version") || url.endsWith("/api/tags")) {
            throw new Error("Ollama unavailable");
          }
          if (url.endsWith("/api/v1/models")) {
            return json({
              models: [
                {
                  type: "llm",
                  key: "community/tiny-chat",
                  display_name: "Tiny Chat",
                  size_bytes: 800_000_000,
                  params_string: "1.1B",
                  loaded_instances: [],
                  max_context_length: 8_192,
                  format: "gguf",
                },
              ],
            });
          }
          throw new Error(`Unexpected request: ${url}`);
        }),
        platform: "win32",
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      });

      await manager.getSnapshot();

      expect(await manager.toolSupportForModel("lmstudio/community/tiny-chat")).toBe(false);
    });

    it("separates LM Studio maximum, loaded, and managed effective context", async () => {
      const stateDir = await temporaryRoot();
      const command = join(
        stateDir,
        "local-models",
        "runtimes",
        "lmstudio",
        "current",
        ".lmstudio",
        "bin",
        "lms.exe",
      );
      await mkdir(join(command, ".."), { recursive: true });
      await writeFile(command, "cli");
      const manager = new LocalModelManager({
        stateDir,
        fetch: vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith("/api/version") || url.endsWith("/api/tags")) {
            throw new Error("Ollama unavailable");
          }
          if (url.endsWith("/api/v1/models")) {
            return json({
              models: [
                {
                  type: "llm",
                  key: "ibm/granite-4.1-3b",
                  display_name: "Granite 4.1 3B",
                  size_bytes: 2_099_546_710,
                  params_string: "3B",
                  loaded_instances: [
                    {
                      id: "ibm/granite-4.1-3b",
                      config: { context_length: 8_192 },
                    },
                  ],
                  max_context_length: 131_072,
                  format: "gguf",
                  capabilities: { trained_for_tool_use: true },
                },
              ],
            });
          }
          throw new Error(`Unexpected request: ${url}`);
        }),
        platform: "win32",
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      });

      const snapshot = await manager.getSnapshot();

      expect(
        snapshot.installedModels.find(({ modelId }) => modelId === "ibm/granite-4.1-3b"),
      ).toMatchObject({
        contextWindowTokens: 16_384,
        maxContextWindowTokens: 131_072,
        loadedContextWindowTokens: 8_192,
        toolContextWindowReady: true,
        supportsToolCalls: true,
      });
    });
  });

  describe("speed verification", () => {
    // Builds a manager whose Ollama warm-up returns a fixed tokens-per-second measurement.
    async function setupWithSpeed(tokensPerSecond: number) {
      const stateDir = await temporaryRoot();
      let running = false;
      let installed = false;
      const evalCount = 48;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version")) {
          if (!running) throw new Error("not running");
          return json({ version: "0.32.0" });
        }
        if (url.endsWith("/api/tags")) {
          return json({ models: installed ? [{ name: "qwen3.5:2b-q4_K_M", size: 100 }] : [] });
        }
        if (url.endsWith("/api/v1/models")) return json({ models: [] });
        if (url.endsWith("/api/pull")) {
          installed = true;
          return new Response(
            new TextEncoder().encode('{"status":"success","completed":100,"total":100}\n'),
          );
        }
        if (url.endsWith("/api/generate")) {
          return json({
            eval_count: evalCount,
            eval_duration: Math.round((evalCount / tokensPerSecond) * 1e9),
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      const manager = new LocalModelManager({
        stateDir,
        fetch: fetchMock,
        totalMemoryBytes: 8 * 1024 ** 3,
        freeDiskBytes: 20 * 1024 ** 3,
        platform: "win32",
        osVersion: "10.0.19045",
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        runInferenceCanary: vi.fn(async () => undefined),
        installOllama: vi.fn(async () => ({
          command: join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama"),
          version: "v0.32.0",
        })),
        spawnRuntime: () => {
          running = true;
          return { once: vi.fn(), unref: vi.fn() };
        },
      });
      const started = await manager.startSetup({
        runtime: "ollama",
        recommendationId: "qwen3.5-2b",
      });
      await vi.waitFor(async () => {
        const snapshot = await manager.getSnapshot();
        expect(snapshot.setupJobs.find(({ id }) => id === started.id)?.state).toBe("ready");
      });
      const snapshot = await manager.getSnapshot();
      return {
        job: snapshot.setupJobs.find(({ id }) => id === started.id)!,
        snapshot,
        fetchMock,
      };
    }

    it("times a warm-up run and reports the measured speed", async () => {
      const { job, snapshot, fetchMock } = await setupWithSpeed(28);

      expect(job.message).toContain("28");
      expect(
        snapshot.installedModels.find(({ modelId }) => modelId === "qwen3.5:2b-q4_K_M")
          ?.tokensPerSecond,
      ).toBe(28);
      const generate = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/generate"));
      expect(generate).toBeDefined();
      // Fast enough: nothing to suggest.
      expect(job.tokensPerSecond).toBe(28);
      expect(job.suggestedFallbackId).toBeNull();
    });

    it("warns when the model runs slower than comfortable and offers a smaller tier", async () => {
      const { job } = await setupWithSpeed(9);
      expect(job.message).toContain("slower");
      expect(job.suggestedFallbackId).toBe("qwen3-1.7b");
    });

    it("calls out a model that is too slow to use on this computer", async () => {
      const { job } = await setupWithSpeed(3);
      expect(job.message).toContain("too slow");
      expect(job.suggestedFallbackId).toBe("qwen3-1.7b");
    });

    it("reports no speed when the model stops before generating enough to time", async () => {
      const stateDir = await temporaryRoot();
      let running = false;
      let installed = false;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version")) {
          if (!running) throw new Error("not running");
          return json({ version: "0.32.0" });
        }
        if (url.endsWith("/api/tags")) {
          return json({ models: installed ? [{ name: "qwen3.5:2b-q4_K_M", size: 100 }] : [] });
        }
        if (url.endsWith("/api/v1/models")) return json({ models: [] });
        if (url.endsWith("/api/pull")) {
          installed = true;
          return new Response(
            new TextEncoder().encode('{"status":"success","completed":100,"total":100}\n'),
          );
        }
        if (url.endsWith("/api/generate")) {
          // A model that hits its stop token after two tokens. Dividing by that sample yields a
          // number dominated by call overhead, not throughput — so it must not be reported.
          return json({ eval_count: 2, eval_duration: 211_850_583 });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      const manager = new LocalModelManager({
        stateDir,
        fetch: fetchMock,
        totalMemoryBytes: 8 * 1024 ** 3,
        freeDiskBytes: 20 * 1024 ** 3,
        platform: "win32",
        osVersion: "10.0.19045",
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        runInferenceCanary: vi.fn(async () => undefined),
        installOllama: vi.fn(async () => ({
          command: join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama"),
          version: "v0.32.0",
        })),
        spawnRuntime: () => {
          running = true;
          return { once: vi.fn(), unref: vi.fn() };
        },
      });

      const started = await manager.startSetup({
        runtime: "ollama",
        recommendationId: "qwen3.5-2b",
      });
      await vi.waitFor(async () => {
        const snapshot = await manager.getSnapshot();
        expect(snapshot.setupJobs.find(({ id }) => id === started.id)?.state).toBe("ready");
      });
      const snapshot = await manager.getSnapshot();
      const job = snapshot.setupJobs.find(({ id }) => id === started.id);
      expect(job?.message).not.toContain("slower");
      expect(job?.message).not.toContain("too slow");
      expect(
        snapshot.installedModels.find(({ modelId }) => modelId === "qwen3.5:2b-q4_K_M")
          ?.tokensPerSecond,
      ).toBeNull();
    });

    it("still reaches ready when the warm-up cannot be timed", async () => {
      const stateDir = await temporaryRoot();
      let running = false;
      let installed = false;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version")) {
          if (!running) throw new Error("not running");
          return json({ version: "0.32.0" });
        }
        if (url.endsWith("/api/tags")) {
          return json({ models: installed ? [{ name: "qwen3.5:2b-q4_K_M", size: 100 }] : [] });
        }
        if (url.endsWith("/api/v1/models")) return json({ models: [] });
        if (url.endsWith("/api/pull")) {
          installed = true;
          return new Response(
            new TextEncoder().encode('{"status":"success","completed":100,"total":100}\n'),
          );
        }
        if (url.endsWith("/api/generate")) throw new Error("generate exploded");
        throw new Error(`Unexpected request: ${url}`);
      });
      const manager = new LocalModelManager({
        stateDir,
        fetch: fetchMock,
        totalMemoryBytes: 8 * 1024 ** 3,
        freeDiskBytes: 20 * 1024 ** 3,
        platform: "win32",
        osVersion: "10.0.19045",
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        runInferenceCanary: vi.fn(async () => undefined),
        installOllama: vi.fn(async () => ({
          command: join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama"),
          version: "v0.32.0",
        })),
        spawnRuntime: () => {
          running = true;
          return { once: vi.fn(), unref: vi.fn() };
        },
      });

      const started = await manager.startSetup({
        runtime: "ollama",
        recommendationId: "qwen3.5-2b",
      });
      await vi.waitFor(async () => {
        const snapshot = await manager.getSnapshot();
        expect(snapshot.setupJobs.find(({ id }) => id === started.id)?.state).toBe("ready");
      });
      const snapshot = await manager.getSnapshot();
      expect(
        snapshot.installedModels.find(({ modelId }) => modelId === "qwen3.5:2b-q4_K_M")
          ?.tokensPerSecond,
      ).toBeNull();
    });
  });

  describe("LM Studio context preparation", () => {
    it("loads an unloaded managed tool model at the agent context floor", async () => {
      const host = await managedLmStudioContextHost({ initialLoadedContext: null });

      await host.manager.ensureRuntimeForModel("lmstudio/ibm/granite-4.1-3b");

      expect(host.loadBodies).toEqual([
        {
          model: "ibm/granite-4.1-3b",
          context_length: 16_384,
          echo_load_config: true,
        },
      ]);
      expect(host.unloadBodies).toEqual([]);
      const config = JSON.parse(
        await readFile(
          join(host.stateDir, "opencode", "config", "opencode", "opencode.json"),
          "utf8",
        ),
      );
      expect(config.provider.lmstudio.models["ibm/granite-4.1-3b"].limit.context).toBe(16_384);
    });

    it("reloads an undersized managed tool model", async () => {
      const host = await managedLmStudioContextHost({ initialLoadedContext: 8_192 });

      await host.manager.ensureRuntimeForModel("lmstudio/ibm/granite-4.1-3b");

      expect(host.unloadBodies).toEqual([{ instance_id: "ibm/granite-4.1-3b" }]);
      expect(host.loadBodies).toHaveLength(1);
    });

    it("does not shrink a managed model already loaded above the floor", async () => {
      const host = await managedLmStudioContextHost({ initialLoadedContext: 32_768 });

      await host.manager.ensureRuntimeForModel("lmstudio/ibm/granite-4.1-3b");

      expect(host.unloadBodies).toEqual([]);
      expect(host.loadBodies).toEqual([]);
    });

    it("rejects a selected LM Studio model absent from the live inventory", async () => {
      const host = await managedLmStudioContextHost({ initialLoadedContext: 32_768 });

      await expect(
        host.manager.ensureRuntimeForModel("lmstudio/openai/gpt-oss-20b"),
      ).rejects.toThrow(
        "LM Studio cannot serve requested model 'openai/gpt-oss-20b'. Refresh models, install or load it in LM Studio, or choose another model.",
      );
    });

    it("loads an unloaded managed chat-only model with its exact API identifier", async () => {
      const host = await managedLmStudioContextHost({
        initialLoadedContext: null,
        modelId: "qwen/qwen3-1.7b",
        supportsToolCalls: false,
      });

      await host.manager.ensureRuntimeForModel("lmstudio/qwen/qwen3-1.7b");

      expect(host.loadBodies).toEqual([
        {
          model: "qwen/qwen3-1.7b",
          echo_load_config: true,
        },
      ]);
    });

    it("reloads a managed model whose loaded instance has a different identifier", async () => {
      const host = await managedLmStudioContextHost({
        initialLoadedContext: 32_768,
        initialLoadedInstanceId: "granite-default",
      });

      await host.manager.ensureRuntimeForModel("lmstudio/ibm/granite-4.1-3b");

      expect(host.unloadBodies).toEqual([{ instance_id: "granite-default" }]);
      expect(host.loadBodies).toEqual([
        {
          model: "ibm/granite-4.1-3b",
          context_length: 16_384,
          echo_load_config: true,
        },
      ]);
    });

    it("removes an unavailable LM Studio runtime from OpenCode without forgetting installs", async () => {
      const stateDir = await temporaryRoot();
      const command = join(
        stateDir,
        "local-models",
        "runtimes",
        "lmstudio",
        "current",
        ".lmstudio",
        "bin",
        "lms.exe",
      );
      await mkdir(join(command, ".."), { recursive: true });
      await writeFile(command, "cli");
      let running = true;
      const manager = new LocalModelManager({
        stateDir,
        platform: "win32",
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        fetch: vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith("/api/version") || url.endsWith("/api/tags")) {
            throw new Error("Ollama unavailable");
          }
          if (url.endsWith("/api/v1/models")) {
            if (!running) throw new Error("LM Studio unavailable");
            return json({
              models: [
                {
                  type: "llm",
                  key: "ibm/granite-4.1-3b",
                  display_name: "Granite 4.1 3B",
                  size_bytes: 2_099_546_710,
                  params_string: "3B",
                  loaded_instances: [],
                  max_context_length: 131_072,
                  capabilities: { trained_for_tool_use: true },
                },
              ],
            });
          }
          throw new Error(`Unexpected request: ${url}`);
        }),
      });
      await manager.getSnapshot();
      running = false;

      const stopped = await manager.getSnapshot();
      const config = JSON.parse(
        await readFile(join(stateDir, "opencode", "config", "opencode", "opencode.json"), "utf8"),
      );

      expect(stopped.runtimes.find(({ runtime }) => runtime === "lmstudio")?.state).toBe("stopped");
      expect(stopped.installedModels.some(({ modelId }) => modelId === "ibm/granite-4.1-3b")).toBe(
        true,
      );
      expect(config.provider.lmstudio).toBeUndefined();
    });

    it("does not evict an undersized external LM Studio instance", async () => {
      const stateDir = await temporaryRoot();
      const homeDir = join(stateDir, "home");
      const command = join(homeDir, ".lmstudio", "bin", "lms");
      const appCommand = join(stateDir, "LM Studio.app", "Contents", "MacOS", "LM Studio");
      await mkdir(join(command, ".."), { recursive: true });
      await mkdir(join(homeDir, ".lmstudio", ".internal"), { recursive: true });
      await mkdir(join(appCommand, ".."), { recursive: true });
      await writeFile(command, "cli", { mode: 0o755 });
      await writeFile(appCommand, "app", { mode: 0o755 });
      await writeFile(
        join(homeDir, ".lmstudio", ".internal", "app-install-location.json"),
        JSON.stringify({ path: appCommand }),
      );
      const mutationRequests: string[] = [];
      const manager = new LocalModelManager({
        stateDir,
        platform: "darwin",
        env: { PATH: "", HOME: homeDir },
        fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/api/version") || url.endsWith("/api/tags")) {
            throw new Error("Ollama unavailable");
          }
          if (init?.method === "POST") mutationRequests.push(url);
          if (url.endsWith("/api/v1/models")) {
            return json({
              models: [
                {
                  type: "llm",
                  key: "ibm/granite-4.1-3b",
                  display_name: "Granite 4.1 3B",
                  size_bytes: 2_099_546_710,
                  params_string: "3B",
                  loaded_instances: [
                    {
                      id: "ibm/granite-4.1-3b",
                      config: { context_length: 8_192 },
                    },
                  ],
                  max_context_length: 131_072,
                  format: "gguf",
                  capabilities: { trained_for_tool_use: true },
                },
              ],
            });
          }
          throw new Error(`Unexpected request: ${url}`);
        }),
      });

      await manager.ensureRuntimeForModel("lmstudio/ibm/granite-4.1-3b");
      const snapshot = await manager.getSnapshot();

      expect(mutationRequests).toEqual([]);
      expect(
        snapshot.installedModels.find(({ modelId }) => modelId === "ibm/granite-4.1-3b"),
      ).toMatchObject({
        loadedContextWindowTokens: 8_192,
        toolContextWindowReady: false,
        supportsToolCalls: false,
      });
    });

    it("rejects a managed load that does not apply the requested context", async () => {
      const host = await managedLmStudioContextHost({
        initialLoadedContext: null,
        loadEchoContext: 8_192,
      });

      await expect(
        host.manager.ensureRuntimeForModel("lmstudio/ibm/granite-4.1-3b"),
      ).rejects.toThrow(
        "LM Studio loaded Granite 4.1 3B with an 8192-token context; DJL tools require at least 16384.",
      );
    });

    it("deduplicates concurrent context loads for the same managed model", async () => {
      let releaseLoad!: () => void;
      const waitForLoad = new Promise<void>((resolve) => {
        releaseLoad = resolve;
      });
      const host = await managedLmStudioContextHost({
        initialLoadedContext: null,
        waitForLoad,
      });

      const first = host.manager.ensureRuntimeForModel("lmstudio/ibm/granite-4.1-3b");
      const second = host.manager.ensureRuntimeForModel("lmstudio/ibm/granite-4.1-3b");
      await vi.waitFor(() => expect(host.loadBodies).toHaveLength(1));
      releaseLoad();
      await Promise.all([first, second]);

      expect(host.loadBodies).toHaveLength(1);
    });

    it("does not make LM Studio load calls for an Ollama model", async () => {
      const stateDir = await temporaryRoot();
      const lmStudioMutations: string[] = [];
      const manager = new LocalModelManager({
        stateDir,
        platform: "win32",
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/api/version")) return json({ version: "0.32.0" });
          if (url.endsWith("/api/tags")) {
            return json({
              models: [{ name: "granite4.1:3b", size: 2_000_000_000 }],
            });
          }
          if (url.includes("/api/v1/models") && init?.method === "POST") {
            lmStudioMutations.push(url);
          }
          if (url.endsWith("/api/v1/models")) throw new Error("LM Studio unavailable");
          throw new Error(`Unexpected request: ${url}`);
        }),
      });

      await manager.ensureRuntimeForModel("ollama/granite4.1:3b");

      expect(lmStudioMutations).toEqual([]);
    });

    it("rewrites OpenCode config when only the effective context changes", async () => {
      const host = await managedLmStudioContextHost({ initialLoadedContext: 32_768 });
      await host.manager.getSnapshot();
      host.setLoadedContext(16_384);

      await host.manager.getSnapshot();

      const config = JSON.parse(
        await readFile(
          join(host.stateDir, "opencode", "config", "opencode", "opencode.json"),
          "utf8",
        ),
      );
      expect(config.provider.lmstudio.models["ibm/granite-4.1-3b"].limit.context).toBe(16_384);
    });
  });

  describe("measuring models that no setup installed", () => {
    // Ollama's /api/ps lists the models already resident in memory. Timing one of those costs a
    // single short generation; loading a cold 13 GB model to benchmark it would evict whatever the
    // user is actually working with, so only resident models are ever measured.
    function ollamaHost(options: {
      readonly tags: readonly string[];
      readonly resident: readonly string[];
      readonly generate?: () => Response;
      readonly hangingPull?: boolean;
    }) {
      const generated: string[] = [];
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/version")) return json({ version: "0.32.0" });
        if (url.endsWith("/api/pull") && options.hangingPull) {
          return new Promise<never>(() => undefined);
        }
        if (url.endsWith("/api/tags")) {
          return json({ models: options.tags.map((name) => ({ name, size: 100 })) });
        }
        if (url.endsWith("/api/ps")) {
          return json({ models: options.resident.map((name) => ({ name, size_vram: 100 })) });
        }
        if (url.endsWith("/api/generate")) {
          const body = JSON.parse(String(init?.body)) as { model?: string };
          generated.push(String(body.model));
          if (options.generate) return options.generate();
          return json({ eval_count: 48, eval_duration: (48 / 40) * 1e9 });
        }
        if (url.endsWith("/api/v1/models")) throw new Error("LM Studio unavailable");
        throw new Error(`Unexpected request: ${url}`);
      });
      return { fetchMock, generated };
    }

    // win32 with a sandboxed env: the posix resolver falls back to /usr/local/bin/ollama, which
    // exists on developer Macs and would make runtime detection depend on the test host.
    function managerFor(stateDir: string, host: ReturnType<typeof ollamaHost>) {
      return new LocalModelManager({
        stateDir,
        fetch: host.fetchMock,
        totalMemoryBytes: 32 * 1024 ** 3,
        freeDiskBytes: 200 * 1024 ** 3,
        platform: "win32",
        osVersion: "10.0.19045",
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      });
    }

    it("measures a resident model no setup installed and keeps it across a restart", async () => {
      const stateDir = await temporaryRoot();
      const host = ollamaHost({ tags: ["qwen2.5:7b"], resident: ["qwen2.5:7b"] });
      const manager = managerFor(stateDir, host);

      await manager.refresh();
      await vi.waitFor(async () => {
        expect(speedOf(await manager.getSnapshot(), "qwen2.5:7b")).toBe(40);
      });
      expect(host.generated).toEqual(["qwen2.5:7b"]);
      await vi.waitFor(async () => {
        const saved = JSON.parse(
          await readFile(join(stateDir, "local-models", "setup-state.json"), "utf8"),
        ) as { speeds?: unknown };
        expect(saved.speeds).toEqual({ "ollama:qwen2.5:7b": 40 });
      });

      const restartedHost = ollamaHost({ tags: ["qwen2.5:7b"], resident: ["qwen2.5:7b"] });
      const restarted = managerFor(stateDir, restartedHost);

      expect(speedOf(await restarted.getSnapshot(), "qwen2.5:7b")).toBe(40);
      expect(restartedHost.generated).toEqual([]);
    });

    it("measures at most one resident model per refresh", async () => {
      const stateDir = await temporaryRoot();
      const models = ["qwen3:1.7b", "qwen2.5:7b"];
      const host = ollamaHost({ tags: models, resident: models });
      const manager = managerFor(stateDir, host);

      await manager.refresh();
      await vi.waitFor(async () => {
        expect(speedOf(await manager.getSnapshot(), "qwen3:1.7b")).toBe(40);
      });
      expect(host.generated).toEqual(["qwen3:1.7b"]);

      await vi.waitFor(async () => {
        await manager.refresh();
        expect(host.generated).toEqual(["qwen3:1.7b", "qwen2.5:7b"]);
      });
    });

    it("never measures a model that is not resident in memory", async () => {
      const stateDir = await temporaryRoot();
      const host = ollamaHost({ tags: ["gpt-oss:20b"], resident: [] });
      const manager = managerFor(stateDir, host);

      await manager.refresh();
      await manager.refresh();

      // Loading a 13 GB model just to benchmark it would evict whatever the user is using.
      expect(host.generated).toEqual([]);
      expect(speedOf(await manager.getSnapshot(), "gpt-oss:20b")).toBeNull();
    });

    it("does not measure while a setup run is timing its own model", async () => {
      const stateDir = await temporaryRoot();
      const host = ollamaHost({
        tags: ["qwen2.5:7b"],
        resident: ["qwen2.5:7b"],
        hangingPull: true,
      });
      const manager = managerFor(stateDir, host);

      const started = await manager.startSetup({ runtime: "ollama" });
      await vi.waitFor(async () => {
        const snapshot = await manager.getSnapshot();
        expect(snapshot.setupJobs.find(({ id }) => id === started.id)?.state).toBe(
          "downloading_model",
        );
      });

      await manager.refresh();
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Two timed generations at once understate both — the false "slower than ideal" alarm.
      expect(host.generated).toEqual([]);
      await manager.cancelSetup(started.id);
    });

    it("never lets a failed measurement break the refresh loop", async () => {
      const stateDir = await temporaryRoot();
      const host = ollamaHost({
        tags: ["qwen2.5:7b"],
        resident: ["qwen2.5:7b"],
        generate: () => {
          throw new Error("generate exploded");
        },
      });
      const manager = managerFor(stateDir, host);

      await expect(manager.refresh()).resolves.toBeDefined();
      await vi.waitFor(() => {
        expect(host.generated).toEqual(["qwen2.5:7b"]);
      });

      // Retrying every refresh tick would hammer the runtime for a model that cannot be timed.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await manager.refresh();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(host.generated).toEqual(["qwen2.5:7b"]);
      expect(speedOf(await manager.getSnapshot(), "qwen2.5:7b")).toBeNull();
    });

    it("starts normally when the persisted speeds are malformed", async () => {
      const stateDir = await temporaryRoot();
      await mkdir(join(stateDir, "local-models"), { recursive: true });
      await writeFile(
        join(stateDir, "local-models", "setup-state.json"),
        JSON.stringify({
          version: 1,
          jobs: [],
          speeds: { "ollama:qwen2.5:7b": "fast", "ollama:qwen3:1.7b": null },
        }),
      );
      const host = ollamaHost({ tags: ["qwen2.5:7b"], resident: [] });
      const manager = managerFor(stateDir, host);

      expect(speedOf(await manager.getSnapshot(), "qwen2.5:7b")).toBeNull();
    });
  });

  it("forwards the curated Q4 quantization during recommended LM Studio setup", async () => {
    const stateDir = await temporaryRoot();
    let installed = false;
    let downloadBody: unknown;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.endsWith("/api/version") || url.endsWith("/api/tags")) {
          throw new Error("Ollama unavailable");
        }
        if (url.endsWith("/api/v1/models/download")) {
          downloadBody = JSON.parse(String(init?.body));
          return json({ job_id: "lm-setup-1", status: "downloading", total_size_bytes: 100 });
        }
        if (url.endsWith("/api/v1/models/download/status/lm-setup-1")) {
          installed = true;
          return json({
            status: "completed",
            downloaded_size_bytes: 100,
            total_size_bytes: 100,
          });
        }
        if (url.endsWith("/api/v1/models")) {
          return json({
            models: installed
              ? [
                  {
                    type: "llm",
                    key: "qwen/qwen3.5-2b",
                    display_name: "Qwen3.5 2B",
                    size_bytes: 100,
                  },
                ]
              : [],
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    );
    const manager = new LocalModelManager({
      stateDir,
      fetch: fetchMock,
      totalMemoryBytes: 8 * 1024 ** 3,
      freeDiskBytes: 20 * 1024 ** 3,
      platform: "win32",
      osVersion: "10.0.19045",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      runInferenceCanary: vi.fn(async () => undefined),
    });

    const started = await manager.startSetup({
      runtime: "lmstudio",
      recommendationId: "qwen3.5-2b",
    });
    await vi.waitFor(
      async () => {
        const snapshot = await manager.getSnapshot();
        expect(snapshot.setupJobs.find(({ id }) => id === started.id)?.state).toBe("ready");
      },
      { timeout: 5_000 },
    );

    expect(downloadBody).toEqual({
      model: "qwen/qwen3.5-2b",
      quantization: "Q4_K_M",
    });
  });

  it("blocks one-click setup before downloading when disk space is insufficient", async () => {
    const stateDir = await temporaryRoot();
    const installOllama = vi.fn();
    const manager = new LocalModelManager({
      stateDir,
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
      totalMemoryBytes: 8 * 1024 ** 3,
      freeDiskBytes: 1024,
      platform: "linux",
      env: { PATH: "" },
      installOllama,
    });

    const started = await manager.startSetup({ runtime: "ollama" });
    await vi.waitFor(async () => {
      const job = (await manager.getSnapshot()).setupJobs.find(({ id }) => id === started.id);
      expect(job?.state).toBe("failed");
      expect(job?.message).toContain("free disk space");
    });
    expect(installOllama).not.toHaveBeenCalled();
  });

  it("rejects one-click setup when the selected model exceeds system memory", async () => {
    const stateDir = await temporaryRoot();
    const installOllama = vi.fn();
    const manager = new LocalModelManager({
      stateDir,
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
      totalMemoryBytes: 8 * 1024 ** 3,
      freeDiskBytes: 40 * 1024 ** 3,
      platform: "win32",
      osVersion: "10.0.19045",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      installOllama,
    });

    const outcome = await manager
      .startSetup({
        runtime: "ollama",
        recommendationId: "gpt-oss-20b",
      })
      .then(
        (job) => ({ job }) as const,
        (error: unknown) => ({ error }) as const,
      );
    if ("job" in outcome) await manager.cancelSetup(outcome.job.id);

    expect(outcome).toEqual({ error: expect.any(Error) });
    expect("error" in outcome ? String(outcome.error) : "").toContain(
      "not a safe champion for the selected category",
    );
    expect(installOllama).not.toHaveBeenCalled();
    expect((await manager.getSnapshot()).setupJobs).toHaveLength(0);
  });

  it("reuses the active category setup and rejects a different concurrent category", async () => {
    const stateDir = await temporaryRoot();
    const installOllama = vi.fn(() => new Promise<never>(() => undefined));
    const manager = new LocalModelManager({
      stateDir,
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
      totalMemoryBytes: 8 * 1024 ** 3,
      freeDiskBytes: 40 * 1024 ** 3,
      platform: "win32",
      osVersion: "10.0.19045",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      installOllama,
    });

    const active = await manager.startSetup({
      runtime: "ollama",
      recommendationId: "qwen3.5-2b",
    });
    await vi.waitFor(async () => {
      expect(
        (await manager.getSnapshot()).setupJobs.find(({ id }) => id === active.id)?.state,
      ).toBe("installing_runtime");
    });

    const reused = await manager.startSetup({
      runtime: "ollama",
      recommendationId: "qwen3.5-2b",
    });
    expect(reused.id).toBe(active.id);
    const reusedAfterRecommendationChange = await manager.startSetup({
      runtime: "ollama",
      recommendationId: "granite-4.1-3b",
    });
    expect(reusedAfterRecommendationChange.id).toBe(active.id);
    await expect(
      manager.startSetup({
        runtime: "ollama",
        useCase: "coding",
        recommendationId: "granite-4.1-3b",
      }),
    ).rejects.toThrow("Another local AI is already being prepared");

    expect((await manager.cancelSetup(active.id)).state).toBe("cancelled");
  });

  it("reuses an active category setup when retrying older failures", async () => {
    const stateDir = await temporaryRoot();
    await mkdir(join(stateDir, "local-models"), { recursive: true });
    await writeFile(
      join(stateDir, "local-models", "setup-state.json"),
      JSON.stringify({
        version: 1,
        jobs: [
          {
            id: "failed-oversized",
            runtime: "ollama",
            recommendationId: "gpt-oss-20b",
            modelId: "gpt-oss:20b",
            state: "failed",
            downloadedBytes: 0,
            totalBytes: 13 * 1024 ** 3,
            message: "Download failed.",
            startedAt: "2026-07-27T00:00:00.000Z",
            finishedAt: "2026-07-27T00:01:00.000Z",
          },
          {
            id: "failed-safe",
            runtime: "ollama",
            recommendationId: "qwen3.5-2b",
            modelId: "qwen3.5:2b-q4_K_M",
            state: "failed",
            downloadedBytes: 0,
            totalBytes: 1.9 * 1024 ** 3,
            message: "Download failed.",
            startedAt: "2026-07-27T00:02:00.000Z",
            finishedAt: "2026-07-27T00:03:00.000Z",
          },
          {
            id: "active-safe",
            runtime: "ollama",
            recommendationId: "granite-4.1-3b",
            modelId: "granite4.1:3b",
            state: "downloading_model",
            downloadedBytes: 100,
            totalBytes: 2.1 * 1024 ** 3,
            message: "Downloading Granite 4.1 3B…",
            startedAt: "2026-07-27T00:04:00.000Z",
            finishedAt: null,
          },
        ],
      }),
    );
    const manager = new LocalModelManager({
      stateDir,
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
      totalMemoryBytes: 8 * 1024 ** 3,
      freeDiskBytes: 40 * 1024 ** 3,
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      installOllama: vi.fn(() => new Promise<never>(() => undefined)),
    });

    expect((await manager.retrySetup("failed-oversized")).id).toBe("active-safe");
    expect((await manager.retrySetup("failed-safe")).id).toBe("active-safe");
    await manager.cancelSetup("active-safe");
  });

  it("blocks one-click setup on Windows versions older than Windows 10 22H2", async () => {
    const stateDir = await temporaryRoot();
    const installOllama = vi.fn();
    const manager = new LocalModelManager({
      stateDir,
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
      installOllama,
      hardwareProfileProvider: async () => ({
        platform: "win32",
        osVersion: "10.0.19044",
        totalMemoryBytes: 32 * 1024 ** 3,
        availableMemoryBytes: 24 * 1024 ** 3,
        cpuLogicalCores: 16,
        cpuArchitecture: "x64",
        gpus: [],
        freeDiskBytes: 64 * 1024 ** 3,
      }),
    });

    await expect(manager.startSetup({ runtime: "ollama" })).rejects.toThrow(
      "Windows 10 22H2 or later",
    );
    expect(installOllama).not.toHaveBeenCalled();
  });

  it("routes Intel Macs to Ollama instead of an unsupported LM Studio setup", async () => {
    const stateDir = await temporaryRoot();
    const installLmStudio = vi.fn();
    const manager = new LocalModelManager({
      stateDir,
      platform: "darwin",
      env: { PATH: "" },
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
      installLmStudio,
      hardwareProfileProvider: async () => ({
        platform: "darwin",
        osVersion: "14.7.6",
        totalMemoryBytes: 32 * 1024 ** 3,
        availableMemoryBytes: 24 * 1024 ** 3,
        cpuLogicalCores: 8,
        cpuArchitecture: "x64",
        gpus: [],
        freeDiskBytes: 64 * 1024 ** 3,
      }),
    });

    await expect(manager.startSetup({ runtime: "lmstudio" })).rejects.toThrow(
      "Choose Ollama for an Intel Mac",
    );
    await expect(manager.installRuntime("lmstudio")).rejects.toThrow(
      "Choose Ollama for an Intel Mac",
    );
    expect(installLmStudio).not.toHaveBeenCalled();
  });

  it.each(["13.6.9", "garbage", undefined])(
    "blocks direct runtime installation when macOS cannot be verified as supported (%s)",
    async (osVersion) => {
      const stateDir = await temporaryRoot();
      const installOllama = vi.fn();
      const manager = new LocalModelManager({
        stateDir,
        platform: "darwin",
        env: { PATH: "" },
        fetch: vi.fn(async () => {
          throw new Error("not running");
        }),
        installOllama,
        hardwareProfileProvider: async () => ({
          platform: "darwin",
          ...(osVersion === undefined ? {} : { osVersion }),
          totalMemoryBytes: 32 * 1024 ** 3,
          availableMemoryBytes: 24 * 1024 ** 3,
          cpuLogicalCores: 10,
          cpuArchitecture: "arm64",
          gpus: [],
          freeDiskBytes: 64 * 1024 ** 3,
        }),
      });

      await expect(manager.installRuntime("ollama")).rejects.toThrow("macOS 14 or later");
      expect(installOllama).not.toHaveBeenCalled();
    },
  );

  it("publishes the detected hardware profile and recommends from available capacity", async () => {
    const stateDir = await temporaryRoot();
    const manager = new LocalModelManager({
      stateDir,
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      hardwareProfileProvider: async () => ({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 32 * 1024 ** 3,
        availableMemoryBytes: 24 * 1024 ** 3,
        cpuLogicalCores: 12,
        cpuArchitecture: "x64",
        gpus: [
          {
            name: "GPU",
            dedicatedMemoryBytes: 12 * 1024 ** 3,
            availableMemoryBytes: 11 * 1024 ** 3,
          },
        ],
        freeDiskBytes: 80 * 1024 ** 3,
      }),
    });

    const snapshot = await manager.getSnapshot();

    expect(snapshot.recommendedModelId).toBe("gpt-oss-20b");
    expect(snapshot.recommendedModelIdsByUseCase).toEqual({
      general: "gpt-oss-20b",
      document: "granite-4.1-3b",
      reasoning: "gpt-oss-20b",
      coding: "qwen2.5-coder-14b",
    });
    expect(snapshot.hardwareProfile?.availableMemoryBytes).toBe(24 * 1024 ** 3);
    expect(snapshot.hardwareProfile?.gpus[0]).toEqual({
      name: "GPU",
      dedicatedMemoryBytes: 12 * 1024 ** 3,
      availableMemoryBytes: 11 * 1024 ** 3,
    });
    expect(snapshot.totalMemoryBytes).toBe(snapshot.hardwareProfile?.totalMemoryBytes);
    expect(snapshot.freeDiskBytes).toBe(snapshot.hardwareProfile?.freeDiskBytes);
  });

  it("refreshes an expired hardware snapshot so the displayed recommendation follows load", async () => {
    const stateDir = await temporaryRoot();
    const gib = 1024 ** 3;
    const hardwareProfileProvider = vi
      .fn()
      .mockResolvedValueOnce({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 32 * gib,
        availableMemoryBytes: 24 * gib,
        cpuLogicalCores: 20,
        cpuArchitecture: "x64",
        gpus: [
          {
            name: "GPU",
            dedicatedMemoryBytes: 24 * gib,
            availableMemoryBytes: 22 * gib,
            memoryType: "dedicated" as const,
            computeCompatible: true,
          },
        ],
        freeDiskBytes: 80 * gib,
      })
      .mockResolvedValue({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 32 * gib,
        availableMemoryBytes: 8 * gib,
        cpuLogicalCores: 20,
        cpuArchitecture: "x64",
        gpus: [
          {
            name: "GPU",
            dedicatedMemoryBytes: 24 * gib,
            availableMemoryBytes: 2 * gib,
            memoryType: "dedicated" as const,
            computeCompatible: true,
          },
        ],
        freeDiskBytes: 80 * gib,
      });
    const manager = new LocalModelManager({
      stateDir,
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      hardwareProfileProvider,
      hardwareProfileTtlMs: 0,
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
    });

    expect((await manager.getSnapshot()).recommendedModelId).toBe("gpt-oss-20b");
    expect((await manager.getSnapshot()).recommendedModelId).toBe("granite-4.1-3b");
    expect(hardwareProfileProvider).toHaveBeenCalledTimes(2);
  });

  it("uses the physical Apple Silicon host architecture when the app runs under Rosetta", async () => {
    const stateDir = await temporaryRoot();
    const manager = new LocalModelManager({
      stateDir,
      platform: "darwin",
      totalMemoryBytes: 16 * 1024 ** 3,
      availableMemoryBytes: 12 * 1024 ** 3,
      cpuLogicalCores: 8,
      freeDiskBytes: 64 * 1024 ** 3,
      env: {
        PATH: "",
        DJL_HOST_ARCH: "arm64",
        DJL_PROCESS_ARCH: "x64",
        DJL_RUNNING_UNDER_TRANSLATION: "1",
      },
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
    });

    expect((await manager.getSnapshot()).hardwareProfile).toMatchObject({
      cpuArchitecture: "arm64",
      processArchitecture: "x64",
      runningUnderTranslation: true,
    });
  });

  it("passes the Apple Silicon host architecture to setup installers under Rosetta", async () => {
    const stateDir = await temporaryRoot();
    const installLmStudio = vi.fn(async () => {
      throw new Error("stop after architecture check");
    });
    const manager = new LocalModelManager({
      stateDir,
      platform: "darwin",
      env: {
        PATH: "",
        DJL_HOST_ARCH: "arm64",
        DJL_PROCESS_ARCH: "x64",
        DJL_RUNNING_UNDER_TRANSLATION: "1",
      },
      hardwareProfileProvider: async () => ({
        platform: "darwin",
        osVersion: "15.6",
        totalMemoryBytes: 16 * 1024 ** 3,
        availableMemoryBytes: 12 * 1024 ** 3,
        cpuLogicalCores: 8,
        cpuArchitecture: "arm64",
        processArchitecture: "x64",
        runningUnderTranslation: true,
        gpus: [
          {
            name: "Apple GPU",
            dedicatedMemoryBytes: null,
            availableMemoryBytes: null,
            memoryType: "unified",
          },
        ],
        freeDiskBytes: 64 * 1024 ** 3,
      }),
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
      installLmStudio,
    });

    const started = await manager.startSetup({ runtime: "lmstudio" });
    await vi.waitFor(async () => {
      const job = (await manager.getSnapshot()).setupJobs.find(({ id }) => id === started.id);
      expect(job?.state).toBe("failed");
    });

    expect(installLmStudio).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "darwin", arch: "arm64" }),
    );
  });

  it("refreshes available RAM and VRAM before choosing a one-click setup model", async () => {
    const stateDir = await temporaryRoot();
    const gib = 1024 ** 3;
    const profiles = [
      {
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 32 * gib,
        availableMemoryBytes: 24 * gib,
        cpuLogicalCores: 20,
        cpuArchitecture: "x64",
        gpus: [
          {
            name: "RTX 4070 SUPER",
            dedicatedMemoryBytes: 12 * gib,
            availableMemoryBytes: 11 * gib,
            memoryType: "dedicated" as const,
            computeCompatible: true,
          },
        ],
        freeDiskBytes: 80 * gib,
      },
      {
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 32 * gib,
        availableMemoryBytes: Math.round(4.9 * gib),
        cpuLogicalCores: 20,
        cpuArchitecture: "x64",
        gpus: [
          {
            name: "RTX 4070 SUPER",
            dedicatedMemoryBytes: 12 * gib,
            availableMemoryBytes: Math.round(5.5 * gib),
            memoryType: "dedicated" as const,
            computeCompatible: true,
          },
        ],
        freeDiskBytes: 80 * gib,
      },
    ];
    let profileIndex = 0;
    const hardwareProfileProvider = vi.fn(
      async () => profiles[Math.min(profileIndex++, profiles.length - 1)]!,
    );
    const manager = new LocalModelManager({
      stateDir,
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      hardwareProfileProvider,
      fetch: vi.fn(async () => {
        throw new Error("not running");
      }),
      installOllama: vi.fn(async () => {
        throw new Error("stop after recommendation");
      }),
    });

    expect((await manager.getSnapshot()).recommendedModelId).toBe("gpt-oss-20b");

    const started = await manager.startSetup({ runtime: "ollama" });

    expect(started.recommendationId).toBe("granite-4.1-3b");
    expect(started.modelId).toBe("granite4.1:3b");
    expect(hardwareProfileProvider).toHaveBeenCalledTimes(2);
    await vi.waitFor(async () => {
      const job = (await manager.getSnapshot()).setupJobs.find(({ id }) => id === started.id);
      expect(job?.state).toBe("failed");
    });
  });

  it("keeps canary downgrade inside the selected coding category", async () => {
    const stateDir = await temporaryRoot();
    const installed = new Set<string>();
    const removed: string[] = [];
    const setupMessages: string[] = [];
    const runInferenceCanary = vi.fn(async ({ modelId }: { modelId: string }) => {
      if (modelId === "qwen3-coder:30b") throw new Error("model could not load");
    });
    const manager = new LocalModelManager({
      stateDir,
      platform: "linux",
      env: { PATH: "" },
      hardwareProfileProvider: async () => ({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 64 * 1024 ** 3,
        availableMemoryBytes: 56 * 1024 ** 3,
        cpuLogicalCores: 16,
        cpuArchitecture: "x64",
        gpus: [],
        freeDiskBytes: 80 * 1024 ** 3,
      }),
      runInferenceCanary,
      onSnapshot: (snapshot) => {
        const message = snapshot.setupJobs[0]?.message;
        if (message) setupMessages.push(message);
      },
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/version")) return json({ version: "0.32.0" });
        if (url.endsWith("/api/tags")) {
          return json({ models: [...installed].map((name) => ({ name, size: 100 })) });
        }
        if (url.endsWith("/api/v1/models")) return json({ models: [] });
        if (url.endsWith("/api/delete")) {
          const body = JSON.parse(String(init?.body)) as { model: string };
          removed.push(body.model);
          installed.delete(body.model);
          return json({});
        }
        if (url.endsWith("/api/pull")) {
          const body = JSON.parse(String(init?.body)) as { model: string };
          installed.add(body.model);
          return new Response(
            new TextEncoder().encode('{"status":"success","completed":100,"total":100}\n'),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    });

    const started = await manager.startSetup({ runtime: "ollama", useCase: "coding" });
    await vi.waitFor(async () => {
      const job = (await manager.getSnapshot()).setupJobs.find(({ id }) => id === started.id);
      expect(job?.state).toBe("ready");
      expect(job?.useCase).toBe("coding");
      expect(job?.recommendationId).toBe("qwen2.5-coder-14b");
      expect(job?.modelId).toBe("qwen2.5-coder:14b");
    });

    expect(runInferenceCanary.mock.calls.map(([input]) => input.modelId)).toEqual([
      "qwen3-coder:30b",
      "qwen2.5-coder:14b",
    ]);
    expect(removed).toEqual(["qwen3-coder:30b"]);
    expect(installed).toEqual(new Set(["qwen2.5-coder:14b"]));
    expect(setupMessages.some((message) => message.includes("more compatible"))).toBe(true);
    expect(
      setupMessages.every((message) => !/Ollama|LM Studio|qwen|gpt-oss|:14b|:20b/.test(message)),
    ).toBe(true);
  });

  it("reuses the active runtime setup after automatic downgrade changes its model", async () => {
    const stateDir = await temporaryRoot();
    const installed = new Set(["qwen3-coder:30b"]);
    const removed: string[] = [];
    let releasePull: (() => void) | undefined;
    const hardwareProfileProvider = vi.fn(async () => ({
      platform: "win32",
      osVersion: "10.0.19045",
      totalMemoryBytes: 64 * 1024 ** 3,
      availableMemoryBytes: 56 * 1024 ** 3,
      cpuLogicalCores: 16,
      cpuArchitecture: "x64",
      gpus: [],
      freeDiskBytes: 80 * 1024 ** 3,
    }));
    const manager = new LocalModelManager({
      stateDir,
      platform: "linux",
      env: { PATH: "" },
      hardwareProfileProvider,
      runInferenceCanary: async ({ modelId }) => {
        if (modelId === "qwen3-coder:30b") throw new Error("model could not load");
      },
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/version")) return json({ version: "0.32.0" });
        if (url.endsWith("/api/tags")) {
          return json({ models: [...installed].map((name) => ({ name, size: 100 })) });
        }
        if (url.endsWith("/api/v1/models")) return json({ models: [] });
        if (url.endsWith("/api/delete")) {
          const body = JSON.parse(String(init?.body)) as { model: string };
          removed.push(body.model);
          installed.delete(body.model);
          return json({});
        }
        if (url.endsWith("/api/pull")) {
          const body = JSON.parse(String(init?.body)) as { model: string };
          expect(body.model).toBe("qwen2.5-coder:14b");
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                releasePull = () => {
                  installed.add(body.model);
                  controller.enqueue(
                    new TextEncoder().encode('{"status":"success","completed":100,"total":100}\n'),
                  );
                  controller.close();
                };
              },
            }),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    });

    const started = await manager.startSetup({ runtime: "ollama", useCase: "coding" });
    await vi.waitFor(async () => {
      const job = (await manager.getSnapshot()).setupJobs.find(({ id }) => id === started.id);
      expect(job?.state).toBe("downloading_model");
      expect(job?.useCase).toBe("coding");
      expect(job?.modelId).toBe("qwen2.5-coder:14b");
    });

    const reused = await manager.startSetup({ runtime: "ollama", useCase: "coding" });
    expect(reused.id).toBe(started.id);
    expect(reused.modelId).toBe("qwen2.5-coder:14b");
    await expect(manager.startSetup({ runtime: "ollama", useCase: "document" })).rejects.toThrow(
      "Another local AI is already being prepared",
    );
    await expect(manager.startSetup({ runtime: "lmstudio", useCase: "coding" })).rejects.toThrow(
      "Another local AI is already being prepared",
    );
    expect(hardwareProfileProvider).toHaveBeenCalledOnce();
    expect(removed).toEqual([]);
    expect(installed.has("qwen3-coder:30b")).toBe(true);

    expect(releasePull).toBeTypeOf("function");
    releasePull?.();
    await vi.waitFor(async () => {
      const job = (await manager.getSnapshot()).setupJobs.find(({ id }) => id === started.id);
      expect(job?.state).toBe("ready");
    });
  });

  it("does not retry a failed category while another category uses the same runtime", async () => {
    const stateDir = await temporaryRoot();
    const setupDirectory = join(stateDir, "local-models");
    await mkdir(setupDirectory, { recursive: true });
    await writeFile(
      join(setupDirectory, "setup-state.json"),
      JSON.stringify({
        version: 2,
        jobs: [
          {
            id: "failed-general",
            runtime: "ollama",
            useCase: "general",
            recommendationId: "granite-4.1-3b",
            modelId: "granite4.1:3b",
            state: "failed",
            downloadedBytes: 0,
            totalBytes: 2 * 1024 ** 3,
            message: "Setup failed.",
            startedAt: "2026-07-28T12:00:00.000Z",
            finishedAt: "2026-07-28T12:01:00.000Z",
          },
          {
            id: "active-coding",
            runtime: "ollama",
            useCase: "coding",
            recommendationId: "qwen2.5-coder-7b",
            modelId: "qwen2.5-coder:7b",
            state: "downloading_model",
            downloadedBytes: 1,
            totalBytes: 4 * 1024 ** 3,
            message: "Downloading local AI…",
            startedAt: "2026-07-28T12:02:00.000Z",
            finishedAt: null,
          },
        ],
      }),
    );
    const manager = new LocalModelManager({
      stateDir,
      platform: "linux",
      env: { PATH: "" },
      fetch: vi.fn(async () => {
        throw new Error("runtime unavailable");
      }),
    });

    await expect(manager.retrySetup("failed-general")).rejects.toThrow(
      "Another local AI is already being prepared",
    );
    await vi.waitFor(async () => {
      const active = (await manager.getSnapshot()).setupJobs.find(
        ({ id }) => id === "active-coding",
      );
      expect(active?.state).toBe("failed");
    });
  });

  it("coalesces concurrent retries of the same failed setup job", async () => {
    const stateDir = await temporaryRoot();
    const setupDirectory = join(stateDir, "local-models");
    await mkdir(setupDirectory, { recursive: true });
    await writeFile(
      join(setupDirectory, "setup-state.json"),
      JSON.stringify({
        version: 2,
        jobs: [
          {
            id: "failed-general",
            runtime: "ollama",
            useCase: "general",
            recommendationId: "granite-4.1-3b",
            modelId: "granite4.1:3b",
            state: "failed",
            downloadedBytes: 0,
            totalBytes: 2 * 1024 ** 3,
            message: "Setup failed.",
            startedAt: "2026-07-28T12:00:00.000Z",
            finishedAt: "2026-07-28T12:01:00.000Z",
          },
        ],
      }),
    );
    let releaseHardwareProbe: (() => void) | undefined;
    const hardwareProbeGate = new Promise<void>((resolve) => {
      releaseHardwareProbe = resolve;
    });
    const hardwareProfileProvider = vi.fn(async () => {
      await hardwareProbeGate;
      return {
        platform: "win32" as const,
        osVersion: "10.0.19045",
        totalMemoryBytes: 8 * 1024 ** 3,
        availableMemoryBytes: 8 * 1024 ** 3,
        cpuLogicalCores: 8,
        cpuArchitecture: "x64",
        gpus: [],
        freeDiskBytes: 64 * 1024 ** 3,
      };
    });
    const runInferenceCanary = vi.fn(async () => undefined);
    const manager = new LocalModelManager({
      stateDir,
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      hardwareProfileProvider,
      runInferenceCanary,
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version")) return json({ version: "0.32.0" });
        if (url.endsWith("/api/tags")) {
          return json({ models: [{ name: "granite4.1:3b", size: 100 }] });
        }
        if (url.endsWith("/api/v1/models")) return json({ models: [] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    });

    const firstRetry = manager.retrySetup("failed-general");
    const secondRetry = manager.retrySetup("failed-general");
    await vi.waitFor(() => expect(hardwareProfileProvider).toHaveBeenCalledTimes(2));
    releaseHardwareProbe?.();

    const [first, second] = await Promise.all([firstRetry, secondRetry]);
    expect(first.id).toBe("failed-general");
    expect(second.id).toBe("failed-general");
    await vi.waitFor(async () => {
      const job = (await manager.getSnapshot()).setupJobs.find(({ id }) => id === "failed-general");
      expect(job?.state).toBe("ready");
    });
    expect(runInferenceCanary).toHaveBeenCalledOnce();
  });

  it("falls back when real local inference exceeds the usability threshold", async () => {
    const stateDir = await temporaryRoot();
    const canaryModels: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/version")) return json({ version: "0.32.0" });
      if (url.endsWith("/api/tags")) {
        return json({
          models: [
            { name: "qwen3-coder:30b", size: 100 },
            { name: "qwen2.5-coder:14b", size: 100 },
          ],
        });
      }
      if (url.endsWith("/api/v1/models")) return json({ models: [] });
      if (url.endsWith("/v1/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as { model: string };
        canaryModels.push(body.model);
        if (body.model === "qwen3-coder:30b") {
          await new Promise((resolve) => setTimeout(resolve, 75));
        }
        return json({ choices: [{ message: { content: "READY" } }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = new LocalModelManager({
      stateDir,
      platform: "linux",
      env: { PATH: "" },
      canaryRequestTimeoutMs: 500,
      canaryUsabilityThresholdMs: 50,
      hardwareProfileProvider: async () => ({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 64 * 1024 ** 3,
        availableMemoryBytes: 56 * 1024 ** 3,
        cpuLogicalCores: 16,
        cpuArchitecture: "x64",
        gpus: [],
        freeDiskBytes: 80 * 1024 ** 3,
      }),
      fetch: fetchMock,
    });

    const started = await manager.startSetup({ runtime: "ollama", useCase: "coding" });
    await vi.waitFor(async () => {
      const job = (await manager.getSnapshot()).setupJobs.find(({ id }) => id === started.id);
      expect(job).toMatchObject({
        state: "ready",
        recommendationId: "qwen2.5-coder-14b",
        modelId: "qwen2.5-coder:14b",
      });
    });
    expect(canaryModels).toEqual(["qwen3-coder:30b", "qwen2.5-coder:14b"]);
  });

  it("falls back when the local inference canary reaches its hard timeout", async () => {
    const stateDir = await temporaryRoot();
    const canaryModels: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/version")) return json({ version: "0.32.0" });
      if (url.endsWith("/api/tags")) {
        return json({
          models: [
            { name: "qwen3-coder:30b", size: 100 },
            { name: "qwen2.5-coder:14b", size: 100 },
          ],
        });
      }
      if (url.endsWith("/api/v1/models")) return json({ models: [] });
      if (url.endsWith("/v1/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as { model: string };
        canaryModels.push(body.model);
        if (body.model === "qwen3-coder:30b") {
          return await new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            const rejectAborted = () =>
              reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
            if (signal?.aborted) rejectAborted();
            else signal?.addEventListener("abort", rejectAborted, { once: true });
          });
        }
        return json({ choices: [{ message: { content: "READY" } }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = new LocalModelManager({
      stateDir,
      platform: "linux",
      env: { PATH: "" },
      canaryRequestTimeoutMs: 25,
      canaryUsabilityThresholdMs: 500,
      hardwareProfileProvider: async () => ({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 64 * 1024 ** 3,
        availableMemoryBytes: 56 * 1024 ** 3,
        cpuLogicalCores: 16,
        cpuArchitecture: "x64",
        gpus: [],
        freeDiskBytes: 80 * 1024 ** 3,
      }),
      fetch: fetchMock,
    });

    const started = await manager.startSetup({ runtime: "ollama", useCase: "coding" });
    await vi.waitFor(async () => {
      const job = (await manager.getSnapshot()).setupJobs.find(({ id }) => id === started.id);
      expect(job).toMatchObject({
        state: "ready",
        recommendationId: "qwen2.5-coder-14b",
        modelId: "qwen2.5-coder:14b",
      });
    });
    expect(canaryModels).toEqual(["qwen3-coder:30b", "qwen2.5-coder:14b"]);
  });

  it("fails safely when the smallest model returns an empty canary response", async () => {
    const stateDir = await temporaryRoot();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/version")) return json({ version: "0.32.0" });
      if (url.endsWith("/api/tags")) {
        return json({ models: [{ name: "granite4.1:3b", size: 100 }] });
      }
      if (url.endsWith("/api/v1/models")) return json({ models: [] });
      if (url.endsWith("/v1/chat/completions")) {
        return json({ choices: [{ message: { content: "" } }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = new LocalModelManager({
      stateDir,
      fetch: fetchMock,
      totalMemoryBytes: 8 * 1024 ** 3,
      freeDiskBytes: 20 * 1024 ** 3,
      platform: "linux",
      env: { PATH: "" },
    });

    const started = await manager.startSetup({ runtime: "ollama" });
    await vi.waitFor(async () => {
      const job = (await manager.getSnapshot()).setupJobs.find(({ id }) => id === started.id);
      expect(job?.state).toBe("failed");
      expect(job?.message).toBe("Local AI setup could not be completed. Retry setup.");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("starts a stopped local runtime on demand before chat", async () => {
    const stateDir = await temporaryRoot();
    const command = join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama.exe");
    await mkdir(join(command, ".."), { recursive: true });
    await writeFile(command, "runtime");
    let running = false;
    const spawnRuntime = vi.fn((_command: string, _args: string[], _options: SpawnOptions) => {
      running = true;
      return { once: vi.fn(), unref: vi.fn() };
    });
    const manager = new LocalModelManager({
      stateDir,
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version")) {
          if (!running) throw new Error("stopped");
          return json({ version: "0.32.0" });
        }
        if (url.endsWith("/api/tags") || url.endsWith("/api/v1/models")) {
          return json({ models: [] });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
      spawnRuntime,
    });

    await manager.ensureRuntimeForModel("ollama/granite4.1:3b");

    expect(spawnRuntime).toHaveBeenCalledOnce();
    expect(spawnRuntime).toHaveBeenCalledWith(
      command,
      ["serve"],
      expect.objectContaining({
        detached: false,
        stdio: "ignore",
        windowsHide: true,
      }),
    );
  });

  it("coalesces concurrent Windows Ollama starts into one hidden process", async () => {
    const stateDir = await temporaryRoot();
    const command = join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama.exe");
    await mkdir(join(command, ".."), { recursive: true });
    await writeFile(command, "runtime");
    let running = false;
    const spawnRuntime = vi.fn(() => {
      running = true;
      return { once: vi.fn(), unref: vi.fn() };
    });
    const manager = new LocalModelManager({
      stateDir,
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version")) {
          if (!running) throw new Error("stopped");
          return json({ version: "0.32.0" });
        }
        if (url.endsWith("/api/tags") || url.endsWith("/api/v1/models")) {
          return json({ models: [] });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
      spawnRuntime,
    });

    await Promise.all([manager.startRuntime("ollama"), manager.startRuntime("ollama")]);

    expect(spawnRuntime).toHaveBeenCalledOnce();
  });

  it("waits through a slow Windows Ollama cold start instead of inviting retries", async () => {
    let nowMs = 0;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    try {
      const stateDir = await temporaryRoot();
      const command = join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama.exe");
      await mkdir(join(command, ".."), { recursive: true });
      await writeFile(command, "runtime");
      const manager = new LocalModelManager({
        stateDir,
        platform: "win32",
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        fetch: vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith("/api/version")) {
            nowMs += 5_000;
            if (nowMs < 25_000) throw new Error("stopped");
            return json({ version: "0.32.0" });
          }
          if (url.endsWith("/api/tags") || url.endsWith("/api/v1/models")) {
            return json({ models: [] });
          }
          throw new Error(`Unexpected request: ${url}`);
        }),
        spawnRuntime: () => {
          return { once: vi.fn(), unref: vi.fn() };
        },
      });

      const outcome = manager.startRuntime("ollama").then(
        () => "ready",
        (error: Error) => error.message,
      );
      await expect(outcome).resolves.toBe("ready");
    } finally {
      dateNow.mockRestore();
    }
  });

  it("installs Ollama into managed storage and starts it automatically", async () => {
    const stateDir = await temporaryRoot();
    let running = false;
    const installOllama = vi.fn(async ({ onProgress }) => {
      await onProgress({
        state: "downloading",
        downloadedBytes: 50,
        totalBytes: 100,
        message: "Downloading Ollama…",
      });
      return {
        command: join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama"),
        version: "v0.32.0",
      };
    });
    const spawnRuntime = vi.fn((_command: string, _args: string[], _options: SpawnOptions) => {
      running = true;
      return { once: vi.fn(), unref: vi.fn() };
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/version")) {
        if (!running) throw new Error("not running");
        return json({ version: "0.32.0" });
      }
      if (url.endsWith("/api/tags")) return json({ models: [] });
      if (url.endsWith("/api/v1/models")) return json({ models: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = new LocalModelManager({
      stateDir,
      fetch: fetchMock,
      platform: "darwin",
      env: {
        PATH: "",
        CUDA_VISIBLE_DEVICES: "-1",
        GGML_VK_VISIBLE_DEVICES: "-1",
        OLLAMA_VULKAN: "0",
        Vk_Driver_Files: "C:\\untrusted-vulkan-driver.json",
        VK_INSTANCE_LAYERS: "untrusted-instance-layer",
        VK_LOADER_LAYERS_ALLOW: "untrusted-allowed-layer",
      },
      hardwareProfileProvider: async () => ({
        platform: "darwin",
        osVersion: "15.6",
        totalMemoryBytes: 16 * 1024 ** 3,
        availableMemoryBytes: 12 * 1024 ** 3,
        cpuLogicalCores: 8,
        cpuArchitecture: "arm64",
        gpus: [],
        freeDiskBytes: 64 * 1024 ** 3,
      }),
      installOllama,
      spawnRuntime,
    });

    const snapshot = await manager.installRuntime("ollama");

    expect(installOllama).toHaveBeenCalledOnce();
    expect(spawnRuntime).toHaveBeenCalledWith(
      expect.stringMatching(/local-models[\\/]runtimes[\\/]ollama[\\/]current[\\/]ollama$/u),
      ["serve"],
      expect.objectContaining({
        // Keep Ollama's own context default while applying only DJL-owned safety settings.
        env: expect.objectContaining({
          OLLAMA_MODELS: expect.any(String),
          VK_LOADER_LAYERS_DISABLE: "~implicit~",
        }),
      }),
    );
    expect(spawnRuntime).toHaveBeenCalledWith(
      expect.any(String),
      ["serve"],
      expect.objectContaining({
        env: expect.not.objectContaining({ OLLAMA_CONTEXT_LENGTH: expect.anything() }),
      }),
    );
    const managedEnvironment = spawnRuntime.mock.calls[0]?.[2]?.env;
    expect(managedEnvironment).not.toHaveProperty("CUDA_VISIBLE_DEVICES");
    expect(managedEnvironment).not.toHaveProperty("GGML_VK_VISIBLE_DEVICES");
    expect(managedEnvironment).not.toHaveProperty("OLLAMA_VULKAN");
    expect(managedEnvironment).not.toHaveProperty("Vk_Driver_Files");
    expect(managedEnvironment).not.toHaveProperty("VK_INSTANCE_LAYERS");
    expect(managedEnvironment).not.toHaveProperty("VK_LOADER_LAYERS_ALLOW");
    expect(snapshot.runtimes.find(({ runtime }) => runtime === "ollama")?.state).toBe("running");
    expect(snapshot.runtimeInstallJobs[0]).toMatchObject({
      runtime: "ollama",
      state: "completed",
      downloadedBytes: 50,
      totalBytes: 100,
    });
  });

  it("does not mistake an orphaned LM Studio CLI for an installed runtime", async () => {
    const stateDir = await temporaryRoot();
    const homeDir = join(stateDir, "home");
    const command = join(homeDir, ".lmstudio", "bin", "lms");
    await mkdir(join(command, ".."), { recursive: true });
    await writeFile(command, "stale cli", { mode: 0o755 });
    const manager = new LocalModelManager({
      stateDir,
      platform: "darwin",
      env: { PATH: "", HOME: homeDir },
      fetch: vi.fn(async () => {
        throw new Error("local runtimes unavailable");
      }),
    });

    const snapshot = await manager.getSnapshot();

    expect(snapshot.runtimes.find(({ runtime }) => runtime === "lmstudio")?.state).toBe(
      "not_installed",
    );
  });

  it("starts an external LM Studio daemon before its localhost server", async () => {
    const stateDir = await temporaryRoot();
    const homeDir = join(stateDir, "home");
    const command = join(homeDir, ".lmstudio", "bin", "lms");
    const appCommand = join(stateDir, "LM Studio.app", "Contents", "MacOS", "LM Studio");
    await mkdir(join(command, ".."), { recursive: true });
    await mkdir(join(homeDir, ".lmstudio", ".internal"), { recursive: true });
    await mkdir(join(appCommand, ".."), { recursive: true });
    await writeFile(command, "cli", { mode: 0o755 });
    await writeFile(appCommand, "app", { mode: 0o755 });
    await writeFile(
      join(homeDir, ".lmstudio", ".internal", "app-install-location.json"),
      JSON.stringify({ path: appCommand }),
    );
    let running = false;
    let finishDaemon: ((code: number, signal: null) => void) | undefined;
    const spawnRuntime = vi.fn((_command: string, args: string[]) => {
      const child = { once: vi.fn(), unref: vi.fn() };
      child.once.mockImplementation((event: string, listener: (...args: never[]) => void) => {
        if (args[0] === "daemon" && event === "exit") {
          finishDaemon = listener as (code: number, signal: null) => void;
        }
        return child;
      });
      if (args[0] === "server") running = true;
      return child;
    });
    const manager = new LocalModelManager({
      stateDir,
      platform: "darwin",
      env: { PATH: "", HOME: homeDir },
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version") || url.endsWith("/api/tags")) {
          throw new Error("Ollama unavailable");
        }
        if (url.endsWith("/api/v1/models")) {
          if (!running) throw new Error("LM Studio unavailable");
          return json({ models: [] });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
      spawnRuntime,
    });

    const started = manager.startRuntime("lmstudio");

    await vi.waitFor(() => expect(spawnRuntime).toHaveBeenCalledOnce());
    expect(finishDaemon).toBeTypeOf("function");
    finishDaemon!(0, null);
    await started;

    expect(spawnRuntime).toHaveBeenNthCalledWith(
      1,
      command,
      ["daemon", "up", "--json"],
      expect.any(Object),
    );
    expect(spawnRuntime).toHaveBeenNthCalledWith(
      2,
      command,
      ["server", "start", "--port", "1234"],
      expect.any(Object),
    );
  });

  it("reports an LM Studio CLI exit instead of waiting for the readiness timeout", async () => {
    const stateDir = await temporaryRoot();
    const homeDir = join(stateDir, "home");
    const command = join(homeDir, ".lmstudio", "bin", "lms");
    const appCommand = join(stateDir, "LM Studio.app", "Contents", "MacOS", "LM Studio");
    await mkdir(join(command, ".."), { recursive: true });
    await mkdir(join(homeDir, ".lmstudio", ".internal"), { recursive: true });
    await mkdir(join(appCommand, ".."), { recursive: true });
    await writeFile(command, "cli", { mode: 0o755 });
    await writeFile(appCommand, "app", { mode: 0o755 });
    await writeFile(
      join(homeDir, ".lmstudio", ".internal", "app-install-location.json"),
      JSON.stringify({ path: appCommand }),
    );
    const dateNow = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValue(100_000);
    try {
      const child = {
        once: vi.fn(),
        unref: vi.fn(),
      };
      child.once.mockImplementation((event: string, listener: (...args: never[]) => void) => {
        if (event === "exit") {
          (listener as (code: number, signal: null) => void)(1, null);
        }
        return child;
      });
      const manager = new LocalModelManager({
        stateDir,
        platform: "darwin",
        env: { PATH: "", HOME: homeDir },
        fetch: vi.fn(async () => {
          throw new Error("local runtimes unavailable");
        }),
        spawnRuntime: () => child,
      });

      await expect(manager.startRuntime("lmstudio")).rejects.toThrow("exited with code 1");
    } finally {
      dateNow.mockRestore();
    }
  });

  it("installs the managed LM Studio engine and starts its localhost server", async () => {
    const stateDir = await temporaryRoot();
    let running = false;
    const command = join(
      stateDir,
      "local-models",
      "runtimes",
      "lmstudio",
      "current",
      ".lmstudio",
      "bin",
      "lms.exe",
    );
    const installLmStudio = vi.fn(async () => ({
      command,
      version: "0.0.19-2",
      homeDir: join(stateDir, "local-models", "runtimes", "lmstudio", "current"),
    }));
    const spawnRuntime = vi.fn((_command: string, args: string[]) => {
      const child = { once: vi.fn(), unref: vi.fn() };
      child.once.mockImplementation((event: string, listener: (...args: never[]) => void) => {
        if (args[0] === "daemon" && event === "exit") {
          (listener as (code: number, signal: null) => void)(0, null);
        }
        return child;
      });
      if (args[0] === "server") running = true;
      return child;
    });
    const manager = new LocalModelManager({
      stateDir,
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
      hardwareProfileProvider: async () => ({
        platform: "win32",
        osVersion: "10.0.19045",
        totalMemoryBytes: 16 * 1024 ** 3,
        availableMemoryBytes: 12 * 1024 ** 3,
        cpuLogicalCores: 8,
        cpuArchitecture: "x64",
        gpus: [],
        freeDiskBytes: 64 * 1024 ** 3,
      }),
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version") || url.endsWith("/api/tags")) {
          throw new Error("Ollama unavailable");
        }
        if (url.endsWith("/api/v1/models")) {
          if (!running) throw new Error("LM Studio unavailable");
          return json({ models: [] });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
      installLmStudio,
      spawnRuntime,
    });

    const snapshot = await manager.installRuntime("lmstudio");

    expect(installLmStudio).toHaveBeenCalledOnce();
    expect(spawnRuntime).toHaveBeenNthCalledWith(
      1,
      command,
      ["daemon", "up", "--json"],
      expect.objectContaining({
        env: expect.objectContaining({
          HOME: expect.stringMatching(/lmstudio[\\/]current$/u),
        }),
      }),
    );
    expect(spawnRuntime).toHaveBeenCalledWith(
      command,
      ["server", "start", "--port", "1234"],
      expect.objectContaining({
        env: expect.objectContaining({
          HOME: expect.stringMatching(/lmstudio[\\/]current$/u),
        }),
      }),
    );
    expect(snapshot.runtimes.find(({ runtime }) => runtime === "lmstudio")?.state).toBe("running");
    expect(snapshot.runtimeInstallJobs.find(({ runtime }) => runtime === "lmstudio")?.state).toBe(
      "completed",
    );
  });

  it("reports an Ollama installer failure and permits a one-click retry", async () => {
    const stateDir = await temporaryRoot();
    let running = false;
    const installOllama = vi
      .fn()
      .mockRejectedValueOnce(new Error("The download was interrupted."))
      .mockResolvedValueOnce({
        command: join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama"),
        version: "v0.32.0",
      });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/version")) {
        if (!running) throw new Error("not running");
        return json({ version: "0.32.0" });
      }
      if (url.endsWith("/api/tags") || url.endsWith("/api/v1/models")) {
        return json({ models: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = new LocalModelManager({
      stateDir,
      fetch: fetchMock,
      platform: "darwin",
      env: { PATH: "" },
      hardwareProfileProvider: async () => ({
        platform: "darwin",
        osVersion: "15.6",
        totalMemoryBytes: 16 * 1024 ** 3,
        availableMemoryBytes: 12 * 1024 ** 3,
        cpuLogicalCores: 8,
        cpuArchitecture: "arm64",
        gpus: [],
        freeDiskBytes: 64 * 1024 ** 3,
      }),
      installOllama,
      spawnRuntime: () => {
        running = true;
        return { once: vi.fn(), unref: vi.fn() };
      },
    });

    await expect(manager.installRuntime("ollama")).rejects.toThrow("The download was interrupted.");
    expect((await manager.getSnapshot()).runtimeInstallJobs[0]).toMatchObject({
      state: "failed",
      message: "The download was interrupted.",
    });

    const retried = await manager.installRuntime("ollama");
    expect(installOllama).toHaveBeenCalledTimes(2);
    expect(retried.runtimeInstallJobs[0]?.state).toBe("completed");
  });

  it("discovers both inventories and writes managed OpenCode providers", async () => {
    const stateDir = await temporaryRoot();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/version")) return json({ version: "0.11.0" });
      if (url.endsWith("/api/tags")) {
        return json({ models: [{ name: "qwen3:1.7b", size: 2_000 }] });
      }
      if (url.endsWith("/api/v1/models")) {
        return json({
          models: [
            {
              type: "llm",
              key: "qwen/qwen3.5-2b",
              display_name: "Qwen3.5 2B",
              size_bytes: 12_000,
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = new LocalModelManager({
      stateDir,
      fetch: fetchMock,
      totalMemoryBytes: 16 * 1024 ** 3,
      // Pinned so the recommendation does not depend on whether the test host has a GPU.
      hardwareProfile: {
        totalMemoryBytes: 16 * 1024 ** 3,
        cpuModel: "Test CPU",
        cpuCores: 8,
        acceleration: "cpu_only",
        gpuName: null,
        vramBytes: null,
        usableModelBytes: usableModelBytes({
          acceleration: "cpu_only",
          totalMemoryBytes: 16 * 1024 ** 3,
        }),
      },
      hardwareProfileProvider: async () => ({
        platform: "linux",
        osVersion: "6.8.0",
        totalMemoryBytes: 16 * 1024 ** 3,
        availableMemoryBytes: 16 * 1024 ** 3,
        cpuLogicalCores: 8,
        cpuArchitecture: "x64",
        gpus: [],
        freeDiskBytes: 200 * 1024 ** 3,
      }),
      platform: "linux",
      freeDiskBytes: 200 * 1024 ** 3,
      env: { PATH: "" },
    });

    const snapshot = await manager.getSnapshot();

    // 16 GB of system RAM with no GPU cannot run a 13 GB model at usable speed.
    expect(snapshot.recommendedModelId).toBe("granite-4.1-3b");
    expect(snapshot.hardware.acceleration).toBe("cpu_only");
    expect(snapshot.recommendedModelIdsByUseCase).toEqual({
      general: "granite-4.1-3b",
      document: "granite-4.1-3b",
      reasoning: "qwen3.5-2b",
      coding: "qwen2.5-coder-7b",
    });
    expect(snapshot.installedModels).toHaveLength(2);
    expect(
      snapshot.installedModels.every(({ supportsToolCalls }) => supportsToolCalls === false),
    ).toBe(true);
    expect(snapshot.runtimes.every(({ state }) => state === "running")).toBe(true);
    const config = JSON.parse(
      await readFile(join(stateDir, "opencode", "config", "opencode", "opencode.json"), "utf8"),
    );
    // Both are sub-3B curated tiers: measured incapable, so reported incapable.
    expect(config.provider.ollama.models["qwen3:1.7b"]?.tool_call).toBe(false);
    expect(config.provider.lmstudio.models["qwen/qwen3.5-2b"]?.tool_call).toBe(false);
  });

  it("tracks an Ollama pull stream through completion", async () => {
    const stateDir = await temporaryRoot();
    let installed = false;
    const snapshots: unknown[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/version")) return json({ version: "0.11.0" });
      if (url.endsWith("/api/tags")) {
        return json({ models: installed ? [{ name: "granite4.1:3b", size: 100 }] : [] });
      }
      if (url.endsWith("/api/v1/models")) return json({ models: [] });
      if (url.endsWith("/api/pull")) {
        installed = true;
        return new Response(
          new TextEncoder().encode(
            '{"status":"pulling","completed":50,"total":100}\n' +
              '{"status":"success","completed":100,"total":100}\n',
          ),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = new LocalModelManager({
      stateDir,
      fetch: fetchMock,
      platform: "linux",
      env: { PATH: "" },
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const started = await manager.installModel({ runtime: "ollama", modelId: "granite4.1:3b" });
    await vi.waitFor(async () => {
      const snapshot = await manager.getSnapshot();
      expect(snapshot.installJobs.find(({ id }) => id === started.id)?.state).toBe("completed");
    });

    expect(snapshots.length).toBeGreaterThan(0);
  });

  it("tracks an LM Studio download job and refreshes inventory on completion", async () => {
    const stateDir = await temporaryRoot();
    let installed = false;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/version")) return json({ version: "0.11.0" });
      if (url.endsWith("/api/tags")) return json({ models: [] });
      if (url.endsWith("/api/v1/models/download")) {
        return json({ job_id: "lm-job-1", status: "downloading", total_size_bytes: 100 });
      }
      if (url.endsWith("/api/v1/models/download/status/lm-job-1")) {
        installed = true;
        return json({ status: "completed", downloaded_size_bytes: 100, total_size_bytes: 100 });
      }
      if (url.endsWith("/api/v1/models")) {
        return json({
          models: installed
            ? [
                {
                  type: "llm",
                  key: "openai/gpt-oss-20b",
                  display_name: "GPT-OSS 20B",
                  size_bytes: 100,
                },
              ]
            : [],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = new LocalModelManager({
      stateDir,
      fetch: fetchMock,
      platform: "linux",
      env: { PATH: "" },
    });

    const started = await manager.installModel({
      runtime: "lmstudio",
      modelId: "openai/gpt-oss-20b",
    });
    await vi.waitFor(async () => {
      const snapshot = await manager.getSnapshot();
      expect(snapshot.installJobs.find(({ id }) => id === started.id)?.state).toBe("completed");
      expect(snapshot.installedModels.some(({ modelId }) => modelId === "openai/gpt-oss-20b")).toBe(
        true,
      );
    });

    await expect(manager.cancelInstall(started.id)).rejects.toThrow(
      "LM Studio downloads must be managed in LM Studio",
    );
  });

  it("keeps tracking when an LM Studio download recovers from a transient failed status", async () => {
    const stateDir = await temporaryRoot();
    let statusRequestCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/version")) return json({ version: "0.11.0" });
      if (url.endsWith("/api/tags")) return json({ models: [] });
      if (url.endsWith("/api/v1/models/download")) {
        return json({ job_id: "lm-job-retry", status: "downloading", total_size_bytes: 100 });
      }
      if (url.endsWith("/api/v1/models/download/status/lm-job-retry")) {
        statusRequestCount += 1;
        if (statusRequestCount === 1) {
          return json({ status: "failed", downloaded_bytes: 40, total_size_bytes: 100 });
        }
        if (statusRequestCount === 2) {
          return json({ status: "downloading", downloaded_bytes: 70, total_size_bytes: 100 });
        }
        return json({ status: "completed", downloaded_bytes: 100, total_size_bytes: 100 });
      }
      if (url.endsWith("/api/v1/models")) return json({ models: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    const manager = new LocalModelManager({
      stateDir,
      fetch: fetchMock,
      platform: "linux",
      env: { PATH: "" },
    });

    const started = await manager.installModel({
      runtime: "lmstudio",
      modelId: "ibm/granite-4.1-3b",
    });

    await vi.waitFor(
      async () => {
        const snapshot = await manager.getSnapshot();
        expect(snapshot.installJobs.find(({ id }) => id === started.id)?.state).toBe("completed");
      },
      { timeout: 5_000 },
    );
    expect(statusRequestCount).toBe(3);
  });
});
