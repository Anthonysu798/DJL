import type { CloudSendMessageInput } from "@synara/contracts/cloud";
import { afterAll, describe, expect, it } from "vitest";

import { ApiError } from "../http/errors.ts";
import { chatHarness } from "../testing/chat.ts";

const h = chatHarness();
afterAll(() => h.close());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

const message = (parts: unknown[], parentId: string | null = null) =>
  ({
    clientMessageId: crypto.randomUUID(),
    parentId,
    parts,
    model: "gpt-5-mini",
    mode: "chat",
  }) as unknown as CloudSendMessageInput;
const text = (t: string) => ({ type: "text", text: t });

async function status(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return (error as ApiError).status;
}

const tokenOf = (url: string) => url.split("/share/")[1]!;

async function conversationWithReply(label: string) {
  const u = await h.user(label);
  const c = await h.chat.create(u.p, { title: "Shared chat" } as never);
  const first = await h.chat.send(u.facts, c.id, message([text("first question")]));
  await h.runner.idle();
  return { ...u, c, first };
}

describe("shares", () => {
  it("shares a snapshot of the current branch; later messages never appear", async () => {
    const { p, facts, c, first } = await conversationWithReply("share-snap");
    const { share, url } = await h.shares.create(p, c.id, {});
    expect(url).toMatch(/^https:\/\/app\.test\/share\/[A-Za-z0-9_-]{43}$/);
    expect(share).toMatchObject({ conversationId: c.id, title: "Shared chat", revokedAt: null });

    await h.chat.send(facts, c.id, message([text("a later secret")], first.reply.id));
    await h.runner.idle();

    const view = await h.shares.view(tokenOf(url));
    expect(view.title).toBe("Shared chat");
    expect(view.messages.map((m) => [m.role, m.parts])).toEqual([
      ["user", [text("first question")]],
      ["assistant", [text("echo: first question")]],
    ]);
    expect(JSON.stringify(view)).not.toContain("later secret");
  });

  it("revoking a share, or deleting the conversation, makes the link 404", async () => {
    const { p, c } = await conversationWithReply("share-revoke");
    const kept = await h.shares.create(p, c.id, {});
    const revoked = await h.shares.create(p, c.id, {});
    expect((await h.shares.revoke(p, revoked.share.id)).revokedAt).not.toBeNull();
    expect(await status(h.shares.view(tokenOf(revoked.url)))).toBe(404);
    await h.shares.view(tokenOf(kept.url));
    const listed = await h.shares.list(p);
    expect(listed.shares.map((s) => [s.id, s.revokedAt === null])).toEqual([
      [revoked.share.id, false],
      [kept.share.id, true],
    ]);

    await h.chat.remove(p, c.id);
    expect(await status(h.shares.view(tokenOf(kept.url)))).toBe(404);
  });

  it("unknown or malformed tokens are 404", async () => {
    expect(await status(h.shares.view("short"))).toBe(404);
    expect(await status(h.shares.view("A".repeat(43)))).toBe(404);
  });

  it("gives shared images short-lived URLs scoped to the snapshot", async () => {
    const { p, facts } = await h.user("share-image");
    const image = await h.uploadFile(p, PNG, { mimeType: "image/png", purpose: "image" });
    await image.complete();
    const c = await h.chat.create(p, {});
    await h.chat.send(
      facts,
      c.id,
      message([
        text("look"),
        { type: "image_ref", fileId: image.id, mimeType: "image/png", width: null, height: null },
      ]),
    );
    await h.runner.idle();
    const { url } = await h.shares.create(p, c.id, {});
    const view = await h.shares.view(tokenOf(url));
    expect(Object.keys(view.imageUrls)).toEqual([image.id]);
    expect(view.imageUrls[image.id]).toContain(encodeURIComponent(image.key));
  });

  it("another user or org cannot share someone's conversation or revoke their share (404)", async () => {
    const { p, c, first } = await conversationWithReply("share-idor");
    const { share, url } = await h.shares.create(p, c.id, {});
    const intruder = await h.user("share-idor-x");
    for (const q of [intruder.p, { ...p, orgId: intruder.p.orgId }]) {
      expect(await status(h.shares.create(q, c.id, {}))).toBe(404);
      expect(await status(h.shares.create(q, c.id, { messageId: first.reply.id } as never))).toBe(
        404,
      );
      expect(await status(h.shares.revoke(q, share.id))).toBe(404);
      expect((await h.shares.list(q)).shares).toEqual([]);
    }
    await h.shares.view(tokenOf(url));
  });

  it("a message from another conversation cannot be the snapshot leaf", async () => {
    const a = await conversationWithReply("share-leaf");
    const b = await h.chat.create(a.p, {});
    expect(await status(h.shares.create(a.p, b.id, { messageId: a.first.reply.id } as never))).toBe(
      404,
    );
  });
});
