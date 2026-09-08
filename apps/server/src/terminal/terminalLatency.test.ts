import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { TerminalManagerRuntime } from "./Layers/Manager";
import type { PtyAdapterShape } from "./Services/PTY";

const measure = async (
  listen: (cb: (data: string) => void) => () => void,
  write: () => void | Promise<void>,
  ready: Promise<void>,
) => {
  await ready;
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error("PTY echo timed out"));
      }, 3000);
      const start = performance.now();
      const stop = listen((data) => {
        if (!data.includes("x")) return;
        samples.push(performance.now() - start);
        clearTimeout(timer);
        stop();
        resolve();
      });
      void write();
    });
  }
  samples.sort((a, b) => a - b);
  return { medianMs: +samples[10]!.toFixed(2), p95Ms: +samples[18]!.toFixed(2) };
};
const waitReady = (listen: (cb: (data: string) => void) => () => void) =>
  new Promise<void>((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => {
      stop();
      reject(new Error("PTY startup timed out"));
    }, 5000);
    const stop = listen((data) => {
      text += data;
      if (text.includes("READY")) {
        clearTimeout(timer);
        stop();
        resolve();
      }
    });
  });

// Real PTY echo comparison, without shell prompt plugins or provider/network work.
it.skipIf(process.platform === "win32")(
  "measures direct PTY versus managed key echo",
  async ({ annotate }) => {
    const pty = createRequire(import.meta.url)("node-pty") as typeof import("node-pty");
    const args = ["-c", "stty raw -echo; printf READY; cat"];
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-echo-"));
    const adapter: PtyAdapterShape = {
      spawn: (input) =>
        Effect.sync(() => {
          const child = pty.spawn(input.shell, [...(input.args ?? [])], {
            cwd: input.cwd,
            cols: input.cols,
            rows: input.rows,
            env: input.env,
          });
          return {
            pid: child.pid,
            write: (data: string) => child.write(data),
            resize: (cols: number, rows: number) => child.resize(cols, rows),
            kill: (signal?: string) => child.kill(signal),
            pause: () => child.pause(),
            resume: () => child.resume(),
            onData: (callback) => {
              const d = child.onData(callback);
              return () => d.dispose();
            },
            onExit: (callback) => {
              const d = child.onExit((e) =>
                callback({ exitCode: e.exitCode, signal: e.signal ?? null }),
              );
              return () => d.dispose();
            },
          };
        }),
    };
    const manager = new TerminalManagerRuntime({
      logsDir,
      ptyAdapter: adapter,
      subprocessChecker: async () => false,
    });
    const direct = pty.spawn("/bin/sh", args, {
      cwd: logsDir,
      cols: 80,
      rows: 24,
      env: process.env as Record<string, string>,
    });
    const directListen = (cb: (data: string) => void) => {
      const d = direct.onData(cb);
      return () => d.dispose();
    };
    const managedListen = (cb: (data: string) => void) => {
      const listener = (e: { type: string; data?: string }) => {
        if (e.type === "output") cb(e.data!);
      };
      manager.on("event", listener);
      return () => {
        manager.off("event", listener);
      };
    };
    const directReady = waitReady(directListen),
      managedReady = waitReady(managedListen);
    try {
      await manager.open(
        { threadId: "echo", terminalId: "t", cwd: logsDir },
        { executable: "/bin/sh", args },
      );
      const baseline = await measure(directListen, () => direct.write("x"), directReady);
      const managed = await measure(
        managedListen,
        () => manager.write({ threadId: "echo", terminalId: "t", data: "x" }),
        managedReady,
      );
      await annotate(JSON.stringify({ baseline, managed }));
      expect(managed.medianMs).toBeLessThan(100);
    } finally {
      direct.kill();
      manager.dispose();
      fs.rmSync(logsDir, { recursive: true, force: true });
    }
  },
);
