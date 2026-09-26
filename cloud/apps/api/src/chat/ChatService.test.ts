import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import type { CloudSendMessageInput } from "@synara/contracts/cloud";
import { afterAll, describe, expect, it } from "vitest";

import { ApiError } from "../http/errors.ts";
import { chatHarness } from "../testing/chat.ts";

const h = chatHarness();
afterAll(() => h.close());

const MODEL = "gpt-5-mini";
const input = (text: string, parentId: string | null = null, clientMessageId?: string) =>
  ({
    clientMessageId: clientMessageId ?? crypto.randomUUID(),
    parentId,
    parts: [{ type: "text", text }],
    model: MODEL,
    mode: "chat",
  }) as unknown as CloudSendMessageInput;

async function rejectsWith(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
}

describe("conversations and messages", () => {
  it("sending twice with the same clientMessageId returns the original message and run", async () => {
    const { p, facts } = await h.user("chat-idem");
    const c = await h.chat.create(p, {});
    const body = input("hello", null, "client-1");
    const [first, second] = await Promise.all([
      h.chat.send(facts, c.id, body),
      h.chat.send(facts, c.id, body),
    ]);
    const third = await h.chat.send(facts, c.id, body);
    expect(second.message.id).toBe(first.message.id);
    expect(third.run.id).toBe(first.run.id);
    expect(third.reply.id).toBe(first.reply.id);
    await h.runner.idle();
    const runs = await h.db.select().from(schema.runs).where(eq(schema.runs.conversationId, c.id));
    expect(runs).toHaveLength(1);
  });

  it("streams the reply into the assistant message and titles the conversation", async () => {
    const { p, facts } = await h.user("chat-reply");
    const c = await h.chat.create(p, {});
    const sent = await h.chat.send(facts, c.id, input("hello there"));
    expect(sent.run.status).toBe("queued");
    expect(sent.reply.parts).toEqual([]);
    await h.runner.idle();
    const { conversation, messages } = await h.chat.branch(p, c.id);
    expect(messages.map((m) => m.parts)).toEqual([
      [{ type: "text", text: "hello there" }],
      [{ type: "text", text: "echo: hello there" }],
    ]);
    expect(conversation.title).toBe("echo: hello there");
    expect((await h.runs.get(p, sent.run.id)).run.status).toBe("succeeded");
  });

  it("edit and regenerate add siblings, and switching branches follows the newest replies", async () => {
    const { p, facts } = await h.user("chat-tree");
    const c = await h.chat.create(p, { title: "Tree" } as never);
    const one = await h.chat.send(facts, c.id, input("one"));
    await h.runner.idle();
    const two = await h.chat.send(facts, c.id, input("two", one.reply.id));
    await h.runner.idle();
    // Edit "two": a sibling user message under the same reply.
    const edited = await h.chat.send(facts, c.id, input("two, edited", one.reply.id));
    await h.runner.idle();
    let branch = (await h.chat.branch(p, c.id)).messages;
    expect(branch.map((m) => m.id)).toEqual([
      one.message.id,
      one.reply.id,
      edited.message.id,
      edited.reply.id,
    ]);
    expect(branch[2]!.siblingIds).toEqual([two.message.id, edited.message.id]);

    // Regenerate the edited reply: a sibling reply for the same user message.
    const again = await h.chat.regenerate(facts, c.id, edited.reply.id, {});
    expect(again.message.id).toBe(edited.message.id);
    expect(again.reply.parentId).toBe(edited.message.id);
    await h.runner.idle();
    branch = (await h.chat.branch(p, c.id)).messages;
    expect(branch.at(-1)!.id).toBe(again.reply.id);
    expect(branch.at(-1)!.siblingIds).toEqual([edited.reply.id, again.reply.id]);
    expect(branch.at(-1)!.parts).toEqual([{ type: "text", text: "echo: two, edited" }]);

    // Switch back to the original "two".
    await h.chat.update(p, c.id, { branchMessageId: two.message.id } as never);
    branch = (await h.chat.branch(p, c.id)).messages;
    expect(branch.map((m) => m.id)).toEqual([
      one.message.id,
      one.reply.id,
      two.message.id,
      two.reply.id,
    ]);
    // The whole tree is still there.
    expect((await h.chat.get(p, c.id)).messages).toHaveLength(7);
  });

  it("refuses a parent from another conversation and a user-message parent", async () => {
    const { p, facts } = await h.user("chat-parent");
    const a = await h.chat.create(p, {});
    const b = await h.chat.create(p, {});
    const sent = await h.chat.send(facts, a.id, input("a"));
    await h.runner.idle();
    await rejectsWith(h.chat.send(facts, b.id, input("b", sent.reply.id)), 404);
    await rejectsWith(h.chat.send(facts, a.id, input("b", sent.message.id)), 400);
  });

  it("lists pinned first, then most recent; archived only on request; deleted never", async () => {
    const { p } = await h.user("chat-list");
    const old = await h.chat.create(p, { title: "old" } as never);
    const pinned = await h.chat.create(p, { title: "pinned" } as never);
    const recent = await h.chat.create(p, { title: "recent" } as never);
    const archived = await h.chat.create(p, { title: "archived" } as never);
    const deleted = await h.chat.create(p, { title: "deleted" } as never);
    await h.chat.update(p, pinned.id, { pinned: true } as never);
    await h.chat.update(p, archived.id, { archived: true } as never);
    await h.chat.remove(p, deleted.id);
    const list = await h.chat.list(p, {});
    expect(list.conversations.map((c) => c.id)).toEqual([pinned.id, recent.id, old.id]);
    const onlyArchived = await h.chat.list(p, { archived: "true" });
    expect(onlyArchived.conversations.map((c) => c.id)).toEqual([archived.id]);
    await rejectsWith(h.chat.get(p, deleted.id), 404);
  });

  it("pages the list with a cursor", async () => {
    const { p } = await h.user("chat-page");
    for (let i = 0; i < 33; i += 1) await h.chat.create(p, {});
    const first = await h.chat.list(p, {});
    expect(first.conversations).toHaveLength(30);
    const second = await h.chat.list(p, { cursor: first.nextCursor! } as never);
    expect(second.conversations).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.conversations, ...second.conversations].map((c) => c.id));
    expect(ids.size).toBe(33);
    await rejectsWith(h.chat.list(p, { cursor: "garbage" } as never), 400);
  });

  it("search finds conversations by message content, only the caller's", async () => {
    const owner = await h.user("chat-search");
    const other = await h.user("chat-search-other");
    const marker = `quokka${crypto.randomUUID().slice(0, 6)}`;
    const c = await h.chat.create(owner.p, { title: "Animals" } as never);
    await h.chat.send(owner.facts, c.id, input(`tell me about the ${marker} please`));
    await h.runner.idle();
    const hits = await h.chat.search(owner.p, { q: marker } as never);
    expect(hits.results.map((r) => r.conversation.id)).toEqual([c.id]);
    expect(hits.results[0]!.snippet).toContain(marker);
    expect((await h.chat.search(other.p, { q: marker } as never)).results).toEqual([]);
    await h.chat.remove(owner.p, c.id);
    expect((await h.chat.search(owner.p, { q: marker } as never)).results).toEqual([]);
  });

  it("task mode creates a queued task run and enqueues it instead of running it here", async () => {
    const { p, facts } = await h.user("chat-task");
    const c = await h.chat.create(p, {});
    const sent = await h.chat.send(facts, c.id, { ...input("research this"), mode: "task" });
    await h.runner.idle();
    expect(sent.run.mode).toBe("task");
    expect(h.enqueued).toContain(sent.run.id);
    expect((await h.runs.get(p, sent.run.id)).run.status).toBe("queued");
  });

  it("another user or org cannot read, change, or write into a conversation (404)", async () => {
    const owner = await h.user("chat-idor");
    const intruder = await h.user("chat-idor-x");
    const c = await h.chat.create(owner.p, { title: "Private" } as never);
    const sent = await h.chat.send(owner.facts, c.id, input("secret"));
    await h.runner.idle();
    // Same user acting in an org that is not the conversation's.
    const otherOrg = { ...owner.p, orgId: intruder.p.orgId };
    for (const p of [intruder.p, otherOrg]) {
      const facts = { ...intruder.facts, principal: p };
      await rejectsWith(h.chat.get(p, c.id), 404);
      await rejectsWith(h.chat.branch(p, c.id), 404);
      await rejectsWith(h.chat.update(p, c.id, { title: "mine" } as never), 404);
      await rejectsWith(h.chat.remove(p, c.id), 404);
      await rejectsWith(h.chat.send(facts, c.id, input("hi", sent.reply.id)), 404);
      await rejectsWith(h.chat.regenerate(facts, c.id, sent.reply.id, {}), 404);
      expect((await h.chat.list(p, {})).conversations.map((x) => x.id)).not.toContain(c.id);
    }
    expect((await h.chat.get(owner.p, c.id)).conversation.title).toBe("Private");
  });
});
