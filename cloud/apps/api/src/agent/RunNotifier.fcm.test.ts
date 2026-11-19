import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { MockOutbox, MockPushSender } from "@djl/notify";
import { afterAll, expect, it } from "vitest";

import type { RunRow } from "../runs/wire.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { RunNotifier } from "./RunNotifier.ts";

const conn = testDatabase();
afterAll(() => conn.close());

async function fixture() {
  const { userId, orgId } = await seedOrg(conn.db, "fcm-notifier");
  const [conversation] = await conn.db
    .insert(schema.conversations)
    .values({ userId, orgId, title: "private test content" })
    .returning();
  const installationId = `AbC_${crypto.randomUUID()}`;
  await conn.db.insert(schema.fcmInstallations).values({ userId, installationId });
  const run = {
    id: crypto.randomUUID(),
    userId,
    conversationId: conversation!.id,
    status: "succeeded",
  } as RunRow;
  const fcm = new MockPushSender();
  const push = new MockPushSender();
  const email = new MockOutbox();
  const notifier = new RunNotifier({
    db: conn.db,
    push,
    fcm,
    email,
    webPublicUrl: "https://app.test",
  });
  return { userId, installationId, run, fcm, push, email, notifier };
}

it("sends only content-free Cloud route data through the installation's provider", async () => {
  const t = await fixture();
  expect(await t.notifier.runFinished(t.run)).toBe("push");
  expect(t.push.sent).toEqual([]);
  expect(t.fcm.sent).toHaveLength(1);
  expect(t.fcm.sent[0]).toMatchObject({
    token: t.installationId,
    environment: "production",
    message: {
      data: {
        source: "djl.cloudRun",
        runId: t.run.id,
        conversationId: t.run.conversationId,
        status: "succeeded",
        url: `djl://cloud/c/${t.run.conversationId}`,
      },
    },
  });
  expect(JSON.stringify(t.fcm.sent)).not.toContain("private test content");
  expect(t.email.emails).toEqual([]);
});

it("revokes only dead FCM rows and falls back to email", async () => {
  const t = await fixture();
  const apns = crypto.randomUUID().replaceAll("-", "").repeat(2);
  await conn.db
    .insert(schema.pushTokens)
    .values({ userId: t.userId, token: apns, environment: "production" });
  t.fcm.dead.add(t.installationId);
  const notifier = new RunNotifier({
    db: conn.db,
    push: null,
    fcm: t.fcm,
    email: t.email,
    webPublicUrl: "https://app.test",
  });
  expect(await notifier.runFinished(t.run)).toBe("email");
  const row = await conn.db.query.fcmInstallations.findFirst({
    where: eq(schema.fcmInstallations.installationId, t.installationId),
  });
  expect(row?.revokedAt).toBeInstanceOf(Date);
  expect(
    (await conn.db.query.pushTokens.findFirst({ where: eq(schema.pushTokens.token, apns) }))
      ?.revokedAt,
  ).toBeNull();
});

it("does not revoke or suppress email for an unconfigured FCM provider", async () => {
  const t = await fixture();
  const notifier = new RunNotifier({
    db: conn.db,
    push: null,
    email: t.email,
    webPublicUrl: "https://app.test",
  });
  expect(await notifier.runFinished(t.run)).toBe("email");
  expect(
    (
      await conn.db.query.fcmInstallations.findFirst({
        where: eq(schema.fcmInstallations.installationId, t.installationId),
      })
    )?.revokedAt,
  ).toBeNull();
});

it("keeps transient FCM failures live and skips cancelled runs", async () => {
  const t = await fixture();
  const notifier = new RunNotifier({
    db: conn.db,
    push: null,
    fcm: { send: async () => ({ ok: false, reason: "fcm_http_503", unregistered: false }) },
    email: t.email,
    webPublicUrl: "https://app.test",
  });
  expect(await notifier.runFinished(t.run)).toBe("none");
  expect(await notifier.runFinished({ ...t.run, status: "cancelled" })).toBe("none");
  expect(t.email.emails).toEqual([]);
  expect(
    (
      await conn.db.query.fcmInstallations.findFirst({
        where: eq(schema.fcmInstallations.installationId, t.installationId),
      })
    )?.revokedAt,
  ).toBeNull();
});

it("does not revoke an installation re-registered by another account during delivery", async () => {
  const t = await fixture();
  const next = await seedOrg(conn.db, "fcm-next-owner");
  const notifier = new RunNotifier({
    db: conn.db,
    push: null,
    fcm: {
      send: async () => {
        await conn.db
          .update(schema.fcmInstallations)
          .set({ userId: next.userId, lastSeenAt: new Date() })
          .where(eq(schema.fcmInstallations.installationId, t.installationId));
        return { ok: false, reason: "fcm_unregistered", unregistered: true };
      },
    },
    email: t.email,
    webPublicUrl: "https://app.test",
  });
  expect(await notifier.runFinished(t.run)).toBe("email");
  expect(
    await conn.db.query.fcmInstallations.findFirst({
      where: eq(schema.fcmInstallations.installationId, t.installationId),
    }),
  ).toMatchObject({ userId: next.userId, revokedAt: null });
});
