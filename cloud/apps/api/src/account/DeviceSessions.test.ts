import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";

let api: ApiRuntime;
beforeAll(async () => {
  const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
});
afterAll(() => api.close());

describe("signed-in device sessions", () => {
  it("reuses the browser install id and links the current session without changing its refresh time", async () => {
    const client = TestClient.for(api);
    const { userId } = await client.signUp(api, "device-link");
    const before = await api.db.query.session.findFirst({
      where: eq(schema.session.userId, userId),
    });
    const input = { kind: "web", fingerprint: crypto.randomUUID() };
    await client.call("/v1/csrf");
    const [a, b] = await Promise.all([
      client.call("/v1/devices", { method: "POST", json: input }),
      client.call("/v1/devices", { method: "POST", json: input }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const first = await a.json();
    expect((await b.json()).device.id).toBe(first.device.id);
    const after = await api.db.query.session.findFirst({
      where: eq(schema.session.id, before!.id),
    });
    expect(after!.deviceId).toBe(first.device.id);
    expect(after!.updatedAt).toEqual(before!.updatedAt);
    const sessions = await (await client.call("/v1/devices/sessions")).json();
    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0]).toMatchObject({
      id: before!.id,
      deviceId: first.device.id,
      kind: "web",
      current: true,
      ipAddress: client.ip,
    });
    expect(sessions.sessions[0]).not.toHaveProperty("token");
  });

  it("only lists the caller's unexpired sessions and scopes matching install ids to their owner", async () => {
    const owner = TestClient.for(api);
    const other = TestClient.for(api);
    const { userId } = await owner.signUp(api, "device-owner");
    await other.signUp(api, "device-other");
    const input = { kind: "web", fingerprint: crypto.randomUUID() };
    const a = await (await owner.call("/v1/devices", { method: "POST", json: input })).json();
    const b = await (await other.call("/v1/devices", { method: "POST", json: input })).json();
    expect(a.device.id).not.toBe(b.device.id);
    const [expired] = await api.db
      .insert(schema.session)
      .values({
        userId,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() - 1000),
        updatedAt: new Date(),
      })
      .returning();
    const response = await owner.call("/v1/devices/sessions");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].deviceId).toBe(a.device.id);
    expect(body.sessions.some((session: { id: string }) => session.id === expired!.id)).toBe(false);
    expect((await new TestClient(owner.base).call("/v1/devices/sessions")).status).toBe(401);
  });

  it("does not revive revoked devices and rejects malformed registration metadata", async () => {
    const client = TestClient.for(api);
    await client.signUp(api, "device-revoked");
    const input = { kind: "web", fingerprint: crypto.randomUUID() };
    const device = (
      await (await client.call("/v1/devices", { method: "POST", json: input })).json()
    ).device;
    await api.db
      .update(schema.devices)
      .set({ trustState: "revoked" })
      .where(eq(schema.devices.id, device.id));
    expect((await client.call("/v1/devices", { method: "POST", json: input })).status).toBe(403);
    expect(
      (
        await client.call("/v1/devices", {
          method: "POST",
          json: { ...input, name: { invalid: true } },
        })
      ).status,
    ).toBe(400);
  });
});
