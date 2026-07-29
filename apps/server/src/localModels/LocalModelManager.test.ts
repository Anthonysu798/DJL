import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      installOllama,
      spawnRuntime: () => {
        running = true;
        return { once: vi.fn(), unref: vi.fn() };
      },
    });

    const started = await manager.startSetup({ runtime: "ollama" });
    await vi.waitFor(async () => {
      const snapshot = await manager.getSnapshot();
      expect(snapshot.setupJobs.find(({ id }) => id === started.id)?.state).toBe("ready");
    });

    expect(installOllama).toHaveBeenCalledOnce();
    const config = JSON.parse(
      await readFile(join(stateDir, "opencode", "config", "opencode", "opencode.json"), "utf8"),
    );
    expect(config.provider.ollama.models["qwen3.5:2b-q4_K_M"]?.tool_call).toBe(true);
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
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        installOllama: vi.fn(async () => ({
          command: join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama"),
          version: "v0.32.0",
        })),
        spawnRuntime: () => {
          running = true;
          return { once: vi.fn(), unref: vi.fn() };
        },
      });
      const started = await manager.startSetup({ runtime: "ollama" });
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
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        installOllama: vi.fn(async () => ({
          command: join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama"),
          version: "v0.32.0",
        })),
        spawnRuntime: () => {
          running = true;
          return { once: vi.fn(), unref: vi.fn() };
        },
      });

      const started = await manager.startSetup({ runtime: "ollama" });
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
        env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
        installOllama: vi.fn(async () => ({
          command: join(stateDir, "local-models", "runtimes", "ollama", "current", "ollama"),
          version: "v0.32.0",
        })),
        spawnRuntime: () => {
          running = true;
          return { once: vi.fn(), unref: vi.fn() };
        },
      });

      const started = await manager.startSetup({ runtime: "ollama" });
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
      env: { PATH: "", LOCALAPPDATA: stateDir, USERPROFILE: stateDir },
    });

    const started = await manager.startSetup({ runtime: "lmstudio" });
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
    expect("error" in outcome ? String(outcome.error) : "").toContain("16 GB");
    expect(installOllama).not.toHaveBeenCalled();
    expect((await manager.getSnapshot()).setupJobs).toHaveLength(0);
  });

  it("reuses the same active setup and rejects a different concurrent setup", async () => {
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
    await expect(
      manager.startSetup({
        runtime: "ollama",
        recommendationId: "granite-4.1-3b",
      }),
    ).rejects.toThrow("another local AI setup");

    expect((await manager.cancelSetup(active.id)).state).toBe("cancelled");
  });

  it("enforces memory and concurrency guards when retrying setup", async () => {
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

    await expect(manager.retrySetup("failed-oversized")).rejects.toThrow("16 GB");
    await expect(manager.retrySetup("failed-safe")).rejects.toThrow("another local AI setup");
    await manager.cancelSetup("active-safe");
  });

  it("starts a stopped local runtime on demand before chat", async () => {
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
    const spawnRuntime = vi.fn(() => {
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
      env: { PATH: "" },
      installOllama,
      spawnRuntime,
    });

    const snapshot = await manager.installRuntime("ollama");

    expect(installOllama).toHaveBeenCalledOnce();
    expect(spawnRuntime).toHaveBeenCalledWith(
      expect.stringMatching(/local-models[\\/]runtimes[\\/]ollama[\\/]current[\\/]ollama$/u),
      ["serve"],
      expect.objectContaining({
        env: expect.objectContaining({
          OLLAMA_CONTEXT_LENGTH: "8192",
          OLLAMA_MODELS: expect.any(String),
        }),
      }),
    );
    expect(snapshot.runtimes.find(({ runtime }) => runtime === "ollama")?.state).toBe("running");
    expect(snapshot.runtimeInstallJobs[0]).toMatchObject({
      runtime: "ollama",
      state: "completed",
      downloadedBytes: 50,
      totalBytes: 100,
    });
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
      platform: "linux",
      env: { PATH: "" },
    });

    const snapshot = await manager.getSnapshot();

    // 16 GB of system RAM with no GPU cannot run a 13 GB model at usable speed.
    expect(snapshot.recommendedModelId).toBe("granite-4.1-3b");
    expect(snapshot.hardware.acceleration).toBe("cpu_only");
    expect(snapshot.installedModels).toHaveLength(2);
    expect(
      snapshot.installedModels.every(({ supportsToolCalls }) => supportsToolCalls === true),
    ).toBe(true);
    expect(snapshot.runtimes.every(({ state }) => state === "running")).toBe(true);
    const config = JSON.parse(
      await readFile(join(stateDir, "opencode", "config", "opencode", "opencode.json"), "utf8"),
    );
    expect(config.provider.ollama.models["qwen3:1.7b"]?.tool_call).toBe(true);
    expect(config.provider.lmstudio.models["qwen/qwen3.5-2b"]?.tool_call).toBe(true);
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
});
