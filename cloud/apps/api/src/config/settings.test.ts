import { eq, inArray } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { testDatabase } from "../testing/db.ts";
import { SETTINGS, Settings } from "./settings.ts";

const conn = testDatabase();
const keys = ["gateway.hard_cap_streams", "gateway.ip_requests_per_minute"] as const;
let saved: { key: string; value: unknown }[] = [];

async function put(key: string, value: unknown) {
  await conn.db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

beforeEach(async () => {
  saved = await conn.db.query.settings.findMany({
    where: inArray(schema.settings.key, [...keys]),
  });
  await conn.db.delete(schema.settings).where(inArray(schema.settings.key, [...keys]));
});
afterEach(async () => {
  await conn.db.delete(schema.settings).where(inArray(schema.settings.key, [...keys]));
  for (const row of saved) await put(row.key, row.value);
});
afterAll(() => conn.close());

describe("Settings", () => {
  it("reads stored values and falls back to defaults for missing or invalid ones", async () => {
    await put("gateway.hard_cap_streams", 7);
    await put("gateway.ip_requests_per_minute", "lots");
    const settings = new Settings(conn.db, { ttlMs: 0 });
    expect(await settings.get("gateway.hard_cap_streams")).toBe(7);
    expect(await settings.get("gateway.ip_requests_per_minute")).toBe(
      SETTINGS["gateway.ip_requests_per_minute"].default,
    );
    await put("gateway.ip_requests_per_minute", -5);
    expect(await settings.get("gateway.ip_requests_per_minute")).toBe(300);
    await conn.db
      .delete(schema.settings)
      .where(eq(schema.settings.key, "gateway.hard_cap_streams"));
    expect(await settings.get("gateway.hard_cap_streams")).toBe(200);
  });

  it("serves a cached snapshot until the TTL passes", async () => {
    let now = 1_000_000;
    const settings = new Settings(conn.db, { now: () => now });
    await put("gateway.hard_cap_streams", 11);
    expect(await settings.get("gateway.hard_cap_streams")).toBe(11);
    await put("gateway.hard_cap_streams", 12);
    now += 29_999;
    expect(await settings.get("gateway.hard_cap_streams")).toBe(11);
    now += 1;
    expect(await settings.get("gateway.hard_cap_streams")).toBe(12);
  });

  it("loads the table once for concurrent readers", async () => {
    let queries = 0;
    const counting = new Proxy(conn.db, {
      get(target, prop, receiver) {
        if (prop === "select") queries += 1;
        return Reflect.get(target, prop, receiver);
      },
    });
    const settings = new Settings(counting, { ttlMs: 30_000 });
    await Promise.all([
      settings.get("gateway.hard_cap_streams"),
      settings.get("gateway.soft_cap_streams"),
      settings.get("gateway.ip_requests_per_minute"),
    ]);
    expect(queries).toBe(1);
  });
});
