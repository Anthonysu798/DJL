import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

it.each(["finite", "persistent"] as const)(
  "closes the real Bun API after an aborted catalog read with a %s database lock",
  async (mode) => {
    expect(process.env.NODE_ENV).toBe("test");
    expect([undefined, "local", "test"].includes(process.env.DJL_ENV)).toBe(true);
    for (const [key, protocols] of [
      ["DATABASE_URL", ["postgres:", "postgresql:"]],
      ["REDIS_URL", ["redis:"]],
    ] as const) {
      let valid = false;
      try {
        const url = new URL(process.env[key]!);
        valid =
          protocols.some((protocol) => url.protocol === protocol) &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      } catch {
        // Fail before spawning without exposing a malformed connection URL.
      }
      expect(valid).toBe(true);
    }
    const modulePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
    const script = `
const { startApi } = await import(${JSON.stringify(modulePath("./server.ts"))});
const { loadApiEnv } = await import(${JSON.stringify(modulePath("./config/env.ts"))});
const { isolatedCommerceTestDatabase } = await import(${JSON.stringify(modulePath("./testing/isolatedDb.ts"))});
const mode = ${JSON.stringify(mode)};
const mark = (stage, value = 0) => process.stdout.write("DJL_CATALOG_CLOSE " + stage + " " + value + "\\n");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const connection = await isolatedCommerceTestDatabase();
const database = new URL(process.env.DATABASE_URL);
database.pathname = "/" + connection.sql.options.database;
let api, locked, release = () => {}, lockTimer, finiteTimer, failed = false;
try {
  const env = loadApiEnv({ ...process.env, DATABASE_URL: database.href });
  api = await startApi({ env, host: "127.0.0.1", port: 0 });
  let acquired;
  const ready = new Promise(resolve => { acquired = resolve; });
  const gate = new Promise(resolve => { release = () => { clearTimeout(lockTimer); resolve(); }; });
  locked = connection.sql.begin(async tx => {
    await tx.unsafe("lock table public.commerce_products in access exclusive mode");
    lockTimer = setTimeout(() => { mark("LOCK_DEADLINE"); release(); }, 12000);
    acquired();
    await gate;
    mark("UNLOCKED");
  });
  await ready;
  let closeRequested = false, observed = false;
  process.stdin.once("data", () => { closeRequested = true; });
  mark("READY", api.address.port);
  const waiting = async () => {
    const [row] = await connection.sql.unsafe("select exists(select 1 from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace join pg_stat_activity a on a.pid=l.pid where a.datname=current_database() and c.relname='commerce_products' and n.nspname='public' and not l.granted and a.wait_event_type='Lock') as present");
    return row.present === true;
  };
  const deadline = Date.now() + 14000;
  while (!closeRequested && Date.now() < deadline) {
    if (!observed && await waiting()) { observed = true; mark("QUERY_BLOCKED"); }
    await delay(10);
  }
  if (!closeRequested || !observed || !await waiting()) throw new Error("Blocked request/control absent");
  process.stdin.destroy();
  if (mode === "finite") finiteTimer = setTimeout(release, 250);
  mark("CLOSE_STARTED");
  const at = Date.now();
  await api.close();
  api = undefined;
  mark("API_CLOSED", Date.now() - at);
  release();
  await locked;
  const [state] = await connection.sql.unsafe("select (select count(*)::int from commerce_orders) orders,(select count(*)::int from commerce_ledger) ledger,(select count(*)::int from credit_ledger) ai");
  if (state.orders !== 0 || state.ledger !== 0 || state.ai !== 0) throw new Error("Read created business state");
} catch {
  failed = true;
  mark("FAILED");
} finally {
  clearTimeout(finiteTimer);
  release();
  await locked;
  await api?.close();
  await connection.close();
  process.stdin.destroy();
  mark("DATABASE_DROPPED");
}
if (failed) process.exitCode = 1;
else mark("DONE");
`;
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "LD_LIBRARY_PATH",
      "SystemRoot",
      "HOME",
      "USERPROFILE",
      "TMPDIR",
      "TMP",
      "TEMP",
      "NODE_OPTIONS",
      "LANG",
      "LC_ALL",
      "DATABASE_URL",
      "REDIS_URL",
      "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
    ]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    Object.assign(env, {
      NODE_ENV: "test",
      DJL_ENV: "test",
      DJL_MOCK_EXTERNALS: "true",
      DO_NOT_TRACK: "1",
      DJL_COMMERCE_MODE: "test",
      DJL_COMMERCE_PAYMENT_PROVIDER: "simulation",
    });
    const child = spawn("bun", ["--no-env-file", "--no-install", "--eval", script], {
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stages: string[] = [];
    let port = 0,
      closeMs = 0,
      stdout = "",
      stderr = "",
      unexpectedError = false;
    child.stdin.on("error", () => {
      unexpectedError = true;
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-4096);
      let newline: number;
      while ((newline = stdout.indexOf("\n")) !== -1) {
        const match = /^DJL_CATALOG_CLOSE ([A-Z_]+) (\d+)$/.exec(stdout.slice(0, newline).trim());
        stdout = stdout.slice(newline + 1);
        if (!match) continue;
        stages.push(match[1]!);
        if (match[1] === "READY") port = Number(match[2]);
        if (match[1] === "API_CLOSED") closeMs = Number(match[2]);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      // Classify, do not forward arbitrary logs, SQL parameters, or credentials.
      stderr = (stderr + chunk.toString()).slice(-4096);
      if (/"msg":"unhandled"/.test(stderr)) unexpectedError = true;
    });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", () => reject(new Error("Catalog shutdown child failed to start")));
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );
    let request: http.ClientRequest | undefined;
    try {
      await expect.poll(() => port, { timeout: 10000 }).toBeGreaterThan(0);
      let responded = false;
      request = http.request({
        host: "127.0.0.1",
        port,
        method: "GET",
        path: "/v1/commerce/catalog",
        agent: false,
        headers: { connection: "close" },
      });
      const disconnected = new Promise<void>((resolve) => {
        request!.once("error", () => resolve());
        request!.once("response", (response) => {
          responded = true;
          response.resume();
          response.once("end", resolve);
          response.once("error", () => resolve());
        });
      });
      request.end();
      await expect.poll(() => stages, { timeout: 5000 }).toContain("QUERY_BLOCKED");
      expect(responded).toBe(false);
      request.destroy();
      await disconnected;
      child.stdin.end("CLOSE\n");
      await expect.poll(() => stages, { timeout: 10000 }).toContain("DONE");
      await expect(closed).resolves.toEqual({ code: 0, signal: null });
      for (const stage of ["UNLOCKED", "API_CLOSED", "DATABASE_DROPPED"])
        expect(stages).toContain(stage);
      expect(stages).not.toContain("LOCK_DEADLINE");
      expect(stages).not.toContain("FAILED");
      expect(closeMs).toBeLessThan(8000);
      if (mode === "persistent") {
        expect(closeMs).toBeGreaterThanOrEqual(4500);
        expect(stages.indexOf("API_CLOSED")).toBeLessThan(stages.indexOf("UNLOCKED"));
      } else expect(stages.indexOf("UNLOCKED")).toBeLessThan(stages.indexOf("API_CLOSED"));
      expect(unexpectedError).toBe(false);
      await new Promise<void>((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(port, "127.0.0.1", () =>
          probe.close((error) => (error ? reject(error) : resolve())),
        );
      });
    } finally {
      request?.destroy();
      if (!child.stdin.destroyed) child.stdin.end("CLOSE\n");
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        // Only the held fixture child; termination never turns a failed assertion into a pass.
        child.kill("SIGTERM");
      }
      await closed.catch(() => undefined);
    }
  },
  30000,
);
