import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
      platform: "linux",
      env: { PATH: "" },
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
      platform: "linux",
      env: { PATH: "" },
    });

    const snapshot = await manager.getSnapshot();

    expect(snapshot.recommendedModelId).toBe("gpt-oss-20b");
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
