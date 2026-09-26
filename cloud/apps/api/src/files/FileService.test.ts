import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import type { CloudSendMessageInput } from "@synara/contracts/cloud";
import { afterAll, describe, expect, it } from "vitest";

import { ApiError } from "../http/errors.ts";
import { chatHarness } from "../testing/chat.ts";

const h = chatHarness();
afterAll(() => h.close());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode("%PDF-1.7 fake body");

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

async function status(id: string) {
  return (await h.db.query.files.findFirst({ where: eq(schema.files.id, id) }))!.status;
}

describe("files", () => {
  it("uploads an image: presigned PUT pinned to type and size, verified on complete, 5-minute download", async () => {
    const { p } = await h.user("file-ok");
    const upload = await h.uploadFile(p, PNG, { mimeType: "image/png", purpose: "image" });
    expect(upload.key).toBe(`org/${p.orgId}/files/${upload.id}`);
    expect(upload.created.upload.method).toBe("PUT");
    expect(upload.created.upload.headers).toEqual({
      "content-type": "image/png",
      "content-length": String(PNG.byteLength),
    });
    expect(upload.created.file.status).toBe("pending");
    const file = await upload.complete();
    expect(file.status).toBe("ready");
    // Completing twice is harmless.
    expect((await upload.complete()).status).toBe("ready");

    const before = Date.now();
    const { url, expiresAt } = await h.files.downloadUrl(p, upload.id);
    expect(url).toContain(encodeURIComponent(upload.key));
    const lifetime = Date.parse(expiresAt) - before;
    expect(lifetime).toBeGreaterThan(290_000);
    expect(lifetime).toBeLessThanOrEqual(301_000);
  });

  it.each([
    ["size", { mimeType: "image/png", declared: { size: PNG.byteLength + 1 } }, PNG],
    ["hash", { mimeType: "image/png", declared: { sha256: "0".repeat(64) } }, PNG],
    ["type", { mimeType: "image/png" }, PDF],
  ] as const)(
    "rejects an upload whose %s does not match and deletes the object",
    async (what, options, bytes) => {
      const { p } = await h.user(`file-${what}`);
      const upload = await h.uploadFile(p, bytes, options);
      const error = await failure(upload.complete());
      expect(error.status).toBe(400);
      expect(error.code).toBe("upload_mismatch");
      expect(error.message).toContain(what);
      expect(await status(upload.id)).toBe("rejected");
      expect(h.blobs.objects.has(upload.key)).toBe(false);
      expect((await failure(h.files.downloadUrl(p, upload.id))).status).toBe(404);
      expect((await failure(upload.complete())).code).toBe("upload_rejected");
    },
  );

  it("refuses unsupported types, non-image images, and files over the plan limit", async () => {
    const { p } = await h.user("file-limits");
    const declare = (mimeType: string, purpose: "attachment" | "image", size = 10) =>
      h.files.create(p, {
        name: "f",
        mimeType,
        size,
        sha256: "0".repeat(64),
        purpose,
      } as never);
    expect((await failure(declare("application/x-msdownload", "attachment"))).code).toBe(
      "unsupported_type",
    );
    expect((await failure(declare("application/pdf", "image"))).code).toBe("unsupported_type");
    await h.db
      .insert(schema.settings)
      .values({ key: "files.max_upload_bytes", value: { default: 1000 } })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: { default: 1000 } } });
    try {
      expect((await failure(declare("application/pdf", "attachment", 1001))).status).toBe(413);
      await declare("application/pdf", "attachment", 1000);
    } finally {
      await h.db.delete(schema.settings).where(eq(schema.settings.key, "files.max_upload_bytes"));
    }
  });

  it("will not complete before the bytes are uploaded", async () => {
    const { p } = await h.user("file-missing");
    const created = await h.files.create(p, {
      name: "f.pdf",
      mimeType: "application/pdf",
      size: 10,
      sha256: "0".repeat(64),
      purpose: "attachment",
    } as never);
    expect((await failure(h.files.complete(p, created.file.id))).code).toBe("upload_missing");
    expect(await status(created.file.id)).toBe("pending");
  });

  it("another user or org cannot complete, download, or send someone else's file", async () => {
    const owner = await h.user("file-idor");
    const intruder = await h.user("file-idor-x");
    const upload = await h.uploadFile(owner.p, PNG, { mimeType: "image/png", purpose: "image" });
    await upload.complete();
    for (const p of [intruder.p, { ...owner.p, orgId: intruder.p.orgId }]) {
      expect((await failure(h.files.complete(p, upload.id))).status).toBe(404);
      expect((await failure(h.files.downloadUrl(p, upload.id))).status).toBe(404);
    }
    const c = await h.chat.create(intruder.p, {});
    const send = h.chat.send(intruder.facts, c.id, {
      clientMessageId: "steal",
      parentId: null,
      parts: [
        { type: "image_ref", fileId: upload.id, mimeType: "image/png", width: null, height: null },
      ],
      model: "gpt-5-mini",
      mode: "chat",
    } as unknown as CloudSendMessageInput);
    expect((await failure(send)).code).toBe("file_unavailable");
  });

  it("sends a ready image with a message; a pending file is refused", async () => {
    const { p, facts } = await h.user("file-send");
    const image = await h.uploadFile(p, PNG, { mimeType: "image/png", purpose: "image" });
    const pending = await h.uploadFile(p, PDF, { mimeType: "application/pdf" });
    await image.complete();
    const c = await h.chat.create(p, {});
    const message = (fileId: string, id: string) =>
      ({
        clientMessageId: id,
        parentId: null,
        parts: [
          { type: "text", text: "what is this" },
          { type: "image_ref", fileId, mimeType: "image/png", width: null, height: null },
        ],
        model: "gpt-5-mini",
        mode: "chat",
      }) as unknown as CloudSendMessageInput;
    expect((await failure(h.chat.send(facts, c.id, message(pending.id, "a")))).code).toBe(
      "file_unavailable",
    );
    const sent = await h.chat.send(facts, c.id, message(image.id, "b"));
    await h.runner.idle();
    expect((await h.runs.get(p, sent.run.id)).run.status).toBe("succeeded");
  });
});
