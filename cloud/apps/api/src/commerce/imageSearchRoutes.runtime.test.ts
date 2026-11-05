import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

it("cancels pre-response image requests and drains cleanup before the native Bun server closes", async () => {
  const moduleUrl = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
  // Real transport/router/middleware; identity and search are deterministic test doubles.
  // No database, credentials, product photos or inference service are used.
  const script = `
import net from "node:net";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { Effect, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
const { makeCommerceImageSearchRoutes } = await import(${JSON.stringify(moduleUrl("./imageSearchRoutes.ts"))});
const { makeMiddleware } = await import(${JSON.stringify(moduleUrl("../http/middleware.ts"))});
const { loadApiEnv } = await import(${JSON.stringify(moduleUrl("../config/env.ts"))});
const mark = (stage, port = 0) => process.stdout.write("DJL_IMAGE_RUNTIME " + stage + " " + port + "\\n");
const scope = Scope.makeUnsafe();
const result = { products: [], matchType: "similar", modelId: "synthetic", indexVersion: "synthetic", message: "Synthetic fixture" };
let count = 0;
let deadline;
try {
  const address = await Effect.runPromise(Scope.provide(Effect.gen(function* () {
    const server = yield* BunHttpServer.make({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, development: false });
    const routes = makeCommerceImageSearchRoutes({
      principals: { resolve: async () => ({ userId: "synthetic", emailVerified: true }) },
      imageSearch: { search: async (_principal, body, { signal }) => {
        const call = ++count;
        if (body.query === "retry") return result;
        mark("ENTERED_" + call);
        await new Promise(resolve => {
          const abort = () => { clearTimeout(timer); mark("ABORTED_" + call); resolve(); };
          const timer = setTimeout(() => { signal.removeEventListener("abort", abort); mark("DEADLINE"); resolve(); }, 2000);
          if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
        });
        await new Promise(resolve => setTimeout(resolve, 50));
        mark("CLEANED_" + call);
        return result;
      } },
    });
    const app = yield* HttpRouter.toHttpEffect(routes);
    yield* server.serve(makeMiddleware(loadApiEnv({ DJL_ENV: "test" }), "test")(app));
    return server.address;
  }), scope));
  if (address._tag !== "TcpAddress") throw new Error("Expected loopback TCP");
  mark("READY", address.port);
  await new Promise((resolve, reject) => {
    deadline = setTimeout(() => reject(new Error("Fixture control deadline")), 10000);
    process.stdin.once("data", resolve);
  });
  clearTimeout(deadline);
  process.stdin.destroy();
  mark("CLOSE_STARTED");
  await Effect.runPromise(Scope.close(scope, { _tag: "Success", value: undefined }));
  mark("CLOSED");
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(address.port, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
  });
  mark("REBOUND");
} catch {
  mark("FAILED");
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  process.stdin.destroy();
  await Effect.runPromise(Scope.close(scope, { _tag: "Success", value: undefined }));
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
    "NODE_OPTIONS",
    "LANG",
    "LC_ALL",
  ]) {
    if (process.env[key] !== undefined) childEnv[key] = process.env[key];
  }
  Object.assign(childEnv, {
    NODE_ENV: "test",
    DJL_ENV: "test",
    DJL_MOCK_EXTERNALS: "true",
    DO_NOT_TRACK: "1",
  });
  const child = spawn("bun", ["--no-env-file", "--no-install", "--eval", script], {
    env: childEnv,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stages: string[] = [];
  let port = 0;
  let output = "";
  let unexpectedError = false;
  child.stdout.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-4096);
    let newline: number;
    while ((newline = output.indexOf("\n")) !== -1) {
      const match = /^DJL_IMAGE_RUNTIME ([A-Z_0-9]+) (\d+)$/.exec(output.slice(0, newline).trim());
      output = output.slice(newline + 1);
      if (!match) continue;
      stages.push(match[1]!);
      if (match[1] === "READY") port = Number(match[2]);
    }
  });
  // Classify only; never forward arbitrary library logs or request/response bodies.
  child.stderr.on("data", (chunk: Buffer) => {
    if (/"msg":"(?:unhandled|commerce_image_cleanup_timeout)"/.test(chunk.toString()))
      unexpectedError = true;
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", () => reject(new Error("Native image fixture could not start")));
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  const requests: http.ClientRequest[] = [];
  const request = (query: string) => {
    let responded = false;
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/v1/commerce/image-search",
      method: "POST",
      agent: false,
      headers: { "content-type": "application/json", connection: "close" },
    });
    requests.push(req);
    const done = new Promise<number | null>((resolve) => {
      req.once("error", () => resolve(null));
      req.once("response", (response) => {
        responded = true;
        response.resume();
        response.once("error", () => resolve(null));
        response.once("end", () => resolve(response.statusCode ?? null));
      });
    });
    req.end(JSON.stringify({ query }));
    return { req, done, hasResponded: () => responded };
  };
  try {
    await expect.poll(() => port, { timeout: 5000 }).toBeGreaterThan(0);
    const cancelled = request("cancel");
    await expect.poll(() => stages, { timeout: 3000 }).toContain("ENTERED_1");
    expect(cancelled.hasResponded()).toBe(false);
    cancelled.req.destroy();
    await expect(cancelled.done).resolves.toBeNull();
    await expect.poll(() => stages, { timeout: 3000 }).toContain("CLEANED_1");
    expect(stages).toContain("ABORTED_1");
    await expect(request("retry").done).resolves.toBe(200);
    const pending = request("shutdown");
    await expect.poll(() => stages, { timeout: 3000 }).toContain("ENTERED_3");
    expect(pending.hasResponded()).toBe(false);
    const closingAt = Date.now();
    child.stdin.end("CLOSE\n");
    await expect.poll(() => stages, { timeout: 3000 }).toContain("REBOUND");
    expect(Date.now() - closingAt).toBeLessThan(3000);
    await expect(closed).resolves.toEqual({ code: 0, signal: null });
    expect(stages).toContain("ABORTED_3");
    expect(stages).toContain("CLEANED_3");
    expect(stages.indexOf("CLEANED_3")).toBeLessThan(stages.indexOf("CLOSED"));
    expect(stages).not.toContain("DEADLINE");
    expect(stages).not.toContain("FAILED");
    expect(unexpectedError).toBe(false);
    await pending.done;
  } finally {
    for (const request of requests) request.destroy();
    if (!child.stdin.destroyed) child.stdin.end("CLOSE\n");
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      // Only this held fixture child; a failed assertion never becomes a passing check.
      child.kill("SIGTERM");
    }
    await closed.catch(() => undefined);
  }
});
