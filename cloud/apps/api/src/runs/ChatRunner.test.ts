import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, describe, expect, it, vi } from "vitest";

import { textOf } from "../chat/ChatService.ts";
import { chatHarness } from "../testing/chat.ts";

const h = chatHarness();
afterAll(() => h.close());

const attachment = (fileId: string, mimeType: string, size: number) => ({
  type: "file_ref",
  fileId,
  name: "notes.txt",
  mimeType,
  size,
});
const input = (parts: unknown[], mode: "chat" | "task" = "chat") =>
  ({
    clientMessageId: crypto.randomUUID(),
    parentId: null,
    parts,
    model: "gpt-5-mini",
    mode,
  }) as never;

describe("ordinary chat attachment text", () => {
  it.each([
    ["text/plain", "ATTACHMENT180_OK\nA second public line."],
    ["text/markdown", "# Public note\nATTACHMENT180_OK"],
    ["text/csv", "item,value\ncode,ATTACHMENT180_OK"],
    ["application/json", '{"code":"ATTACHMENT180_OK"}'],
  ])("includes newly uploaded %s bytes in the model context", async (mimeType, body) => {
    const owner = await h.user("chat-document-text");
    const bytes = new TextEncoder().encode(body);
    const file = await h.uploadFile(owner.p, bytes, { mimeType });
    await file.complete();
    const stored = await h.db.query.files.findFirst({ where: eq(schema.files.id, file.id) });
    expect(stored!.textContent).toBeNull();
    const conversation = await h.chat.create(owner.p, {});
    const sent = await h.chat.send(
      owner.facts,
      conversation.id,
      input([
        { type: "text", text: "Read the attached public document." },
        attachment(file.id, mimeType, bytes.byteLength),
      ]),
    );
    await h.runner.idle();
    const reply = await h.db.query.messages.findFirst({
      where: eq(schema.messages.id, sent.reply.id),
    });
    expect(textOf(reply!.parts)).toContain(body);
    expect(textOf(reply!.parts)).not.toContain("its text is not available");
    expect((await h.runs.get(owner.p, sent.run.id)).run.status).toBe("succeeded");
  });

  it("uses cached document extraction without downloading it again", async () => {
    const owner = await h.user("chat-document-cached");
    const bytes = new TextEncoder().encode("%PDF-1.7\npublic fixture");
    const file = await h.uploadFile(owner.p, bytes, { mimeType: "application/pdf" });
    await file.complete();
    await h.db
      .update(schema.files)
      .set({ textContent: "CACHED_DOCUMENT180_OK" })
      .where(eq(schema.files.id, file.id));
    const read = vi.spyOn(h.blobs, "read");
    try {
      const conversation = await h.chat.create(owner.p, {});
      const sent = await h.chat.send(
        owner.facts,
        conversation.id,
        input([
          { type: "text", text: "Read the cached document." },
          attachment(file.id, "application/pdf", bytes.byteLength),
        ]),
      );
      await h.runner.idle();
      const reply = await h.db.query.messages.findFirst({
        where: eq(schema.messages.id, sent.reply.id),
      });
      expect(textOf(reply!.parts)).toContain("CACHED_DOCUMENT180_OK");
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it.each(["different organization", "another user in the same organization"])(
    "does not expose cached or raw text owned by %s",
    async (boundary) => {
      const owner = await h.user("chat-document-owner");
      const other = await h.user("chat-document-other");
      const principal =
        boundary === "different organization" ? other.p : { ...other.p, orgId: owner.p.orgId };
      const bytes = new TextEncoder().encode("OTHER_USER_RAW180");
      const file = await h.uploadFile(principal, bytes, { mimeType: "text/plain" });
      await file.complete();
      await h.db
        .update(schema.files)
        .set({ textContent: "OTHER_USER_CACHED180" })
        .where(eq(schema.files.id, file.id));
      const conversation = await h.chat.create(owner.p, {});
      const sent = await h.chat.send(
        owner.facts,
        conversation.id,
        input([{ type: "text", text: "Read the attachment." }], "task"),
      );
      // A corrupted stored reference must not bypass runtime ownership checks.
      await h.db
        .update(schema.messages)
        .set({ parts: [attachment(file.id, "text/plain", bytes.byteLength)] })
        .where(eq(schema.messages.id, sent.message.id));
      await h.db.update(schema.runs).set({ mode: "chat" }).where(eq(schema.runs.id, sent.run.id));
      const read = vi.spyOn(h.blobs, "read");
      try {
        h.runner.start(sent.run.id, owner.facts);
        await h.runner.idle();
        const reply = await h.db.query.messages.findFirst({
          where: eq(schema.messages.id, sent.reply.id),
        });
        expect(textOf(reply!.parts)).toContain("its text is not available");
        expect(textOf(reply!.parts)).not.toContain("OTHER_USER_");
        expect(read).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
      }
    },
  );

  it.each([
    "deleted",
    "pending",
    "missing",
    "large metadata",
    "large bytes",
    "invalid UTF-8",
    "binary",
  ])("does not extract an unavailable or unsupported attachment: %s", async (state) => {
    const owner = await h.user("chat-document-unavailable");
    const mime = state === "binary" ? "application/pdf" : "text/plain";
    const bytes = new TextEncoder().encode(
      state === "binary" ? "%PDF-1.7\nfixture" : "UNAVAILABLE180",
    );
    const file = await h.uploadFile(owner.p, bytes, { mimeType: mime });
    await file.complete();
    const conversation = await h.chat.create(owner.p, {});
    const sent = await h.chat.send(
      owner.facts,
      conversation.id,
      input(
        [
          { type: "text", text: "Read the attachment." },
          attachment(file.id, mime, bytes.byteLength),
        ],
        "task",
      ),
    );
    if (state === "deleted")
      await h.db
        .update(schema.files)
        .set({ deletedAt: new Date() })
        .where(eq(schema.files.id, file.id));
    if (state === "pending")
      await h.db
        .update(schema.files)
        .set({ status: "pending" })
        .where(eq(schema.files.id, file.id));
    if (state === "large metadata")
      await h.db
        .update(schema.files)
        .set({ sizeBytes: 1024 * 1024 + 1 })
        .where(eq(schema.files.id, file.id));
    if (state === "missing") h.blobs.objects.delete(file.key);
    if (state === "large bytes")
      h.blobs.put(file.key, new Uint8Array(1024 * 1024 + 1).fill(65), mime);
    if (state === "invalid UTF-8") h.blobs.put(file.key, new Uint8Array([255, 255]), mime);
    await h.db.update(schema.runs).set({ mode: "chat" }).where(eq(schema.runs.id, sent.run.id));
    const read = vi.spyOn(h.blobs, "read");
    try {
      h.runner.start(sent.run.id, owner.facts);
      await h.runner.idle();
      const reply = await h.db.query.messages.findFirst({
        where: eq(schema.messages.id, sent.reply.id),
      });
      expect(textOf(reply!.parts)).toContain("its text is not available");
      expect(textOf(reply!.parts)).not.toContain("UNAVAILABLE180");
      if (["deleted", "pending", "large metadata", "binary"].includes(state))
        expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it("does not start a model after cancellation during attachment preparation", async () => {
    const owner = await h.user("chat-document-cancel");
    const bytes = new TextEncoder().encode("CANCELLED_DOCUMENT180");
    const file = await h.uploadFile(owner.p, bytes, { mimeType: "text/plain" });
    await file.complete();
    let release: (() => void) | undefined;
    const gate = new Promise<Uint8Array>((resolve) => {
      release = () => resolve(bytes);
    });
    let entered = false;
    const read = vi.spyOn(h.blobs, "read").mockImplementation(async () => {
      entered = true;
      return gate;
    });
    try {
      const conversation = await h.chat.create(owner.p, {});
      const sent = await h.chat.send(
        owner.facts,
        conversation.id,
        input([
          { type: "text", text: "Read the attachment." },
          attachment(file.id, "text/plain", bytes.byteLength),
        ]),
      );
      await vi.waitFor(() => expect(entered).toBe(true));
      await h.runs.cancel(owner.p, sent.run.id);
      release?.();
      await h.runner.idle();
      expect((await h.runs.get(owner.p, sent.run.id)).run.status).toBe("cancelled");
      const run = await h.db.query.runs.findFirst({ where: eq(schema.runs.id, sent.run.id) });
      expect(run!.steps).toBe(0);
      const requests = await h.db
        .select()
        .from(schema.usageRequests)
        .where(eq(schema.usageRequests.orgId, owner.p.orgId));
      expect(requests).toHaveLength(0);
    } finally {
      release?.();
      await h.runner.idle();
      read.mockRestore();
    }
  });
});
