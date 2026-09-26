import type { CloudUserMessagePart } from "@synara/contracts/cloud";
import { describe, expect, it, vi } from "vitest";

import { createChatClient } from "./client";
import { createMockApi, type MockScenario } from "./mock/server";
import { readRunSnapshot } from "./runs";
import { ChatStore, newClientId } from "./store";
import { buildTree, visibleBranch } from "./tree";

const BASE = "https://api.test";
const text = (t: string) => [{ type: "text", text: t }] as CloudUserMessagePart[];

function setup(scenario: MockScenario = "default", tickMs = 1) {
  const mock = createMockApi({ baseUrl: BASE, tickMs, scenario });
  const client = createChatClient({ baseUrl: BASE, fetch: mock.fetch });
  return { mock, client, store: new ChatStore(client) };
}

const branchOf = (store: ChatStore, id: string) => {
  const view = store.getState().views[id]!;
  return visibleBranch(buildTree(view.messages), view.selection);
};
const allDone = (store: ChatStore) =>
  Object.values(store.getState().runs).every((r) =>
    ["succeeded", "failed", "cancelled"].includes(r.status),
  );

describe("ChatStore", () => {
  it("sends, streams, edits into a new branch, regenerates, and switches branches", async () => {
    const { store } = setup();
    await store.init();
    const id = await store.send({
      conversationId: null,
      parentId: null,
      parts: text("First question"),
      model: "gpt-5",
      mode: "chat",
      clientMessageId: newClientId(),
    });
    await vi.waitFor(() => expect(allDone(store)).toBe(true));
    const [user, reply] = branchOf(store, id);
    expect(user?.parts).toEqual(text("First question"));
    expect(reply?.parts[0]?.type).toBe("text");
    expect(store.getState().conversations[0]?.id).toBe(id);

    // Edit: a sibling of the first user message.
    await store.send({
      conversationId: id,
      parentId: user!.parentId,
      parts: text("Edited question"),
      model: "gpt-5",
      mode: "chat",
      clientMessageId: newClientId(),
    });
    await vi.waitFor(() => expect(allDone(store)).toBe(true));
    const edited = branchOf(store, id);
    expect(edited[0]?.parts).toEqual(text("Edited question"));

    // Regenerate the reply on the edited branch.
    await store.regenerate(id, edited[1]!.id);
    await vi.waitFor(() => expect(allDone(store)).toBe(true));
    const regenerated = branchOf(store, id);
    expect(regenerated[1]!.id).not.toBe(edited[1]!.id);
    expect(regenerated[1]!.parentId).toBe(edited[0]!.id);

    // Switch back to the original question.
    store.selectMessage(id, user!);
    expect(branchOf(store, id).map((m) => m.id)).toEqual([user!.id, reply!.id]);
  });

  it("resumes an unfinished run after a reload from the saved seq, without duplicating text", async () => {
    const { client, mock, store } = setup("default", 15);
    await store.init();
    const id = await store.send({
      conversationId: null,
      parentId: null,
      parts: text("Long answer please"),
      model: "gpt-5",
      mode: "chat",
      clientMessageId: newClientId(),
    });
    const runId = Object.keys(store.getState().runs)[0]!;
    await vi.waitFor(() => expect(readRunSnapshot(runId)?.lastSeq ?? 0).toBeGreaterThan(3));
    store.dispose(); // the tab goes away mid-stream

    const saved = readRunSnapshot(runId)!;
    const reloaded = new ChatStore(client);
    await reloaded.openConversation(id);
    await vi.waitFor(() => expect(allDone(reloaded)).toBe(true), { timeout: 10_000 });

    const eventRequests = mock.requests.filter((r) => r.path.includes(`/runs/${runId}/events`));
    expect(eventRequests.at(-1)?.path).toContain(`after=${saved.lastSeq}`);
    const [, reply] = branchOf(reloaded, id);
    const { messages } = await client.getConversation(id);
    expect(reply?.parts).toEqual(messages.find((m) => m.id === reply?.id)?.parts);
  });

  it("blocks on an exhausted window and clears the block after redeeming a bank once", async () => {
    const { mock, store } = setup("exhausted");
    await store.init();
    const send = () =>
      store.send({
        conversationId: null,
        parentId: null,
        parts: text("hi"),
        model: "gpt-5",
        mode: "chat",
        clientMessageId: "same",
      });
    await expect(send()).rejects.toMatchObject({ code: "usage_window_exhausted" });
    expect(store.getState().usageBlock?.resetsAt).toMatch(/^\d{4}-/);
    const banksBefore = store.getState().usage!.banks.count;

    mock.faults.failNext.push({ method: "POST", path: /redeem$/, status: 503 });
    await expect(store.redeemBank()).rejects.toMatchObject({ status: 503 });
    await store.redeemBank();

    const redeems = mock.requests.filter((r) => r.path === "/v1/usage/resets/redeem");
    expect(new Set(redeems.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(store.getState().usageBlock).toBeNull();
    expect(store.getState().usage!.banks.count).toBe(banksBefore - 1);
    await expect(send()).resolves.toBeTruthy();
  });

  it("still opens a conversation whose run can no longer be looked up", async () => {
    const { store } = setup();
    await store.openConversation("conv_1"); // the fixture's run_1 isn't in the mock
    expect(store.getState().views.conv_1?.status).toBe("ready");
    expect(branchOf(store, "conv_1")).toHaveLength(2);
  });

  it("renames, pins, archives, restores, and deletes conversations", async () => {
    const { store } = setup();
    await store.init();
    const first = store.getState().conversations[0]!;
    await store.rename(first.id, "Renamed");
    await store.setPinned(first.id, true);
    expect(store.getState().conversations.find((c) => c.id === first.id)).toMatchObject({
      title: "Renamed",
      pinned: true,
    });
    await store.loadArchived();
    await store.setArchived(first.id, true);
    expect(store.getState().conversations.some((c) => c.id === first.id)).toBe(false);
    expect(store.getState().archived?.some((c) => c.id === first.id)).toBe(true);
    await store.setArchived(first.id, false);
    expect(store.getState().conversations.some((c) => c.id === first.id)).toBe(true);
    await store.remove(first.id);
    expect(store.getState().conversations.some((c) => c.id === first.id)).toBe(false);
  });
});
