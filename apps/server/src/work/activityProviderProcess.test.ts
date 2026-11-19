import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withActivityProviderProcess } from "./activityProviderProcess";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(script: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "djl-activity-process-"));
  directories.push(cwd);
  return {
    executable: process.execPath,
    args: ["-e", script],
    cwd,
    environment: { HOME: cwd, FIXTURE_VALUE: "selected" },
    signal: options.signal ?? new AbortController().signal,
    timeoutMs: options.timeoutMs ?? 5_000,
  };
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

describe("owned activity provider processes", () => {
  it("uses only the supplied environment and bounded stdin/stdout", async () => {
    const spec = await fixture(
      "process.stdin.on('data', data => process.stdout.write(JSON.stringify({input:String(data), selected:process.env.FIXTURE_VALUE, bridge:process.env.DJL_WORK_TOKEN ?? null})))",
    );
    let pid = 0;
    const result = await withActivityProviderProcess(
      { ...spec, input: "synthetic input" },
      async (child) => {
        pid = child.pid;
        expect(await child.exited).toEqual({ code: 0, signal: null });
        await child.closed;
        return JSON.parse(child.stdout());
      },
    );
    expect(result).toEqual({ input: "synthetic input", selected: "selected", bridge: null });
    expect(alive(pid)).toBe(false);
  });

  it("does not launch an already cancelled operation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withActivityProviderProcess(
        await fixture("throw 1", { signal: controller.signal }),
        async () => {
          throw new Error("must not run");
        },
      ),
    ).rejects.toMatchObject({ code: "generation-failed" });
  });

  it("kills and reaps a TERM-resistant child when actively cancelled", async () => {
    const controller = new AbortController();
    let pid = 0;
    const spec = await fixture(
      "process.on('SIGTERM',()=>{}); process.stdout.write('ready'); setInterval(()=>{},1000)",
      { signal: controller.signal },
    );
    await expect(
      withActivityProviderProcess(
        { ...spec, onStdout: () => controller.abort() },
        async (child) => {
          pid = child.pid;
          await child.exited;
        },
      ),
    ).rejects.toMatchObject({ code: "generation-failed" });
    expect(pid).toBeGreaterThan(0);
    expect(alive(pid)).toBe(false);
  });

  it("enforces a wall-clock deadline even if the consumer never settles", async () => {
    const spec = await fixture("setInterval(()=>{},1000)", { timeoutMs: 50 });
    let pid = 0;
    await expect(
      withActivityProviderProcess(spec, async (child) => {
        pid = child.pid;
        return await new Promise<never>(() => {});
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(alive(pid)).toBe(false);
  });

  it.each(["stdout", "stderr"] as const)(
    "rejects excess %s while the child is alive",
    async (stream) => {
      const spec = await fixture(
        `process.${stream}.write(Buffer.alloc(2*1024*1024,65)); setInterval(()=>{},1000)`,
      );
      let pid = 0;
      await expect(
        withActivityProviderProcess(spec, async (child) => {
          pid = child.pid;
          await child.exited;
        }),
      ).rejects.toMatchObject({ code: "generation-failed", message: "generation-failed" });
      expect(alive(pid)).toBe(false);
    },
  );

  it("cleans up after a parser callback throws without exposing diagnostics", async () => {
    const spec = await fixture("process.stdout.write('secret-output'); setInterval(()=>{},1000)");
    let pid = 0;
    await expect(
      withActivityProviderProcess(
        {
          ...spec,
          onStdout: () => {
            throw new Error("secret parser diagnostic");
          },
        },
        async (child) => {
          pid = child.pid;
          await child.exited;
        },
      ),
    ).rejects.toMatchObject({ code: "generation-failed", message: "generation-failed" });
    expect(alive(pid)).toBe(false);
  });

  it("does not bind callbacks to process configuration or credentials", async () => {
    const spec = await fixture("process.stdout.write('ok')");
    let callbacks = 0;
    await withActivityProviderProcess(
      {
        ...spec,
        onStdout: function (this: unknown) {
          expect(this).toBeUndefined();
          callbacks++;
        },
      },
      async (child) => {
        await child.exited;
      },
    );
    expect(callbacks).toBeGreaterThan(0);
  });

  it("cleans descendants holding inherited pipes after the launcher exits", async () => {
    const script =
      "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:['ignore',1,2],env:{}});process.stdout.write(String(c.pid));c.unref()";
    let descendant = 0;
    await withActivityProviderProcess(await fixture(script), async (child) => {
      expect(await child.exited).toEqual({ code: 0, signal: null });
      descendant = Number(child.stdout());
      expect(descendant).toBeGreaterThan(0);
      expect(alive(descendant)).toBe(true);
    });
    expect(alive(descendant)).toBe(false);
  });

  it.each([
    { denial: "transient", deniedProbes: 1, succeeds: true },
    { denial: "persistent", deniedProbes: Infinity, succeeds: false },
  ])(
    "handles $denial post-TERM probe denial without assuming disappearance",
    async ({ deniedProbes, succeeds }) => {
      const realKill = process.kill.bind(process);
      let pid = 0;
      let exited: Promise<unknown> | undefined;
      let termAt = 0;
      let verifiedGone = false;
      let killSent = false;
      let ready!: () => void;
      const received = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const spec = await fixture("process.stdout.write('ready');setInterval(()=>{},1000)");
      const kill = vi.spyOn(process, "kill");
      try {
        const operation = withActivityProviderProcess(
          { ...spec, onStdout: () => ready() },
          async (child) => {
            pid = child.pid;
            exited = child.exited;
            kill.mockImplementation((target, signal) => {
              if (target === -pid && signal === 0 && termAt && deniedProbes-- > 0) {
                throw Object.assign(new Error("private probe diagnostic"), { code: "EPERM" });
              }
              if (target === -pid && signal === "SIGKILL") killSent = true;
              try {
                const result = realKill(target, signal);
                if (target === -pid && signal === "SIGTERM") termAt = performance.now();
                return result;
              } catch (error) {
                if (
                  target === -pid &&
                  signal === 0 &&
                  (error as NodeJS.ErrnoException).code === "ESRCH"
                ) {
                  verifiedGone = true;
                }
                throw error;
              }
            });
            await received;
            return "consumer result";
          },
        );
        if (succeeds) {
          await expect(operation).resolves.toBe("consumer result");
          expect(verifiedGone).toBe(true);
        } else {
          await expect(operation).rejects.toMatchObject({
            code: "generation-failed",
            message: "generation-failed",
          });
          expect(performance.now() - termAt).toBeGreaterThanOrEqual(1_350);
          expect(performance.now() - termAt).toBeLessThan(2_500);
          expect(killSent).toBe(true);
          expect(verifiedGone).toBe(false);
        }
        kill.mockRestore();
        expect(alive(pid)).toBe(false);
        expect(alive(-pid)).toBe(false);
      } finally {
        kill.mockRestore();
        if (pid) {
          try {
            realKill(-pid, "SIGKILL");
          } catch (error) {
            expect(error).toMatchObject({ code: "ESRCH" });
          }
          await exited;
        }
      }
    },
  );

  it("returns the consumer failure only after cleanup", async () => {
    let pid = 0;
    await expect(
      withActivityProviderProcess(await fixture("setInterval(()=>{},1000)"), async (child) => {
        pid = child.pid;
        throw new Error("private path or output");
      }),
    ).rejects.toMatchObject({ code: "generation-failed", message: "generation-failed" });
    expect(alive(pid)).toBe(false);
  });

  it("does not report success when cancelled during cleanup", async () => {
    const controller = new AbortController();
    let pid = 0;
    const spec = await fixture(
      "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)",
      { signal: controller.signal },
    );
    let ready!: () => void;
    const received = new Promise<void>((resolve) => {
      ready = resolve;
    });
    await expect(
      withActivityProviderProcess({ ...spec, onStdout: () => ready() }, async (child) => {
        pid = child.pid;
        await received;
        setTimeout(() => controller.abort(), 40);
        return "must not succeed";
      }),
    ).rejects.toMatchObject({ code: "generation-failed" });
    expect(alive(pid)).toBe(false);
  });

  it("rejects invalid UTF-8 without returning lossy text", async () => {
    const spec = await fixture("process.stdout.write(Buffer.from([0xc0,0xaf]))");
    await expect(
      withActivityProviderProcess(spec, async (child) => {
        await child.closed;
        return child.stdout();
      }),
    ).rejects.toMatchObject({ code: "generation-failed" });
  });

  it("allows a decoder to inspect a failed exit without leaking child errors", async () => {
    const spec = await fixture("process.stderr.write('private diagnostic');process.exit(7)");
    await expect(
      withActivityProviderProcess(spec, async (child) => {
        const status = await child.exited;
        await child.closed;
        expect(status.code).toBe(7);
        expect(child.stderr()).toBe("private diagnostic");
        throw new Error(child.stderr());
      }),
    ).rejects.toMatchObject({ message: "generation-failed" });
  });

  it("rejects oversized input and invalid deadlines before invoking a consumer", async () => {
    const spec = await fixture("throw 1");
    for (const override of [
      { input: "a".repeat(8 * 1024 * 1024 + 1) },
      { timeoutMs: 180_001 },
      { timeoutMs: 0 },
    ]) {
      await expect(
        withActivityProviderProcess({ ...spec, ...override }, async () => {
          throw new Error("must not run");
        }),
      ).rejects.toMatchObject({ code: "generation-failed" });
    }
  });
});
