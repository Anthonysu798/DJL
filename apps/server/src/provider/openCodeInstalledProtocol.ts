import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { prepareWindowsSafeProcess } from "@synara/shared/windowsProcess";

export class OpenCodeProtocolError extends Error {
  readonly code: "incompatible" | "timeout" | "startup";
  constructor(code: "incompatible" | "timeout" | "startup") {
    super(
      code === "timeout"
        ? "OpenCode compatibility check timed out. Check the CLI setup and try again."
        : code === "startup"
          ? "OpenCode could not start its local server. Check the CLI setup and try again."
          : "This OpenCode installation is incompatible with DJL. Install a supported OpenCode 1.x CLI.",
    );
    this.name = "OpenCodeProtocolError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function validateOpenCodeProtocol(document: unknown, version: unknown): void {
  const doc = record(document);
  if (
    typeof version !== "string" ||
    !/^1\.\d+\.\d+(?:[-+].*)?$/.test(version) ||
    typeof doc.openapi !== "string" ||
    !doc.openapi.startsWith("3.")
  ) {
    throw new OpenCodeProtocolError("incompatible");
  }
  const paths = record(doc.paths);
  for (const [path, requiredFields] of [
    ["/session", ["permission"]],
    ["/session/{sessionID}/message", ["parts", "model"]],
    ["/session/{sessionID}/prompt_async", ["parts", "model"]],
    ["/permission/{requestID}/reply", ["reply"]],
  ] as const) {
    const operation = record(record(paths[path]).post);
    const schema = record(
      record(record(record(operation.requestBody).content)["application/json"]).schema,
    );
    const properties = record(schema.properties);
    if (
      schema.type !== "object" ||
      requiredFields.some((field) => {
        let property = record(properties[field]);
        if (
          typeof property.$ref === "string" &&
          property.$ref.startsWith("#/components/schemas/")
        ) {
          property = record(record(record(doc.components).schemas)[property.$ref.slice(21)]);
        }
        const expected = field === "model" ? "object" : field === "reply" ? "string" : "array";
        return property.type !== expected;
      }) ||
      Object.keys(record(operation.responses)).length === 0
    ) {
      throw new OpenCodeProtocolError("incompatible");
    }
  }
}

export async function assertOpenCodeServerCompatibility(
  url: string,
  password?: string,
): Promise<void> {
  const headers = password
    ? { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
    : undefined;
  try {
    const [health, doc] = await Promise.all(
      ["/global/health", "/doc"].map(async (path) => {
        const response = await fetch(new URL(path, url), {
          headers,
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new OpenCodeProtocolError("incompatible");
        return response.json() as Promise<unknown>;
      }),
    );
    validateOpenCodeProtocol(doc, record(health).version);
  } catch (error) {
    if (error instanceof OpenCodeProtocolError) throw error;
    throw new OpenCodeProtocolError(
      error instanceof Error && /Timeout|Abort/.test(error.name) ? "timeout" : "incompatible",
    );
  }
}

async function executableFingerprint(binary: string, version: string): Promise<string> {
  const candidates = isAbsolute(binary)
    ? [binary]
    : (process.env.PATH ?? "")
        .split(delimiter)
        .flatMap((directory) =>
          (process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""]).map((extension) =>
            join(directory, binary + extension),
          ),
        );
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return `${candidate}:${info.size}:${info.mtimeMs}:${version}`;
    } catch {
      /* Try the next PATH candidate. */
    }
  }
  return `${binary}:${process.env.PATH}:${version}`;
}

async function probeInstalledProtocol(binary: string): Promise<void> {
  const password = randomBytes(24).toString("hex");
  const env = {
    ...process.env,
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_USERNAME: "opencode",
  };
  const launch = prepareWindowsSafeProcess(
    binary,
    ["serve", "--hostname", "127.0.0.1", "--port", "0"],
    { env, platform: process.platform },
  );
  const child = spawn(launch.command, launch.args, {
    ...launch,
    cwd: tmpdir(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new OpenCodeProtocolError("timeout")), 15_000);
      const finish = (error?: OpenCodeProtocolError, url?: string) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(url!);
      };
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8192);
        const match = output.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) finish(undefined, match[1]);
      };
      child.stdout?.on("data", read);
      child.stderr?.on("data", read);
      child.once("error", () => finish(new OpenCodeProtocolError("startup")));
      child.once("exit", () => finish(new OpenCodeProtocolError("startup")));
    });
    await assertOpenCodeServerCompatibility(url, password);
  } finally {
    if (child.pid && child.exitCode === null) {
      if (process.platform === "win32") {
        await new Promise<void>((resolve) =>
          execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () =>
            resolve(),
          ),
        );
      } else {
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 1_000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    }
  }
}

export interface OpenCodeProtocolInspection {
  compatible: boolean;
  compatibilityMessage?: string;
}
const cache = new Map<string, { expires: number; result: Promise<OpenCodeProtocolInspection> }>();
export async function inspectInstalledOpenCodeProtocol(
  binary: string,
  version: string,
): Promise<OpenCodeProtocolInspection> {
  const key = await executableFingerprint(binary, version);
  const previous = cache.get(key);
  if (previous && previous.expires > Date.now()) return previous.result;
  for (const [key, value] of cache) if (value.expires <= Date.now()) cache.delete(key);
  const result = probeInstalledProtocol(binary).then(
    () => ({ compatible: true }),
    (error: unknown) => ({
      compatible: false,
      compatibilityMessage:
        error instanceof OpenCodeProtocolError
          ? error.message
          : new OpenCodeProtocolError("startup").message,
    }),
  );
  cache.set(key, { expires: Date.now() + 60_000, result });
  return result;
}
