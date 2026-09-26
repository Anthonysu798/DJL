import type { CloudSendMessageInput } from "@synara/contracts/cloud";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "./attachments";
import { ChatApiError, createChatClient, sendMessageIdempotent } from "./client";
import { createMockApi } from "./mock/server";

const BASE = "https://api.test";
const setup = (scenario: "default" | "exhausted" = "default") => {
  const mock = createMockApi({ baseUrl: BASE, tickMs: 1, scenario });
  return { mock, client: createChatClient({ baseUrl: BASE, fetch: mock.fetch }) };
};

const input = (clientMessageId: string): CloudSendMessageInput =>
  ({
    clientMessageId,
    parentId: null,
    parts: [{ type: "text", text: "Hello" }],
    model: "gpt-5",
    mode: "chat",
  }) as CloudSendMessageInput;

describe("chat client", () => {
  it("retries a send after a network failure with the same clientMessageId, creating one message", async () => {
    const { mock, client } = setup();
    const conv = await client.createConversation({});
    mock.faults.failNext.push({ method: "POST", path: /\/messages$/, status: "network" });
    mock.faults.failNext.push({ method: "POST", path: /\/messages$/, status: 503 });

    const res = await sendMessageIdempotent(client, conv.id, input("cm-1"), { delay: () => 0 });

    const sends = mock.requests.filter((r) => r.method === "POST" && r.path.endsWith("/messages"));
    expect(sends).toHaveLength(3);
    expect(
      new Set(sends.map((r) => (r.body as { clientMessageId: string }).clientMessageId)),
    ).toEqual(new Set(["cm-1"]));
    const detail = await client.getConversation(conv.id);
    expect(detail.messages.filter((x) => x.role === "user")).toHaveLength(1);
    expect(detail.messages.find((x) => x.role === "user")?.id).toBe(res.message.id);
  });

  it("returns the original message and run when a send is repeated", async () => {
    const { client } = setup();
    const conv = await client.createConversation({});
    const first = await client.sendMessage(conv.id, input("cm-2"));
    const again = await client.sendMessage(conv.id, input("cm-2"));
    expect(again.run.id).toBe(first.run.id);
    expect(again.message.id).toBe(first.message.id);
  });

  it("does not retry a client error", async () => {
    const { mock, client } = setup();
    const conv = await client.createConversation({});
    mock.faults.failNext.push({
      method: "POST",
      path: /\/messages$/,
      status: 400,
      code: "bad_request",
    });
    await expect(
      sendMessageIdempotent(client, conv.id, input("cm-3"), { delay: () => 0 }),
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });
  });

  it("surfaces usage_window_exhausted with its reset time", async () => {
    const { client } = setup("exhausted");
    const conv = await client.createConversation({});
    const error = await client.sendMessage(conv.id, input("cm-4")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatApiError);
    expect(error).toMatchObject({ status: 429, code: "usage_window_exhausted" });
    expect((error as ChatApiError).resetsAt).toMatch(/^\d{4}-/);
  });

  it("is rejected by the mock when the body breaks the contract", async () => {
    const { client } = setup();
    const conv = await client.createConversation({});
    await expect(
      client.sendMessage(conv.id, { ...input("cm-5"), parts: [] } as CloudSendMessageInput),
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  it("uploads through POST /v1/files, PUT, complete, and reads it back through /url", async () => {
    const { mock, client } = setup();
    const blob = new Blob(["hello"], { type: "text/plain" });
    const presign = await client.presignFile({
      name: "a.txt",
      mimeType: "text/plain",
      size: 5,
      sha256: await sha256Hex(blob),
      purpose: "attachment",
    });
    await client.putToStorage(presign, blob);
    const file = await client.completeFile(presign.file.id);
    expect(file.status).toBe("ready");
    expect((await client.fileUrl(file.id)).url).toBeTruthy();
    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        "POST /v1/files",
        `POST /v1/files/${file.id}/complete`,
        `GET /v1/files/${file.id}/url`,
      ]),
    );
  });

  it("rejects an upload whose bytes don't match the declared hash", async () => {
    const { client } = setup();
    const blob = new Blob(["hello"], { type: "text/plain" });
    const presign = await client.presignFile({
      name: "a.txt",
      mimeType: "text/plain",
      size: 5,
      sha256: "0".repeat(64),
      purpose: "attachment",
    });
    await client.putToStorage(presign, blob);
    await expect(client.completeFile(presign.file.id)).rejects.toMatchObject({
      code: "upload_mismatch",
    });
  });

  it("sends the CSRF token on every mutation and fetches a fresh one once when it rotates", async () => {
    const { mock, client } = setup();
    await client.createConversation({});
    expect(mock.requests.filter((r) => r.path === "/v1/csrf")).toHaveLength(1);
    const post = mock.requests.find((r) => r.method === "POST");
    expect(post?.csrf).toBe(mock.csrf.token);

    mock.csrf.token = "rotated-token-value-rotated-token-value-rot";
    await client.createConversation({});
    expect(mock.requests.filter((r) => r.path === "/v1/csrf")).toHaveLength(2);
    expect(mock.requests.at(-1)?.csrf).toBe(mock.csrf.token);
    await client.listConversations();
    expect(mock.requests.at(-1)?.csrf).toBeNull();
  });

  it("shares a conversation at POST /v1/conversations/{id}/shares and shows its images publicly", async () => {
    const { mock, client } = setup();
    const detail = await client.getConversation("conv_1");
    const created = await client.createShare("conv_1", {});
    expect(mock.requests.some((r) => r.path === "/v1/conversations/conv_1/shares")).toBe(true);
    const token = created.url.split("/share/")[1]!;
    const view = await client.getPublicShare(token);
    const images = detail.messages.flatMap((m) =>
      m.parts.flatMap((p) => (p.type === "image_ref" ? [p.fileId] : [])),
    );
    expect(images.length).toBeGreaterThan(0);
    for (const id of images) expect(view.imageUrls[id]).toBeTruthy();
    const { share } = await client.revokeShare(created.share.id);
    expect(share.revokedAt).not.toBeNull();
    await expect(client.getPublicShare(token)).rejects.toMatchObject({ status: 404 });
  });
});
