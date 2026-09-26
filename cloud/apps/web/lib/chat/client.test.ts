import type { CloudSendMessageInput } from "@synara/contracts/cloud";
import { describe, expect, it } from "vitest";

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

  it("uploads through presign, PUT, and complete", async () => {
    const { client } = setup();
    const blob = new Blob(["hello"], { type: "text/plain" });
    const presign = await client.presignFile({ name: "a.txt", mimeType: "text/plain", size: 5 });
    await client.putToStorage(presign, blob);
    const file = await client.completeFile(presign.file.id);
    expect(file.status).toBe("ready");
    expect((await client.fileUrl(file.id)).url).toBeTruthy();
  });
});
