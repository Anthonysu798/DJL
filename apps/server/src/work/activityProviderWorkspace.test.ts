import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readActivityProviderTextFile,
  withActivityProviderWorkspace,
} from "./activityProviderWorkspace";
import { withActivityProviderProcess } from "./activityProviderProcess";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const signal = () => new AbortController().signal;
async function source() {
  const root = await mkdtemp(path.join(os.tmpdir(), "djl-activity-source-"));
  roots.push(root);
  return path.join(root, "source");
}
describe("private activity provider files", () => {
  it("creates private empty per-invocation directories and removes them after success", async () => {
    let root = "";
    const result = await withActivityProviderWorkspace(signal(), async (workspace) => {
      root = workspace.root;
      for (const directory of Object.values(workspace))
        expect((await stat(directory)).mode & 0o777).toBe(0o700);
      await writeFile(path.join(workspace.codexHome, "auth.json"), "synthetic", {
        mode: 0o600,
        flag: "wx",
      });
      expect((await stat(path.join(workspace.codexHome, "auth.json"))).mode & 0o777).toBe(0o600);
      return "structured result";
    });
    expect(result).toBe("structured result");
    await expect(access(root, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("cleans private files on consumer failure without returning a raw error", async () => {
    let root = "";
    await expect(
      withActivityProviderWorkspace(signal(), async (workspace) => {
        root = workspace.root;
        throw new Error("private-source-path");
      }),
    ).rejects.toMatchObject({ code: "generation-failed", message: "generation-failed" });
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("checks cancellation before entering the scope and after its consumer", async () => {
    const before = new AbortController();
    before.abort();
    await expect(
      withActivityProviderWorkspace(before.signal, async () => {
        throw new Error("must not run");
      }),
    ).rejects.toMatchObject({ code: "generation-failed" });
    const after = new AbortController();
    let root = "";
    await expect(
      withActivityProviderWorkspace(after.signal, async (workspace) => {
        root = workspace.root;
        after.abort();
        return "late result";
      }),
    ).rejects.toMatchObject({ code: "generation-failed" });
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("bounds a regular-file read and preserves a deliberate source symlink", async () => {
    const file = await source(),
      link = `${file}-link`;
    await writeFile(file, "synthetic source", { mode: 0o600 });
    await symlink(file, link);
    expect(await readActivityProviderTextFile(link, 16, signal())).toBe("synthetic source");
    expect(await readFile(file, "utf8")).toBe("synthetic source");
  });
  it("returns absence only for a missing source", async () => {
    expect(await readActivityProviderTextFile(await source(), 64, signal())).toBeUndefined();
  });
  it("rejects a too-large source before parsing or returning truncated material", async () => {
    const file = await source();
    await writeFile(file, "x".repeat(65));
    await expect(readActivityProviderTextFile(file, 64, signal())).rejects.toMatchObject({
      code: "provider-unavailable",
      message: "provider-unavailable",
    });
  });
  it("rejects non-regular sources and invalid UTF-8", async () => {
    const file = await source();
    await mkdir(file);
    await expect(readActivityProviderTextFile(file, 64, signal())).rejects.toMatchObject({
      code: "provider-unavailable",
    });
    await rm(file, { recursive: true });
    await writeFile(file, Buffer.from([0xc0, 0xaf]));
    await expect(readActivityProviderTextFile(file, 64, signal())).rejects.toMatchObject({
      code: "provider-unavailable",
    });
  });
  it.skipIf(process.platform === "win32")(
    "rejects an unopened FIFO without waiting for a writer",
    async () => {
      const fifo = await source();
      execFileSync("/usr/bin/mkfifo", [fifo], { timeout: 1_000 });
      await expect(readActivityProviderTextFile(fifo, 64, signal())).rejects.toMatchObject({
        code: "provider-unavailable",
      });
    },
  );
  it.skipIf(process.platform === "win32")(
    "keeps the workspace until the nested owned process has exited",
    async () => {
      let root = "",
        pid = 0;
      const lifetime = signal();
      await withActivityProviderWorkspace(lifetime, async (workspace) => {
        root = workspace.root;
        let ready!: () => void;
        const received = new Promise<void>((resolve) => {
          ready = resolve;
        });
        await withActivityProviderProcess(
          {
            executable: process.execPath,
            args: ["-e", "process.stdout.write('ready');setInterval(()=>{},1000)"],
            cwd: workspace.work,
            environment: { HOME: workspace.home },
            signal: lifetime,
            timeoutMs: 5_000,
            onStdout: () => ready(),
          },
          async (child) => {
            pid = child.pid;
            await received;
          },
        );
        await expect(access(workspace.root)).resolves.toBeUndefined();
        expect(() => process.kill(pid, 0)).toThrow();
      });
      await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it("rejects cancelled, relative or invalidly bounded reads", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readActivityProviderTextFile(await source(), 64, controller.signal),
    ).rejects.toMatchObject({ code: "generation-failed" });
    for (const [file, limit] of [
      ["relative-source", 64],
      [await source(), 0],
      [await source(), 8 * 1024 * 1024 + 1],
    ] as const)
      await expect(readActivityProviderTextFile(file, limit, signal())).rejects.toMatchObject({
        code: "provider-unavailable",
      });
  });
});
