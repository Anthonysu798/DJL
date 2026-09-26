import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDatabase } from "../client.ts";
import { conversations, messages, organization, runEvents, runs, user } from "./index.ts";

const { db, close } = createDatabase(
  process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl",
  { max: 2 },
);
afterAll(() => close());

async function seedConversation(title: string, searchText = "") {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [u] = await db
    .insert(user)
    .values({ name: `chat-${suffix}`, email: `chat-${suffix}@test.invalid`, emailVerified: true })
    .returning();
  const [o] = await db
    .insert(organization)
    .values({ name: `chat-${suffix}`, slug: `chat-${suffix}`, createdAt: new Date() })
    .returning();
  const [c] = await db
    .insert(conversations)
    .values({ orgId: o!.id, userId: u!.id, title, searchText })
    .returning();
  return { userId: u!.id, orgId: o!.id, conversationId: c!.id };
}

describe("chat schema", () => {
  it("finds conversations by title or appended message text", async () => {
    const marker = `zq${crypto.randomUUID().slice(0, 6)}`;
    const { conversationId } = await seedConversation("Trip plan", `bamboo ${marker}`);
    const hits = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(sql`${conversations.search} @@ plainto_tsquery('simple', ${marker})`);
    expect(hits.map((h) => h.id)).toEqual([conversationId]);
  });

  it("makes client message ids unique per conversation only", async () => {
    const a = await seedConversation("a");
    const b = await seedConversation("b");
    const message = { role: "user" as const, parts: [], clientMessageId: "c-1" };
    await db.insert(messages).values({ ...message, conversationId: a.conversationId });
    await expect(
      db.insert(messages).values({ ...message, conversationId: a.conversationId }),
    ).rejects.toThrow();
    await db.insert(messages).values({ ...message, conversationId: b.conversationId });
  });

  it("keeps one event per (run, seq)", async () => {
    const c = await seedConversation("run");
    const [reply] = await db
      .insert(messages)
      .values({ conversationId: c.conversationId, role: "assistant", parts: [] })
      .returning();
    const [run] = await db
      .insert(runs)
      .values({
        orgId: c.orgId,
        userId: c.userId,
        conversationId: c.conversationId,
        messageId: reply!.id,
        mode: "chat",
        model: "text.fast",
      })
      .returning();
    expect(run!.spentMicro).toBe(0n);
    await db.insert(runEvents).values({ runId: run!.id, seq: 1, type: "status", payload: {} });
    await expect(
      db.insert(runEvents).values({ runId: run!.id, seq: 1, type: "status", payload: {} }),
    ).rejects.toThrow();
  });
});
