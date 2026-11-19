import { spawn } from "node:child_process";
import path from "node:path";
import { ComputerActivityGenerationError } from "./computerActivitySummarization";

const failure = () => new ComputerActivityGenerationError("generation-failed");
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
interface Exit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}
interface ActivityProviderProcess {
  readonly pid: number;
  // A launcher may exit while descendants still hold its pipes.
  readonly exited: Promise<Exit>;
  readonly closed: Promise<void>;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

// For the trusted, verified provider recipes only: no shell, inherited environment,
// shared server, or daemonizing runtime. The caller owns the private cwd/files.
export async function withActivityProviderProcess<T>(
  options: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly environment: Readonly<Record<string, string>>;
    readonly input?: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
    readonly onStdout?: (chunk: Buffer) => void;
  },
  use: (child: ActivityProviderProcess) => Promise<T>,
): Promise<T> {
  if (
    process.platform === "win32" ||
    !path.isAbsolute(options.executable) ||
    !path.isAbsolute(options.cwd) ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 180_000 ||
    Buffer.byteLength(options.input ?? "") > 8 * 1024 * 1024 ||
    options.signal.aborted
  )
    throw failure();

  let problem: ComputerActivityGenerationError | undefined;
  let rejectFailure!: (error: ComputerActivityGenerationError) => void;
  const failed = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  const fail = (error = failure()) => {
    if (problem) return;
    problem = error;
    rejectFailure(error);
  };
  // Also handles failure before the consumer is attached to the race.
  void failed.catch(() => undefined);
  const abort = () => fail();
  options.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => fail(new ComputerActivityGenerationError("timeout")),
    options.timeoutMs,
  );

  let child: ReturnType<typeof spawn> | undefined;
  let rootExited = false;
  let result: T | undefined;
  try {
    if (options.signal.aborted) throw failure();
    child = spawn(options.executable, [...options.args], {
      cwd: options.cwd,
      env: { ...options.environment },
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    const stdout = Buffer.alloc(1024 * 1024),
      stderr = Buffer.alloc(64 * 1024);
    let stdoutBytes = 0,
      stderrBytes = 0;
    const onStdout = options.onStdout;
    child.stdout!.on("data", (chunk: Buffer) => {
      if (problem) return;
      if (stdoutBytes + chunk.length > stdout.length) {
        fail();
        return;
      }
      chunk.copy(stdout, stdoutBytes);
      stdoutBytes += chunk.length;
      try {
        onStdout?.(chunk);
      } catch {
        fail();
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      if (problem) return;
      if (stderrBytes + chunk.length > stderr.length) {
        fail();
        return;
      }
      chunk.copy(stderr, stderrBytes);
      stderrBytes += chunk.length;
    });
    child.on("error", () => fail());
    child.stdin!.on("error", () => fail());
    child.stdout!.on("error", () => fail());
    child.stderr!.on("error", () => fail());
    const exited = new Promise<Exit>((resolve) => {
      child!.once("exit", (code, signal) => {
        rootExited = true;
        resolve({ code, signal });
      });
    });
    const closed = new Promise<void>((resolve) => {
      child!.once("close", () => resolve());
    });
    child.stdin!.end(options.input ?? "");
    if (!child.pid) throw failure();
    const handle = {
      pid: child.pid,
      exited,
      closed,
      stdout: () =>
        new TextDecoder("utf-8", { fatal: true }).decode(stdout.subarray(0, stdoutBytes)),
      stderr: () =>
        new TextDecoder("utf-8", { fatal: true }).decode(stderr.subarray(0, stderrBytes)),
    };
    // Invoke without binding the private configuration as a callback receiver.
    result = await Promise.race([Promise.resolve().then(() => use(handle)), failed]);
    if (problem) throw problem;
  } catch (error) {
    problem = error instanceof ComputerActivityGenerationError ? error : failure();
  } finally {
    const pid = child?.pid;
    if (pid) {
      const groupExists = () => {
        try {
          process.kill(-pid, 0);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
          // A denied probe cannot prove disappearance; keep the bounded wait active.
          if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
          throw failure();
        }
      };
      const signalGroup = (signal: NodeJS.Signals) => {
        try {
          process.kill(-pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw failure();
        }
      };
      const waitForExit = async (ms: number) => {
        const end = performance.now() + ms;
        do {
          if (rootExited && !groupExists()) return true;
          await pause(20);
        } while (performance.now() < end);
        return rootExited && !groupExists();
      };
      try {
        // Always retire the owned group, including after an exit-0 launcher.
        if (groupExists()) signalGroup("SIGTERM");
        if (!(await waitForExit(400))) {
          signalGroup("SIGKILL");
          if (!(await waitForExit(1_000))) problem = failure();
        }
      } catch {
        problem = failure();
      }
    }
    child?.stdin?.destroy();
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
  }
  if (problem) throw problem;
  return result as T;
}
