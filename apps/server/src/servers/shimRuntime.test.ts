import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../config";
import { ShimRuntime, ShimRuntimeLive } from "./shimRuntime";

const ENV_KEYS = ["PATH", "DJL_SSH_SHIM_TOKEN", "DJL_SSH_SHIM_BIN", "DJL_SSH_SHIM_URL"] as const;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.PATH = "/usr/bin:/bin";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const construct = (baseDir: string) =>
  Effect.gen(function* () {
    const runtime = yield* ShimRuntime;
    const config = yield* ServerConfig;
    return { runtime, config };
  }).pipe(
    Effect.provide(
      ShimRuntimeLive.pipe(
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provide(NodeServices.layer),
      ),
    ),
    Effect.scoped,
    Effect.runPromise,
  );

describe("ShimRuntimeLive", () => {
  it("writes the shim scripts, exports the env and prepends PATH exactly once", async () => {
    const baseDir = fs.mkdtempSync(path.join(process.cwd(), "shim-runtime-test-"));
    try {
      const { runtime, config } = await construct(baseDir);
      expect(runtime.binDir).toBe(path.join(config.stateDir, "bin"));
      expect(runtime.token).toMatch(/^[0-9a-f]{64}$/);
      expect(runtime.url).toBe(`http://127.0.0.1:${config.port}/api/servers/shim/exec`);

      const posix = path.join(runtime.binDir, "djl-ssh");
      const cmd = path.join(runtime.binDir, "djl-ssh.cmd");
      expect(fs.readFileSync(posix, "utf8")).toContain("curl -sS");
      expect(fs.readFileSync(posix, "utf8")).toContain("X-DJL-Server");
      expect(fs.readFileSync(cmd, "utf8")).toContain("curl.exe");
      if (process.platform !== "win32") {
        expect(fs.statSync(posix).mode & 0o777).toBe(0o755);
      }

      expect(process.env.DJL_SSH_SHIM_TOKEN).toBe(runtime.token);
      expect(process.env.DJL_SSH_SHIM_BIN).toBe(runtime.binDir);
      expect(process.env.DJL_SSH_SHIM_URL).toBe(runtime.url);
      expect(process.env.PATH).toBe(`${runtime.binDir}${path.delimiter}/usr/bin:/bin`);

      const second = await construct(baseDir);
      expect(second.runtime.binDir).toBe(runtime.binDir);
      expect(process.env.PATH).toBe(`${runtime.binDir}${path.delimiter}/usr/bin:/bin`);
      expect(process.env.DJL_SSH_SHIM_TOKEN).toBe(second.runtime.token);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "uses the Windows-style Path key when that is what the process has",
    async () => {
      const baseDir = fs.mkdtempSync(path.join(process.cwd(), "shim-runtime-test-"));
      delete process.env.PATH;
      process.env.Path = "C:\\Windows";
      try {
        const { runtime } = await construct(baseDir);
        expect(process.env.Path).toBe(`${runtime.binDir}${path.delimiter}C:\\Windows`);
      } finally {
        delete process.env.Path;
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    },
  );
});
