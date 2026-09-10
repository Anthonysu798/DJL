import {
  prepareWindowsSafeProcess,
  type WindowsSafeProcessInput,
} from "@synara/shared/windowsProcess";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type JsonObject = Record<string, unknown>;
export const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected protocol object");
  return value as JsonObject;
};
export const string = (value: unknown): string => {
  if (typeof value !== "string" || !value) throw new Error("Expected nonempty protocol string");
  return value;
};
export function bounded<T>(promise: Promise<T>, milliseconds = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Native runtime request timed out")),
      milliseconds,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function prepareNativeRpcLaunch(
  binary: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: WindowsSafeProcessInput = {},
) {
  const launch = prepareWindowsSafeProcess(binary, args, { ...options, cwd, env });
  return {
    command: launch.command,
    args: launch.args,
    options: { ...launch, cwd, env, stdio: "pipe" as const },
  };
}

/** Small bounded NDJSON transport; provider protocol behavior belongs in the drivers. */
export class NativeRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 0;
  private buffer = "";
  private closed = false;
  onMessage: (method: string, params: JsonObject, id?: string | number) => void = () => {};
  onClose: (error: Error) => void = () => {};

  constructor(binary: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
    const launch = prepareNativeRpcLaunch(binary, args, cwd, env ?? process.env);
    this.child = spawn(launch.command, launch.args, launch.options);
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (data: string) => {
      try {
        this.buffer += data;
        if (this.buffer.length > 16 * 1024 * 1024)
          throw new Error("Native protocol frame exceeds limit");
        let end: number;
        while ((end = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, end);
          this.buffer = this.buffer.slice(end + 1);
          // Official runtimes (iFlow) print startup banners on stdout before speaking JSON.
          if (!line.trimStart().startsWith("{")) continue;
          const message = object(JSON.parse(line));
          if (typeof message.method === "string") {
            const id =
              typeof message.id === "number" || typeof message.id === "string"
                ? message.id
                : undefined;
            this.onMessage(message.method, object(message.params ?? {}), id);
          } else if (typeof message.id === "number") {
            const waiter = this.pending.get(message.id);
            if (!waiter) continue;
            clearTimeout(waiter.timer);
            this.pending.delete(message.id);
            if (message.error)
              waiter.reject(
                new Error(String(object(message.error).message ?? "Native protocol error")),
              );
            else waiter.resolve(message.result);
          } else throw new Error("Invalid native protocol envelope");
        }
      } catch (error) {
        this.close(error instanceof Error ? error : new Error("Invalid native protocol"));
      }
    });
    // Drain diagnostic output without recording possible credentials or user content.
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.close(new Error("Native runtime input closed")));
    this.child.on("error", (error) => this.close(error));
    this.child.on("exit", (code) => this.close(new Error(`Native runtime exited (${code})`)));
  }
  private write(message: unknown) {
    if (this.closed) throw new Error("Native runtime is closed");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request(method: string, params: unknown, timeout = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Native runtime is closed"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native request timed out: ${method}`));
        this.close(new Error(`Native request timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  notify(method: string, params: unknown = {}) {
    this.write({ jsonrpc: "2.0", method, params });
  }
  respond(id: string | number, result: unknown) {
    this.write({ jsonrpc: "2.0", id, result });
  }
  reject(id: string | number) {
    this.write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Unsupported client operation" },
    });
  }
  close(error = new Error("Native runtime stopped")) {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (this.child.exitCode === null) this.child.kill("SIGKILL");
    }, 2000);
    timer.unref();
    this.child.once("close", () => clearTimeout(timer));
    this.onClose(error);
  }
}
