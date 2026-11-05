import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

it("naturally closes the Bun API after consuming an asynchronous unauthorized JSON response", async () => {
  // Fail before a child/server/database connection unless Vitest has explicit loopback fixtures.
  expect(process.env.NODE_ENV).toBe("test");
  expect([undefined, "local", "test"].includes(process.env.DJL_ENV)).toBe(true);
  expect(Boolean(process.env.DATABASE_URL)).toBe(true);
  expect(Boolean(process.env.REDIS_URL)).toBe(true);
  for (const [key, scheme] of [
    ["DATABASE_URL", "postgres:"],
    ["REDIS_URL", "redis:"],
  ] as const) {
    let valid = false;
    try {
      const url = new URL(process.env[key]!);
      valid =
        (url.protocol === scheme || (key === "DATABASE_URL" && url.protocol === "postgresql:")) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    } catch {
      // Do not expose a malformed URL or its credentials in assertion output.
    }
    expect(valid).toBe(true);
  }

  const server = fileURLToPath(new URL("./server.ts", import.meta.url));
  const script = `
import assert from "node:assert/strict";
import net from "node:net";
const mark = (stage, port) => process.stdout.write("DJL_SHUTDOWN " + stage + " " + port + "\\n");
try {
  const { startApi } = await import(${JSON.stringify(server)});
  const api = await startApi({ host: "127.0.0.1", port: 0 });
  const port = api.address.port;
  mark("READY", port);
  try {
    const response = await fetch("http://127.0.0.1:" + port + "/admin/v1/commerce/suppliers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ synthetic: true }),
    });
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.error?.code, "unauthorized");
    mark("RESPONSE_JSON", port);
  } finally {
    mark("CLOSE_STARTED", port);
    await api.close();
    mark("CLOSE_FINISHED", port);
  }
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close((error) => error ? reject(error) : resolve()));
  });
  mark("REBOUND", port);
  mark("DONE", port);
} catch {
  process.stdout.write("DJL_SHUTDOWN FAILED\\n");
  process.exitCode = 1;
}`;

  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "LD_LIBRARY_PATH",
    "SystemRoot",
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "NODE_OPTIONS",
    "BUN_OPTIONS",
    "DATABASE_URL",
    "REDIS_URL",
    "BETTER_AUTH_SECRET",
    "IP_HASH_SALT",
    "API_PUBLIC_URL",
    "WEB_PUBLIC_URL",
    "ADMIN_PUBLIC_URL",
    "PG_BOSS_CREATE_SCHEMA",
    "PG_BOSS_PRODUCER_ONLY",
  ]) {
    if (process.env[key] !== undefined) childEnv[key] = process.env[key];
  }
  Object.assign(childEnv, {
    DJL_ENV: "test",
    DJL_MOCK_EXTERNALS: "true",
    NODE_ENV: "test",
    DO_NOT_TRACK: "1",
  });
  const child = spawn("bun", ["--no-env-file", "--no-install", "--eval", script], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stages: string[] = [];
  const ports: number[] = [];
  let buffer = "";
  child.stdout!.on("data", (chunk: Buffer) => {
    buffer = (buffer + chunk.toString()).slice(-4096);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      const match =
        /^DJL_SHUTDOWN (READY|RESPONSE_JSON|CLOSE_STARTED|CLOSE_FINISHED|REBOUND|DONE|FAILED)(?: (\d+))?$/.exec(
          line,
        );
      if (match) {
        stages.push(match[1]!);
        if (match[2]) ports.push(Number(match[2]));
      }
    }
  });
  // Do not forward arbitrary library logs, response bodies, tokens or environment to test output.
  child.stderr!.resume();
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", () => reject(new Error("Shutdown child failed to start")));
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const exit = await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Shutdown child timed out after ${stages.join(">") || "SPAWN"}`)),
          15_000,
        );
      }),
    ]);
    expect(exit).toEqual({ code: 0, signal: null });
    expect(stages).toEqual([
      "READY",
      "RESPONSE_JSON",
      "CLOSE_STARTED",
      "CLOSE_FINISHED",
      "REBOUND",
      "DONE",
    ]);
    expect(ports).toHaveLength(6);
    expect(ports[0]).toBeGreaterThan(0);
    expect(ports.every((port) => port === ports[0])).toBe(true);
  } finally {
    clearTimeout(timer);
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      // Held child handle only. A timeout remains a failed test even if TERM then exits cleanly.
      child.kill("SIGTERM");
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed.catch(() => undefined),
          new Promise<void>((resolve) => {
            cleanupTimer = setTimeout(resolve, 2000);
          }),
        ]);
      } finally {
        clearTimeout(cleanupTimer);
      }
    }
  }
});
