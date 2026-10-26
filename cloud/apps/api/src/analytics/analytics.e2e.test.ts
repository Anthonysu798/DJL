import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { TestClient } from "../testing/client.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";

let api: ApiRuntime;
let base: string;
beforeAll(async () => {
  api = await startApi({
    env: loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" }),
    port: 0,
    host: "127.0.0.1",
  });
  base = `http://127.0.0.1:${api.address.port}`;
});
afterAll(() => api?.close());
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("analytics HTTP boundaries", () => {
  it("accepts private installation reports and rejects invalid account identity", async () => {
    const registration = await post("/v1/analytics/installations", {
      installationId: crypto.randomUUID(),
      platform: "ios",
      appVersion: "0.5.0",
      osVersion: "26.1",
      channel: "test",
    });
    expect(registration.status).toBe(201);
    const install = await registration.json();
    const body = {
      events: [
        {
          eventId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          kind: "foreground",
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    const headers = { "x-djl-installation": install.credential };
    expect((await post("/v1/analytics/events", body, headers)).status).toBe(200);
    expect((await post("/v1/analytics/events", body, headers)).status).toBe(200);
    expect(
      (await post("/v1/analytics/events", body, { ...headers, authorization: "Bearer fabricated" }))
        .status,
    ).toBe(401);
    expect(
      (await post("/v1/analytics/events", { ...body, userId: "fabricated" }, headers)).status,
    ).toBe(400);
    expect((await post("/v1/analytics/events", body)).status).toBe(401);
  });

  it("keeps reports behind separate admin authentication", async () => {
    const response = await fetch(`${base}/admin/v1/analytics`);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("deletes optional account activity through the authenticated self-service endpoint", async () => {
    const client = TestClient.for(api);
    const account = await client.signUp(api, "analytics-delete-http");
    const registration = await client.call("/v1/analytics/installations", {
      method: "POST",
      json: {
        installationId: crypto.randomUUID(),
        platform: "web",
        appVersion: "0.5.0",
        osVersion: "unknown",
        channel: "test",
      },
    });
    const install = await registration.json();
    const body = {
      events: [
        {
          eventId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          kind: "feature_used",
          feature: "cloud_chat",
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    expect(
      (
        await client.call("/v1/analytics/events", {
          method: "POST",
          json: body,
          headers: { "x-djl-installation": install.credential },
        })
      ).status,
    ).toBe(200);
    expect(
      await api.db.query.analyticsEvents.findMany({
        where: eq(schema.analyticsEvents.userId, account.userId),
      }),
    ).toHaveLength(1);
    expect((await client.call("/v1/me", { method: "DELETE" })).status).toBe(200);
    expect(
      await api.db.query.analyticsEvents.findMany({
        where: eq(schema.analyticsEvents.userId, account.userId),
      }),
    ).toHaveLength(0);
    expect(
      await api.db.query.analyticsDailyActivity.findMany({
        where: eq(schema.analyticsDailyActivity.userId, account.userId),
      }),
    ).toHaveLength(0);
    expect(
      (
        await client.call("/v1/analytics/events", {
          method: "POST",
          json: body,
          headers: { "x-djl-installation": install.credential },
        })
      ).status,
    ).toBe(401);
  });
});
