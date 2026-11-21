import { and, eq } from "drizzle-orm";
import { schema } from "@djl/db";
import type { CloudCreateContentReportInput, CloudSendMessageInput } from "@synara/contracts/cloud";
import { afterAll, describe, expect, it } from "vitest";

import type { AdminPrincipal } from "../admin/AdminAuth.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import { chatHarness } from "../testing/chat.ts";
import { ContentReportService } from "./ContentReportService.ts";

const h = chatHarness();
afterAll(() => h.close());

let clock = Date.now();
const reports = new ContentReportService(
  h.db,
  h.chat,
  createMemoryRateLimiter(() => clock),
);

const message = (t: string, parentId: string | null = null) =>
  ({
    clientMessageId: crypto.randomUUID(),
    parentId,
    parts: [{ type: "text", text: t }],
    model: "gpt-5-mini",
    mode: "chat",
  }) as unknown as CloudSendMessageInput;
const input = (fields: Record<string, unknown>) =>
  ({ reason: "offensive", ...fields }) as unknown as CloudCreateContentReportInput;

async function error(promise: Promise<unknown>) {
  const e = await promise.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ApiError);
  return { status: (e as ApiError).status, code: (e as ApiError).code };
}

async function conversationWithReply(label: string) {
  const u = await h.user(label);
  const c = await h.chat.create(u.p, {});
  const sent = await h.chat.send(u.facts, c.id, message("a question"));
  await h.runner.idle();
  const cloud = (extra: Record<string, unknown> = {}) =>
    input({ source: "cloud", conversationId: c.id, messageId: sent.reply.id, ...extra });
  return { ...u, c, userMessageId: sent.message.id, replyId: sent.reply.id, cloud };
}

async function adminPrincipal(role: "admin" | "employee"): Promise<AdminPrincipal> {
  const email = `reports-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
  const [row] = await h.db
    .insert(schema.admins)
    .values({ email, name: "Moderator", role })
    .returning();
  return { adminId: row!.id, email, role, sessionId: "s", mfaVerified: true };
}

describe("content reports", () => {
  it("snapshots the caller's own assistant message, which survives deletion", async () => {
    const { p, c, replyId, cloud } = await conversationWithReply("report-snap");
    const { status, body } = await reports.create(p, null, cloud({ note: "rude" }));
    expect(status).toBe(201);
    await h.chat.remove(p, c.id);
    const row = await h.db.query.contentReports.findFirst({
      where: eq(schema.contentReports.id, body.report.id),
    });
    expect(row).toMatchObject({
      orgId: p.orgId,
      userId: p.userId,
      source: "cloud",
      reason: "offensive",
      note: "rude",
      conversationId: c.id,
      messageId: replyId,
      snapshot: [{ type: "text", text: "echo: a question" }],
      model: "gpt-5-mini",
      agent: null,
      status: "open",
    });
  });

  it("a repeat report of the same message returns the existing report with 200", async () => {
    const { p, cloud } = await conversationWithReply("report-repeat");
    const first = await reports.create(p, null, cloud());
    const again = await reports.create(p, null, cloud({ reason: "wrong" }));
    expect(again).toEqual({ status: 200, body: first.body });
    const race = await conversationWithReply("report-race");
    const [a, b] = await Promise.all([
      reports.create(race.p, null, race.cloud()),
      reports.create(race.p, null, race.cloud()),
    ]);
    expect(a.body.report.id).toBe(b.body.report.id);
    expect([a.status, b.status].toSorted()).toEqual([200, 201]);
  });

  it("someone else's conversation or message is a 404, never a 403", async () => {
    const victim = await conversationWithReply("report-idor");
    const intruder = await conversationWithReply("report-idor-x");
    // Their conversation and message, as another user and as the owner acting in another org.
    for (const q of [intruder.p, { ...victim.p, orgId: intruder.p.orgId }])
      expect(await error(reports.create(q, null, victim.cloud()))).toMatchObject({ status: 404 });
    // Their message named inside the intruder's own conversation.
    expect(
      await error(reports.create(intruder.p, null, intruder.cloud({ messageId: victim.replyId }))),
    ).toMatchObject({ status: 404 });
    // Ids that cannot name a row.
    expect(
      await error(reports.create(intruder.p, null, intruder.cloud({ messageId: "nope" }))),
    ).toMatchObject({ status: 404 });
    const rows = await h.db.query.contentReports.findMany({
      where: eq(schema.contentReports.messageId, victim.replyId),
    });
    expect(rows).toEqual([]);
  });

  it("only assistant messages can be reported", async () => {
    const { p, cloud, userMessageId } = await conversationWithReply("report-user-msg");
    expect(await error(reports.create(p, null, cloud({ messageId: userMessageId })))).toEqual({
      status: 400,
      code: "not_assistant_message",
    });
  });

  it("rejects fields that do not fit the source", async () => {
    const { p, cloud } = await conversationWithReply("report-mismatch");
    for (const bad of [
      cloud({ text: "pasted" }),
      cloud({ agent: "Codex" }),
      input({ source: "cloud", messageId: crypto.randomUUID() }),
      input({ source: "desktop", text: "answer", messageId: crypto.randomUUID() }),
      input({ source: "desktop", text: "answer", conversationId: crypto.randomUUID() }),
      input({ source: "desktop" }),
    ])
      expect(await error(reports.create(p, null, bad))).toEqual({
        status: 400,
        code: "bad_request",
      });
  });

  it("cloud reports need a signed-in caller; desktop reports do not", async () => {
    const { cloud } = await conversationWithReply("report-anon");
    expect(await error(reports.create(null, "ip-anon", cloud()))).toMatchObject({ status: 401 });
    const anon = await reports.create(
      null,
      "ip-anon",
      input({ source: "desktop", text: "the answer", agent: "Claude", note: "" }),
    );
    expect(anon.status).toBe(201);
    const row = await h.db.query.contentReports.findFirst({
      where: eq(schema.contentReports.id, anon.body.report.id),
    });
    expect(row).toMatchObject({
      orgId: null,
      userId: null,
      source: "desktop",
      note: null,
      snapshot: [{ type: "text", text: "the answer" }],
      agent: "Claude",
      messageId: null,
    });
  });

  it("limits reports to 10 a minute and 50 a day per user, else per IP", async () => {
    const { p } = await h.user("report-limit");
    const desktop = input({ source: "desktop", text: "answer" });
    for (let i = 0; i < 10; i++) await reports.create(p, null, desktop);
    expect(await error(reports.create(p, null, desktop))).toEqual({
      status: 429,
      code: "rate_limited",
    });
    // A different user from the same network is unaffected.
    expect((await reports.create((await h.user("report-limit-2")).p, null, desktop)).status).toBe(
      201,
    );
    // Signed out, the IP is the key.
    for (let i = 0; i < 10; i++) await reports.create(null, "ip-limit", desktop);
    expect(await error(reports.create(null, "ip-limit", desktop))).toMatchObject({ status: 429 });
    expect((await reports.create(null, "ip-other", desktop)).status).toBe(201);
    // The daily cap holds after the minute window passes.
    const start = clock;
    try {
      for (let minute = 1; minute <= 4; minute++) {
        clock = start + minute * 61_000;
        for (let i = 0; i < 10; i++) await reports.create(p, null, desktop);
      }
      clock = start + 5 * 61_000;
      expect(await error(reports.create(p, null, desktop))).toMatchObject({ status: 429 });
    } finally {
      clock = start + 6 * 61_000;
    }
  });

  it("moderators list open reports newest first, page through them, and resolve with an audit row", async () => {
    const employee = await adminPrincipal("employee");
    const { p } = await h.user("report-admin");
    const ids: string[] = [];
    for (const text of ["one", "two", "three"])
      ids.push((await reports.create(p, null, input({ source: "desktop", text }))).body.report.id);

    const first = await reports.list(employee, { status: "open", limit: 2 });
    expect(first.reports.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    expect(first.reports[0]).toMatchObject({ snapshot: [{ type: "text", text: "three" }] });
    expect(first.nextCursor).toBe(ids[1]);
    const second = await reports.list(employee, { status: "open", limit: 2, cursor: ids[1]! });
    expect(second.reports[0]?.id).toBe(ids[0]);
    expect(await error(reports.list(employee, { cursor: "x" }))).toMatchObject({ status: 400 });

    const resolved = await reports.resolve(employee, ids[0]!, "reviewed");
    expect(resolved).toMatchObject({ id: ids[0], status: "resolved" });
    const row = await h.db.query.contentReports.findFirst({
      where: eq(schema.contentReports.id, ids[0]!),
    });
    expect(row).toMatchObject({ status: "resolved", resolvedBy: employee.adminId });
    const audit = await h.db.query.auditEvents.findMany({
      where: and(
        eq(schema.auditEvents.targetId, ids[0]!),
        eq(schema.auditEvents.action, "admin.content_report.resolve"),
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: "admin",
      actorId: employee.adminId,
      targetType: "content_report",
      reason: "reviewed",
    });
    // The audit trail never copies the reported content.
    expect(JSON.stringify(audit[0])).not.toContain("one");

    expect(await error(reports.resolve(employee, ids[0]!, null))).toMatchObject({ status: 409 });
    expect(await error(reports.resolve(employee, crypto.randomUUID(), null))).toMatchObject({
      status: 404,
    });
    expect(
      (await reports.list(employee, { status: "open" })).reports.map((r) => r.id),
    ).not.toContain(ids[0]);
    expect(
      (await reports.list(employee, { status: "resolved" })).reports.map((r) => r.id),
    ).toContain(ids[0]);
  });

  it("commerce-only staff cannot see or resolve reports", async () => {
    const commerce: AdminPrincipal = {
      ...(await adminPrincipal("employee")),
      role: "commerce",
      commerceRole: "support",
    };
    expect(await error(reports.list(commerce, {}))).toMatchObject({ status: 403 });
    expect(await error(reports.resolve(commerce, crypto.randomUUID(), null))).toMatchObject({
      status: 403,
    });
  });
});
