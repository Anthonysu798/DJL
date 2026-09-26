/**
 * Red team: throttles and lockouts must hold across instances and restarts,
 * so an attacker gains nothing by spreading requests over machines or by
 * waiting for a deploy.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADMIN_LOCKOUT, AdminAuth } from "../admin/AdminAuth.ts";
import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { randomIp, TestClient } from "../testing/client.ts";
import { testDatabase } from "../testing/db.ts";
import { createRedisLockouts } from "./throttle.ts";

/** A second API in its own process, so no in-memory state can be shared with this one. */
async function startApiProcess(): Promise<{ base: string; child: ChildProcess }> {
  const server = fileURLToPath(new URL("../server.ts", import.meta.url));
  const script = `const { startApi } = await import(${JSON.stringify(server)});
const api = await startApi({ port: 0, host: "127.0.0.1" });
console.log("PORT " + api.address.port);`;
  const child = spawn("bun", ["--eval", script], {
    env: { ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise<number>((resolve, reject) => {
    child.once("exit", (code) => reject(new Error(`api process exited with ${code}`)));
    child.stdout!.on("data", (chunk: Buffer) => {
      const match = /PORT (\d+)/.exec(chunk.toString());
      if (match) resolve(Number(match[1]));
    });
  });
  return { base: `http://127.0.0.1:${port}`, child };
}

describe("Better Auth throttles", () => {
  let first: ApiRuntime;
  let second: { base: string; child: ChildProcess };

  beforeAll(async () => {
    const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
    [first, second] = await Promise.all([
      startApi({ env, port: 0, host: "127.0.0.1" }),
      startApiProcess(),
    ]);
  });
  afterAll(async () => {
    second.child.kill();
    await first.close();
  });

  it("counts sign-in attempts from one IP across two API processes", async () => {
    const ip = randomIp();
    const clients = [TestClient.for(first, ip), new TestClient(second.base, ip)];
    const statuses: number[] = [];
    // The rule allows 10 sign-ins per minute per IP; alternate between instances.
    for (let i = 0; i < 12; i += 1) {
      const res = await clients[i % 2]!.call("/v1/auth/sign-in/email", {
        method: "POST",
        json: { email: `nobody-${i}@test.invalid`, password: "wrong-password-123" },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // A different IP is unaffected.
    const other = await new TestClient(second.base).call("/v1/auth/sign-in/email", {
      method: "POST",
      json: { email: "nobody@test.invalid", password: "wrong-password-123" },
    });
    expect(other.status).not.toBe(429);
  });
});

describe("admin lockouts", () => {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63799", {
    maxRetriesPerRequest: 2,
  });
  const { db, close } = testDatabase();
  afterAll(async () => {
    redis.disconnect();
    await close();
  });

  const instance = () =>
    new AdminAuth(db, {
      appSecret: "test-secret",
      ipSalt: "test-salt",
      lockouts: createRedisLockouts(redis, { prefix: "admin:lockout", ...ADMIN_LOCKOUT }),
      mfaRequired: false,
    });

  it("keeps an admin locked out after the process restarts", async () => {
    const email = `lockout-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const password = "a-long-admin-password-1";
    await instance().create({ email, name: "Lockout", role: "admin", password });
    const ip = randomIp();
    const before = instance();
    for (let i = 0; i < ADMIN_LOCKOUT.maxFailures; i += 1) {
      await expect(
        before.login({ email, password: "wrong-password-xyz", ip, userAgent: null }),
      ).rejects.toMatchObject({ code: "bad_credentials" });
    }
    // A fresh instance (a restart or another machine) sees the same lock, even
    // for the right password.
    const after = instance();
    await expect(after.login({ email, password, ip, userAgent: null })).rejects.toMatchObject({
      code: "locked_out",
    });
    // The lock is per email and IP, so the admin can still sign in from elsewhere.
    await expect(
      after.login({ email, password, ip: randomIp(), userAgent: null }),
    ).resolves.toMatchObject({ principal: { email } });
  });
});
