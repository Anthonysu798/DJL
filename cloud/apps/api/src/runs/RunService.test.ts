import { and, asc, eq, gt } from "drizzle-orm";
import { schema } from "@djl/db";
import type { CloudSendMessageInput } from "@synara/contracts/cloud";
import { afterAll, describe, expect, it } from "vitest";

import { ApiError } from "../http/errors.ts";
import { chatHarness, sleep } from "../testing/chat.ts";
import type { RunEvent } from "./RunLog.ts";

const h = chatHarness();
afterAll(() => h.close());

const input = (text: string, mode: "chat" | "task" = "chat") =>
  ({
    clientMessageId: crypto.randomUUID(),
    parentId: null,
    parts: [{ type: "text", text }],
    model: "gpt-5-mini",
    mode,
  }) as unknown as CloudSendMessageInput;

async function start(label: string, text: string, mode: "chat" | "task" = "chat") {
  const u = await h.user(label);
  const c = await h.chat.create(u.p, {});
  const sent = await h.chat.send(u.facts, c.id, input(text, mode));
  return { ...u, runId: sent.run.id, messageId: sent.reply.id };
}

/** Every event the SSE stream sends after `after`, until it ends. */
async function streamed(p: Parameters<typeof h.runs.stream>[0], runId: string, after: number) {
  const lines = await h.runs.stream(p, runId, after, new AbortController().signal);
  const events: RunEvent[] = [];
  for await (const line of lines) {
    const data = line.match(/^data: (.+)$/m)?.[1];
    if (data) events.push(JSON.parse(data) as RunEvent);
  }
  return events;
}

async function pgEvents(runId: string, after: number) {
  const rows = await h.db
    .select()
    .from(schema.runEvents)
    .where(and(eq(schema.runEvents.runId, runId), gt(schema.runEvents.seq, after)))
    .orderBy(asc(schema.runEvents.seq));
  return rows.map((r) => ({ seq: r.seq, type: r.type, payload: r.payload }));
}

const shape = (events: readonly RunEvent[]) =>
  events.map((e) => ({ seq: e.seq, type: e.type, payload: e.payload }));

describe("runs", () => {
  it("follows a live run from the start: dense seqs, text deltas, usage, then a terminal status", async () => {
    const { p, runId, messageId } = await start("run-live", "long:20");
    const events = await streamed(p, runId, 0);
    expect(events.map((e) => e.seq)).toEqual(events.map((_e, i) => i + 1));
    expect(events[0]).toMatchObject({ type: "status", payload: { status: "running" } });
    expect(events.at(-2)!.type).toBe("usage");
    expect(events.at(-1)).toMatchObject({ type: "status", payload: { status: "succeeded" } });
    const text = events.flatMap((e) => (e.type === "text.delta" ? [e.payload.text] : [])).join("");
    expect(text).toBe("x".repeat(800));
    await h.runner.idle();
    const reply = await h.db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
    expect(reply!.parts).toEqual([{ type: "text", text }]);
    expect((await h.runs.get(p, runId)).run).toMatchObject({
      status: "succeeded",
      lastSeq: events.length,
    });
  });

  it("resumes after a seq from Redis, and from Postgres once the Redis stream is gone", async () => {
    const { p, runId } = await start("run-resume", "resume me");
    await h.runner.idle();
    const all = await pgEvents(runId, 0);
    expect(all.length).toBeGreaterThan(4);

    const fromRedis = await h.runs.events(p, runId, 2);
    expect(await h.redis.exists(`run:${runId}`)).toBe(1);
    expect(shape(fromRedis.events)).toEqual(all.slice(2));
    expect(shape(await streamed(p, runId, 2))).toEqual(all.slice(2));

    await h.redis.del(`run:${runId}`);
    const fromPostgres = await h.runs.events(p, runId, 2);
    expect(shape(fromPostgres.events)).toEqual(all.slice(2));
    expect(shape(await streamed(p, runId, 2))).toEqual(all.slice(2));
    // Nothing after the last event: the stream ends at once.
    expect(await streamed(p, runId, all.length)).toEqual([]);
  });

  it("cancel mid-stream stops the reply, keeps the partial text, and settles only what was used", async () => {
    const { p, runId, messageId } = await start("run-cancel", "long:300");
    const available = await h.ledger.available(p.orgId);
    for (let i = 0; i < 100; i += 1) {
      const events = await h.log.read(runId, 0);
      if (events.filter((e) => e.type === "text.delta").length >= 3) break;
      await sleep(20);
    }
    const cancelled = await h.runs.cancel(p, runId);
    expect(cancelled.run.status).toBe("running");
    await h.runner.idle();

    const events = (await h.runs.events(p, runId, 0)).events;
    expect(events.at(-1)).toMatchObject({ type: "status", payload: { status: "cancelled" } });
    const usage = events.find((e) => e.type === "usage");
    expect(usage?.type).toBe("usage");
    const settled = BigInt(usage!.type === "usage" ? usage!.payload.settled : "0");
    expect(settled).toBeGreaterThan(0n);

    const run = await h.db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
    expect(run).toMatchObject({ status: "cancelled", spentMicro: settled });
    const reply = await h.db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
    const text = (reply!.parts as { text: string }[])[0]!.text;
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(300 * 40);
    // The reservation is gone and exactly the settled amount was spent.
    expect(available - (await h.ledger.available(p.orgId))).toBe(settled);
    const request = await h.db.query.usageRequests.findFirst({
      where: eq(schema.usageRequests.id, usage!.type === "usage" ? usage!.payload.requestId : ""),
    });
    expect(request?.status).toBe("settled");
    // Cancelling again is a no-op.
    expect((await h.runs.cancel(p, runId)).run.status).toBe("cancelled");
  });

  it("cancelling a queued task run ends it with a status event", async () => {
    const { p, runId } = await start("run-queued", "later", "task");
    const { run } = await h.runs.cancel(p, runId);
    expect(run.status).toBe("cancelled");
    expect(run.lastSeq).toBe(1);
    const events = await streamed(p, runId, 0);
    expect(events).toMatchObject([
      { seq: 1, type: "status", payload: { status: "cancelled", error: null } },
    ]);
  });

  it("another user or org cannot read, follow, or cancel a run (404)", async () => {
    const { p, runId } = await start("run-idor", "mine");
    await h.runner.idle();
    const intruder = await h.user("run-idor-x");
    for (const q of [intruder.p, { ...p, orgId: intruder.p.orgId }]) {
      for (const attempt of [
        () => h.runs.get(q, runId),
        () => h.runs.events(q, runId, 0),
        () => h.runs.stream(q, runId, 0, new AbortController().signal),
        () => h.runs.cancel(q, runId),
      ]) {
        const error = await attempt().then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(404);
      }
    }
  });
});
