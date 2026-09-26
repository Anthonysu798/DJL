/**
 * Red team: abuse flags are enforced at the gateway. An open suspend flag
 * blocks the user outright; an open warn flag cuts their rate; a resolved
 * flag does nothing.
 */
import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { DEFAULT_PLANS } from "@djl/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import type { AdmissionContext } from "../gateway/admission.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { abusePolicy } from "./abusePolicy.ts";

const STARTER = DEFAULT_PLANS.find((plan) => plan.id === "starter")!;

describe("abuse admission policy", () => {
  const { db, close } = testDatabase();
  afterAll(close);

  async function context(requestsPerMinute = 8): Promise<AdmissionContext> {
    const { userId, orgId } = await seedOrg(db, "abuse");
    return {
      facts: {
        principal: {
          userId,
          orgId,
          personalOrgId: orgId,
          email: "x@test.invalid",
          emailVerified: true,
          banned: false,
          sessionId: "s",
          role: "owner",
        },
        traceId: "t",
        ipHash: null,
        deviceId: null,
      },
      limits: {
        planId: "starter",
        concurrentStreams: 2,
        requestsPerMinute,
        priorityWeight: 1,
        windowCaps: { fiveHour: STARTER.window5h, week: STARTER.windowWeek },
      },
    };
  }

  it("refuses a user or an org with an open suspend flag, and admits once it is resolved", async () => {
    const policy = abusePolicy({ db, limiter: createMemoryRateLimiter() });
    const ctx = await context();
    const [flag] = await db
      .insert(schema.abuseFlags)
      .values({ userId: ctx.facts.principal.userId, kind: "manual", severity: "suspend" })
      .returning();
    await expect(policy.admit(ctx)).rejects.toMatchObject({ status: 403, code: "suspended" });
    await db
      .update(schema.abuseFlags)
      .set({ resolvedAt: new Date(), resolvedBy: "test" })
      .where(eq(schema.abuseFlags.id, flag!.id));
    await expect(policy.admit(ctx)).resolves.toBeUndefined();

    const orgCtx = await context();
    await db
      .insert(schema.abuseFlags)
      .values({ orgId: orgCtx.facts.principal.orgId, kind: "velocity", severity: "suspend" });
    await expect(policy.admit(orgCtx)).rejects.toMatchObject({ code: "suspended" });
  });

  it("cuts a warned user to a quarter of their plan rate", async () => {
    const policy = abusePolicy({ db, limiter: createMemoryRateLimiter() });
    const ctx = await context(8);
    await db
      .insert(schema.abuseFlags)
      .values({ userId: ctx.facts.principal.userId, kind: "refusals", severity: "warn" });
    await policy.admit(ctx);
    await policy.admit(ctx);
    await expect(policy.admit(ctx)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("ignores info flags", async () => {
    const policy = abusePolicy({ db, limiter: createMemoryRateLimiter() });
    const ctx = await context(1);
    await db
      .insert(schema.abuseFlags)
      .values({ userId: ctx.facts.principal.userId, kind: "refusals", severity: "info" });
    for (let i = 0; i < 3; i += 1) await expect(policy.admit(ctx)).resolves.toBeUndefined();
  });
});

describe("suspended user at the gateway", () => {
  let api: ApiRuntime;
  beforeAll(async () => {
    const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
    api = await startApi({ env, port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => {
    await api.close();
  });

  it("answers 403 suspended to chat completions once a suspend flag is open", async () => {
    const client = TestClient.for(api);
    const { email, password, userId } = await client.signUp(api, "suspend");
    const signIn = await new TestClient(client.base).call("/v1/auth/sign-in/email", {
      method: "POST",
      json: { email, password },
    });
    const bearer = signIn.headers.get("set-auth-token")!;
    await api.db.insert(schema.abuseFlags).values({ userId, kind: "manual", severity: "suspend" });
    const res = await client.call("/v1/chat/completions", {
      method: "POST",
      bearer,
      json: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("suspended");
  });
});
