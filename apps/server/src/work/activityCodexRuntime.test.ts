import {
  access,
  mkdtemp,
  mkdir,
  open,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveActivityCodexRuntime } from "./activityCodexRuntime";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    access: vi.fn(actual.access),
    open: vi.fn(actual.open),
    realpath: vi.fn(actual.realpath),
    stat: vi.fn(actual.stat),
  };
});

const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function directory() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "djl-codex-runtime-")));
  roots.push(root);
  return root;
}
const signal = () => new AbortController().signal;
const supportedRuntime = process.platform === "darwin" && process.arch === "arm64";
describe("activity Codex runtime verification", () => {
  it.each([
    { platform: "linux", arch: "arm64" },
    { platform: "win32", arch: "arm64" },
    { platform: "darwin", arch: "x64" },
  ])("rejects $platform/$arch before reading PATH or files", async ({ platform, arch }) => {
    const hostProcess = process;
    vi.stubGlobal(
      "process",
      Object.create(hostProcess, { platform: { value: platform }, arch: { value: arch } }),
    );
    try {
      const readPath = vi.fn(() => {
        throw Error("must not read PATH");
      });
      const environment = Object.defineProperty({}, "PATH", {
        get: readPath,
      });
      for (const options of [{}, { binaryPath: path.resolve("unused-runtime") }])
        await expect(
          resolveActivityCodexRuntime({ ...options, environment, signal: signal() }),
        ).rejects.toMatchObject({ code: "provider-unavailable", message: "provider-unavailable" });
      expect(readPath).not.toHaveBeenCalled();
      for (const operation of [access, open, realpath, stat])
        expect(operation).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("process", hostProcess);
    }
  });
  it("rejects unknown executables without running their script", async () => {
    const root = await directory(),
      file = path.join(root, "codex"),
      marker = path.join(root, "must-not-exist");
    await writeFile(file, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
    await expect(
      resolveActivityCodexRuntime({ binaryPath: file, environment: {}, signal: signal() }),
    ).rejects.toMatchObject({ code: "provider-unavailable", message: "provider-unavailable" });
    const { access } = await import("node:fs/promises");
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.runIf(supportedRuntime)(
    "rejects unverified executables resolved from the configured PATH",
    async () => {
      const first = await directory(),
        later = await directory();
      await writeFile(path.join(first, "codex"), "unknown executable", { mode: 0o700 });
      await writeFile(path.join(later, "codex"), "different unknown executable", { mode: 0o700 });
      const opened = vi.mocked(open);
      await expect(
        resolveActivityCodexRuntime({
          environment: { PATH: `${first}:${later}` },
          signal: signal(),
        }),
      ).rejects.toMatchObject({ code: "provider-unavailable" });
      expect(opened).toHaveBeenCalledWith(path.join(first, "codex"), expect.any(Number));
      expect(opened).not.toHaveBeenCalledWith(path.join(later, "codex"), expect.any(Number));
    },
  );
  it.runIf(supportedRuntime).each([false, true])(
    "continues PATH past a searchable directory (symlink: %s)",
    async (linked) => {
      const first = await directory(),
        later = await directory();
      const folder = path.join(first, linked ? "target" : "codex");
      await mkdir(folder, { mode: 0o700 });
      if (linked) await symlink(folder, path.join(first, "codex"));
      const executable = path.join(later, "codex");
      await writeFile(executable, "unknown executable", { mode: 0o700 });
      const opened = vi.mocked(open);
      await expect(
        resolveActivityCodexRuntime({
          environment: { PATH: `${first}:${later}` },
          signal: signal(),
        }),
      ).rejects.toMatchObject({ code: "provider-unavailable" });
      expect(opened).toHaveBeenCalledWith(executable, expect.any(Number));
      expect(opened).not.toHaveBeenCalledWith(folder, expect.any(Number));
    },
  );
  it("rejects an oversized executable before hashing its contents", async () => {
    const root = await directory(),
      file = path.join(root, "oversized");
    const handle = await open(file, "wx", 0o700);
    try {
      await handle.truncate(512 * 1024 * 1024 + 1);
    } finally {
      await handle.close();
    }
    await expect(
      resolveActivityCodexRuntime({ binaryPath: file, environment: {}, signal: signal() }),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
  });
  it.each(["./codex", "../codex", "codex --disable safety", "bad\npath"])(
    "rejects invalid configured command: %s",
    async (binaryPath) => {
      await expect(
        resolveActivityCodexRuntime({ binaryPath, environment: {}, signal: signal() }),
      ).rejects.toMatchObject({ code: "provider-unavailable" });
    },
  );
  it("does not invent PATH candidates from inherited, empty or relative entries", async () => {
    for (const environment of [
      Object.create({ PATH: "/personal-bin" }),
      { PATH: ":relative:./bin" },
      {},
    ])
      await expect(
        resolveActivityCodexRuntime({ environment, signal: signal() }),
      ).rejects.toMatchObject({ code: "provider-unavailable" });
  });
  it("rejects missing, nonregular, nonexecutable or dangling configured paths", async () => {
    const root = await directory();
    await mkdir(path.join(root, "folder"));
    await writeFile(path.join(root, "plain"), "text", { mode: 0o600 });
    await symlink(path.join(root, "missing"), path.join(root, "link"));
    for (const name of ["missing", "folder", "plain", "link"])
      await expect(
        resolveActivityCodexRuntime({
          binaryPath: path.join(root, name),
          environment: {},
          signal: signal(),
        }),
      ).rejects.toMatchObject({ code: "provider-unavailable" });
  });
  it("checks cancellation before consulting source environment or files", async () => {
    const controller = new AbortController();
    controller.abort();
    const environment = Object.defineProperty({}, "PATH", {
      get() {
        throw Error("must not read PATH");
      },
    });
    await expect(
      resolveActivityCodexRuntime({ environment, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "generation-failed", message: "generation-failed" });
  });
});
