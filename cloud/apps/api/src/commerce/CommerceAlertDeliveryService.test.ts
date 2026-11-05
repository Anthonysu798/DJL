/** Real isolated PostgreSQL only: no provider/network or shared auth database is used. */
import { eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema, type DjlDatabase } from "@djl/db";
import { MockOutbox, type EmailSender } from "@djl/notify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import {
  CommerceAlertDeliveryService,
  type CommerceAlertEmailOptions,
} from "./CommerceAlertDeliveryService.ts";
const conn = await isolatedCommerceTestDatabase();
let now = new Date("2030-01-01T00:00:00Z");
const outbox = () => new MockOutbox(false);
const service = (
  sender: EmailSender | undefined,
  options: Partial<CommerceAlertEmailOptions> = {},
  db = conn.db,
) =>
  new CommerceAlertDeliveryService(db, {
    enabled: true,
    environment: "test",
    mode: "mock",
    to: "ops@test.invalid",
    from: "sender@test.invalid",
    now: () => now,
    ...(sender ? { sender } : {}),
    ...options,
  });
async function incident(state: "pending" | "open" | "resolved" = "open") {
  const [row] = await conn.db
    .insert(schema.commerceAlertIncidents)
    .values({
      kind: "payment_unresolved",
      resourceType: "payment_attempt",
      resourceId: crypto.randomUUID(),
      sourceStatus: "unknown",
      state,
      firstDetectedAt: now,
      lastSeenAt: now,
      lastTransitionAt: now,
      openedAt: state === "pending" ? null : now,
      resolvedAt: state === "resolved" ? now : null,
    })
    .returning();
  return row!;
}
async function receipt(id: string, mode: "mock" | "resend" = "mock") {
  const rows = await conn.db
    .select()
    .from(schema.commerceAlertEmailDeliveries)
    .where(eq(schema.commerceAlertEmailDeliveries.incidentId, id));
  return rows.find((row) => row.mode === mode)!;
}
async function pending(id: string, recipient = "ops@test.invalid") {
  await conn.db
    .insert(schema.commerceAlertEmailDeliveries)
    .values({ incidentId: id, mode: "mock", recipient, createdAt: now });
}
const protectedTables = [
  "commerce_ledger",
  "commerce_orders",
  "commerce_order_items",
  "commerce_products",
  "commerce_commissions",
  "commerce_withdrawals",
  "commerce_payment_attempts",
  "commerce_provider_refunds",
  "commerce_external_refunds",
  "credit_ledger",
  "account",
  "jwks",
];
async function protectedHashes() {
  const result = [];
  for (const table of protectedTables) {
    result.push(
      await conn.db.execute(
        sql.raw(
          `select count(*)::text n,encode(sha256(convert_to(coalesce(string_agg(h,'' order by h),''),'UTF8')),'hex') h from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h from public."${table}" t) q`,
        ),
      ),
    );
  }
  return JSON.parse(JSON.stringify(result));
}
function failingDb(mode: "audit" | "claim_audit" | "completion_outage" | "committed"): DjlDatabase {
  let failed = false;
  let completionFailures = 0;
  return new Proxy(conn.db, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async (callback: any, config: any) => {
        const result = await target.transaction(
          (tx) =>
            callback(
              new Proxy(tx, {
                get(inner, method, r) {
                  if (method !== "execute") return Reflect.get(inner, method, r);
                  return (query: any) => {
                    const statement = new PgDialect().sqlToQuery(query);
                    if (
                      mode === "completion_outage" &&
                      statement.sql.includes("provider_id=") &&
                      completionFailures++ < 2
                    )
                      throw new Error("Synthetic completion database outage");
                    if (
                      !failed &&
                      (mode === "audit" || mode === "claim_audit") &&
                      statement.sql.includes("insert into audit_events") &&
                      statement.params.some(
                        (p) =>
                          typeof p === "string" &&
                          p.includes(
                            mode === "audit" ? '"state":"simulated"' : '"state":"submitting"',
                          ),
                      )
                    ) {
                      failed = true;
                      throw new Error("Synthetic completion audit failure");
                    }
                    return inner.execute(query);
                  };
                },
              }),
            ),
          config,
        );
        if (!failed && mode === "committed" && result === "simulated") {
          failed = true;
          throw new Error("Synthetic commit acknowledgement loss");
        }
        return result;
      };
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  now = new Date(now.getTime() + 86400000);
  await conn.db
    .update(schema.commerceAlertIncidents)
    .set({ state: "resolved", resolvedAt: now, lastTransitionAt: now });
});
afterAll(() => conn.close());

describe("durable commerce email follow-up", () => {
  it("disabled, unknown environment, invalid address and absent sender do no database or provider IO", async () => {
    const db = new Proxy({} as DjlDatabase, {
      get() {
        throw new Error("Unexpected database IO");
      },
    });
    const sender = { send: vi.fn() };
    for (const options of [
      { enabled: false },
      { environment: "invalid" },
      { to: "ops@test.invalid\r\nBcc:other@test.invalid" },
      { to: "ops@test.invalid\n" },
    ]) {
      expect((await service(sender, options, db).dispatch()).claimed).toBe(0);
    }
    expect(
      (await service(undefined, { senderConfigured: true }, db).dispatch()).configuration,
    ).toBe("unavailable");
    expect(sender.send).not.toHaveBeenCalled();
  });
  it("records mock simulation once, exposes no mailbox/body/provider ID, and preserves financial/AI rows", async () => {
    const row = await incident();
    const sender = outbox();
    const customer = crypto.randomUUID(),
      eventKey = `email-safety:${crypto.randomUUID()}`;
    await conn.db
      .insert(schema.commerceCustomers)
      .values({ userId: customer, referralCode: crypto.randomUUID() });
    await conn.db
      .insert(schema.commerceWithdrawals)
      .values({ userId: customer, amountCents: 2000 });
    await conn.db.insert(schema.commerceLedger).values([
      {
        eventKey,
        line: 0,
        ownerId: customer,
        account: "frozen",
        amountCents: 2000,
        resourceId: customer,
      },
      {
        eventKey,
        line: 1,
        ownerId: "platform",
        account: "cash",
        amountCents: -2000,
        resourceId: customer,
      },
    ]);
    const before = await protectedHashes();
    expect(await service(sender).dispatch()).toMatchObject({ simulated: 1, accepted: 0 });
    expect((await receipt(row.id)).state).toBe("simulated");
    await service(sender).dispatch();
    expect(sender.emails).toHaveLength(1);
    const status = await service(sender, { enabled: false }).status([row.id]);
    expect(status.summary.configuration).toBe("disabled");
    expect(status.deliveries[row.id]).toMatchObject({ mode: "mock", state: "simulated" });
    expect(JSON.stringify(status)).not.toContain("ops@test.invalid");
    expect(JSON.stringify(status)).not.toContain("mock_email_");
    expect(await protectedHashes()).toEqual(before);
  });
  it("claims concurrently exactly once and commits/releases row locks before sender IO", async () => {
    const row = await incident();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const sender = {
      send: async () => {
        calls++;
        await conn.db.transaction(async (tx) => {
          const [visible] = await tx.execute<{ state: string }>(
            sql`select state from commerce_alert_email_deliveries where incident_id=${row.id} for update nowait`,
          );
          expect(visible!.state).toBe("submitting");
        });
        entered();
        await gate;
        return { id: "mock_fixture_receipt" };
      },
    };
    const first = service(sender).dispatch();
    await started;
    await service(sender).dispatch();
    release();
    await first;
    expect(calls).toBe(1);
    expect((await receipt(row.id)).state).toBe("simulated");
  });
  it.each(["throw", "empty", "oversized", "control", "timeout"])(
    "retains %s result as needs_review across restart/config changes without another send",
    async (mode) => {
      const row = await incident();
      const sender = {
        send: vi.fn(async () => {
          if (mode === "throw") throw new Error("private-provider-body ops@test.invalid");
          if (mode === "timeout") return new Promise<{ id: string }>(() => {});
          return {
            id: mode === "empty" ? "" : mode === "oversized" ? "x".repeat(201) : "private\nbody",
          };
        }),
      };
      expect((await service(sender, { timeoutMs: 10 }).dispatch()).needsReview).toBe(1);
      expect(await receipt(row.id)).toMatchObject({
        state: "needs_review",
        reasonCode: "send_result_unknown",
        providerId: null,
      });
      await service(sender, { to: "different@test.invalid" }).dispatch();
      expect(sender.send).toHaveBeenCalledTimes(1);
    },
  );
  it("recovers a crashed claim to review, never reclaiming it or mailing a new recipient", async () => {
    const row = await incident();
    await pending(row.id);
    await conn.db
      .update(schema.commerceAlertEmailDeliveries)
      .set({ state: "submitting", claimToken: crypto.randomUUID(), attemptedAt: now })
      .where(eq(schema.commerceAlertEmailDeliveries.incidentId, row.id));
    now = new Date(now.getTime() + 121000);
    const sender = outbox();
    await service(sender).dispatch();
    expect(await receipt(row.id)).toMatchObject({
      state: "needs_review",
      reasonCode: "delivery_interrupted",
    });
    expect(sender.emails).toHaveLength(0);
  });
  it("does not contact a changed pending recipient or mail a resolved queue entry", async () => {
    const changed = await incident();
    const resolved = await incident("resolved");
    await pending(changed.id, "old@test.invalid");
    await pending(resolved.id);
    const sender = outbox();
    await service(sender).dispatch();
    expect(await receipt(changed.id)).toMatchObject({
      state: "needs_review",
      reasonCode: "recipient_changed",
    });
    expect((await receipt(resolved.id)).state).toBe("skipped_resolved");
    expect(sender.emails).toHaveLength(0);
  });
  it("rolls back a failed completion audit after sending and persists review, never resending", async () => {
    const row = await incident();
    const sender = outbox();
    expect((await service(sender, {}, failingDb("audit")).dispatch()).needsReview).toBe(1);
    expect((await receipt(row.id)).state).toBe("needs_review");
    await service(sender).dispatch();
    expect(sender.emails).toHaveLength(1);
  });
  it("does not send before a required claim audit commits, and safely retries that unsent pending receipt", async () => {
    const row = await incident();
    const sender = outbox();
    await expect(service(sender, {}, failingDb("claim_audit")).dispatch()).rejects.toMatchObject({
      code: "commerce_alert_email_unavailable",
    });
    expect(sender.emails).toHaveLength(0);
    expect((await receipt(row.id)).state).toBe("pending");
    await service(sender).dispatch();
    expect(sender.emails).toHaveLength(1);
  });
  it("retains a committed claim across a post-send database outage and restart, then reaps it without resending", async () => {
    const row = await incident();
    const sender = outbox();
    await expect(
      service(sender, {}, failingDb("completion_outage")).dispatch(),
    ).rejects.toMatchObject({ code: "commerce_alert_email_unavailable" });
    expect((await receipt(row.id)).state).toBe("submitting");
    now = new Date(now.getTime() + 121000);
    await service(sender).dispatch();
    expect((await receipt(row.id)).state).toBe("needs_review");
    expect(sender.emails).toHaveLength(1);
  });
  it("keeps a genuinely committed terminal receipt when its acknowledgement is lost", async () => {
    const row = await incident();
    const sender = outbox();
    await service(sender, {}, failingDb("committed")).dispatch();
    expect((await receipt(row.id)).state).toBe("simulated");
    await service(sender).dispatch();
    expect(sender.emails).toHaveLength(1);
  });
  it("does not let a mock receipt suppress a separate provider attempt and does not call accepted delivered", async () => {
    const row = await incident();
    const mock = outbox();
    await service(mock).dispatch();
    const fakeProvider = { send: vi.fn(async () => ({ id: "provider_fixture_receipt" })) };
    expect((await service(fakeProvider, { mode: "resend" }).dispatch()).accepted).toBe(1);
    expect((await receipt(row.id, "resend")).state).toBe("accepted");
    expect(mock.emails).toHaveLength(1);
    await service(fakeProvider, { mode: "resend" }).dispatch();
    expect(fakeProvider.send).toHaveBeenCalledTimes(1);
  });
  it("ignores pending/unopened and previously resolved incidents, permits a genuine new incident recurrence, and drains over100 without starvation", async () => {
    await incident("pending");
    await incident("resolved");
    for (let n = 0; n < 103; n++) await incident();
    const sender = outbox();
    for (let n = 0; n < 6; n++) await service(sender).dispatch();
    expect(sender.emails).toHaveLength(103);
    const again = await incident();
    await service(sender).dispatch();
    expect((await receipt(again.id)).state).toBe("simulated");
    expect(sender.emails).toHaveLength(104);
  });
  it("enforces immutable identity/terminal outcomes, fixed reasons and DB timestamp ordering", async () => {
    const row = await incident();
    const sender = outbox();
    await service(sender).dispatch();
    const sent = await receipt(row.id);
    for (const query of [
      sql`delete from commerce_alert_email_deliveries where id=${sent.id}`,
      sql`update commerce_alert_email_deliveries set state='pending' where id=${sent.id}`,
      sql`update commerce_alert_email_deliveries set recipient='other@test.invalid' where id=${sent.id}`,
    ])
      await expect(conn.db.execute(query)).rejects.toBeDefined();
    const other = await incident();
    await pending(other.id);
    const queued = await receipt(other.id);
    await expect(
      conn.db.execute(
        sql`update commerce_alert_email_deliveries set state='submitting',claim_token=${crypto.randomUUID()},attempted_at=${new Date(now.getTime() - 1000).toISOString()}::timestamptz where id=${queued.id}`,
      ),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      conn.db.execute(
        sql`update commerce_alert_email_deliveries set state='needs_review',reason_code='provider body',completed_at=${now.toISOString()}::timestamptz where id=${queued.id}`,
      ),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await conn.db.execute(
      sql`update commerce_alert_email_deliveries set state='submitting',claim_token=${crypto.randomUUID()},attempted_at=${new Date(now.getTime() + 2000).toISOString()}::timestamptz where id=${queued.id}`,
    );
    await expect(
      conn.db.execute(
        sql`update commerce_alert_email_deliveries set state='needs_review',reason_code='send_result_unknown',completed_at=${new Date(now.getTime() + 1000).toISOString()}::timestamptz where id=${queued.id}`,
      ),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    const productionClock = new CommerceAlertDeliveryService(conn.db, {
      enabled: true,
      environment: "test",
      mode: "mock",
      to: "ops@test.invalid",
      sender,
    });
    await conn.db
      .update(schema.commerceAlertIncidents)
      .set({ state: "resolved", resolvedAt: now, lastTransitionAt: now });
    const dbClockIncident = await incident();
    await productionClock.dispatch();
    const timed = await receipt(dbClockIncident.id);
    expect(timed.state).toBe("simulated");
    expect(timed.attemptedAt!.getTime()).toBeGreaterThanOrEqual(timed.createdAt.getTime());
    expect(timed.completedAt!.getTime()).toBeGreaterThanOrEqual(timed.attemptedAt!.getTime());
    expect((await productionClock.status()).summary.configuration).toBe("ready");
  });
});
