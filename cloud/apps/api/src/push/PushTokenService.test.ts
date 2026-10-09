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
