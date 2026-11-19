import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import type { CloudPushTokenInput } from "@synara/contracts/cloud";
import { afterAll, describe, expect, it } from "vitest";

import type { Principal } from "../auth/guard.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { PushTokenService } from "./PushTokenService.ts";

const conn = testDatabase();
const service = new PushTokenService(conn.db);
afterAll(() => conn.close());

async function principal(label: string): Promise<Principal> {
  const { orgId, userId } = await seedOrg(conn.db, label);
  return {
    userId,
    email: `${label}@test.invalid`,
    emailVerified: true,
    banned: false,
    sessionId: "s",
    orgId,
    role: "owner",
    personalOrgId: orgId,
  };
}

const input = (token: string, extra: Partial<CloudPushTokenInput> = {}) =>
  ({ token, environment: "production", ...extra }) as CloudPushTokenInput;

describe("push tokens", () => {
  it("keeps FCM identifiers case sensitive, separate from APNs, and moves only their own row", async () => {
    const a = await principal("fcm-a");
    const b = await principal("fcm-b");
    const token = `AbC_${crypto.randomUUID()}`;
    const fcm = { provider: "fcm", token, environment: "production" } as const;
    await service.register(a, fcm);
    await service.register(a, { ...fcm, token: token.toLowerCase() });
    const rows = await conn.db
      .select()
      .from(schema.fcmInstallations)
      .where(eq(schema.fcmInstallations.userId, a.userId));
    expect(rows.map((row) => row.installationId).toSorted()).toEqual(
      [token, token.toLowerCase()].toSorted(),
    );
    expect(
      await conn.db.select().from(schema.pushTokens).where(eq(schema.pushTokens.userId, a.userId)),
    ).toEqual([]);
    await conn.db
      .update(schema.fcmInstallations)
      .set({ revokedAt: new Date() })
      .where(eq(schema.fcmInstallations.installationId, token));
    await service.register(b, fcm);
    const [moved] = await conn.db
      .select()
      .from(schema.fcmInstallations)
      .where(eq(schema.fcmInstallations.installationId, token));
    expect(moved).toMatchObject({ userId: b.userId, installationId: token, revokedAt: null });
  });

  it("checks FCM device ownership before writing any installation", async () => {
    const a = await principal("fcm-device-a");
    const b = await principal("fcm-device-b");
    const [device] = await conn.db
      .insert(schema.devices)
      .values({ userId: a.userId, kind: "android", fingerprint: crypto.randomUUID() })
      .returning();
    const fcm = {
      provider: "fcm",
      token: crypto.randomUUID(),
      environment: "production",
      deviceId: device!.id as never,
    } as const;
    await expect(service.register(b, fcm)).rejects.toMatchObject({ status: 404 });
    expect(
      await conn.db
        .select()
        .from(schema.fcmInstallations)
        .where(eq(schema.fcmInstallations.userId, b.userId)),
    ).toEqual([]);
    await service.register(a, fcm);
    const [row] = await conn.db
      .select()
      .from(schema.fcmInstallations)
      .where(eq(schema.fcmInstallations.installationId, fcm.token));
    expect(row?.deviceId).toBe(device!.id);
  });

  it("registers a token, refreshes it, and moves it to the account that registers it last", async () => {
    const a = await principal("push-a");
    const b = await principal("push-b");
    const token = crypto.randomUUID().replaceAll("-", "").repeat(2);
    await service.register(a, input(token.toUpperCase()));
    await service.register(a, input(token, { environment: "sandbox" }));
    let rows = await conn.db
      .select()
      .from(schema.pushTokens)
      .where(eq(schema.pushTokens.token, token));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: a.userId, environment: "sandbox", revokedAt: null });

    await conn.db
      .update(schema.pushTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.pushTokens.token, token));
    await service.register(b, input(token));
    rows = await conn.db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, token));
    expect(rows[0]).toMatchObject({ userId: b.userId, revokedAt: null });
  });

  it("refuses another user's device id (IDOR)", async () => {
    const a = await principal("push-dev-a");
    const b = await principal("push-dev-b");
    const [device] = await conn.db
      .insert(schema.devices)
      .values({ userId: a.userId, kind: "ios", fingerprint: `fp-${a.userId}` })
      .returning();
    const token = crypto.randomUUID().replaceAll("-", "").repeat(2);
    await expect(
      service.register(b, input(token, { deviceId: device!.id as never })),
    ).rejects.toMatchObject({ status: 404 });
    await service.register(a, input(token, { deviceId: device!.id as never }));
    const [row] = await conn.db
      .select()
      .from(schema.pushTokens)
      .where(eq(schema.pushTokens.token, token));
    expect(row?.deviceId).toBe(device!.id);
  });
});
