import type {
  CloudMessagePart,
  CloudRunEvent,
  CloudSendMessageInput,
} from "@synara/contracts/cloud";
import { describe, expect, it } from "vitest";

import { createChatClient } from "./client";
import { createMockApi } from "./mock/server";
import { applyEventToParts, followRun } from "./runs";

const BASE = "https://api.test";

async function startRun(mode: "chat" | "task" = "chat") {
  const mock = createMockApi({ baseUrl: BASE, tickMs: 2 });
  const client = createChatClient({ baseUrl: BASE, fetch: mock.fetch });
  const conv = await client.createConversation({});
  const sent = await client.sendMessage(conv.id, {
    clientMessageId: "x",
    parentId: null,
    parts: [{ type: "text", text: "Tell me about tides" }],
    model: "gpt-5",
    mode,
  } as CloudSendMessageInput);
  return { mock, client, sent };
}

function collect() {
  const events: CloudRunEvent[] = [];
  let parts: readonly CloudMessagePart[] = [];
  return {
    events,
    get parts() {
      return parts;
    },
    onEvent: (e: CloudRunEvent) => {
      events.push(e);
      parts = applyEventToParts(parts, e);
    },
  };
}

describe("followRun", () => {
  it("reconnects after drops and continues from the last seq without duplicates", async () => {
    const { mock, client, sent } = await startRun();
    const c = collect();
    mock.faults.dropStreamAfter = 3;
    let opened = 0;
    const counting = {
      getRun: client.getRun,
      streamRunEvents: (runId: string, after: number, signal: AbortSignal) => {
        opened++;
        if (opened === 2) mock.faults.dropStreamAfter = 4;
        return client.streamRunEvents(runId, after, signal);
      },
    };

    const result = await followRun({
      client: counting,
      runId: sent.run.id,
      after: 0,
      onEvent: c.onEvent,
      signal: new AbortController().signal,
      backoff: () => 0,
    });

    expect(opened).toBeGreaterThanOrEqual(3);
    expect(result.status).toBe("succeeded");
    const seqs = c.events.map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1)); // gapless, no repeats
    const afters = mock.requests
      .filter((r) => r.path.includes("/events"))
      .map((r) => Number(new URL(r.path, BASE).searchParams.get("after")));
    expect(afters.slice(0, 3)).toEqual([0, 3, 7]);

    const { messages } = await client.getConversation(sent.run.conversationId);
    const reply = messages.find((m) => m.id === sent.reply.id)!;
    expect(c.parts).toEqual(reply.parts);
  });

  it("skips events at or below the resume point even if the server resends them", async () => {
    const { client, sent } = await startRun();
    const c = collect();
    const replaying = {
      getRun: client.getRun,
      // A misbehaving server that ignores `after` and replays everything.
      streamRunEvents: (runId: string, _after: number, signal: AbortSignal) =>
        client.streamRunEvents(runId, 0, signal),
    };
    const result = await followRun({
      client: replaying,
      runId: sent.run.id,
      after: 2,
      onEvent: c.onEvent,
      signal: new AbortController().signal,
    });
    expect(c.events[0]?.seq).toBe(3);
    expect(c.events.at(-1)?.seq).toBe(result.lastSeq);
  });

  it("stops when aborted and when the run is cancelled", async () => {
    const { client, sent } = await startRun("task");
    const c = collect();
    const controller = new AbortController();
    const following = followRun({
      client,
      runId: sent.run.id,
      after: 0,
      onEvent: (e) => {
        c.onEvent(e);
        if (e.type === "step.started") void client.cancelRun(sent.run.id);
      },
      signal: controller.signal,
    });
    const result = await following;
    expect(result.status).toBe("cancelled");
  });

  it("finishes when it resumes after the run already ended", async () => {
    const { client, sent } = await startRun();
    const first = await followRun({
      client,
      runId: sent.run.id,
      after: 0,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    const again = await followRun({
      client,
      runId: sent.run.id,
      after: first.lastSeq,
      onEvent: () => {
        throw new Error("no new events expected");
      },
      signal: new AbortController().signal,
    });
    expect(again).toEqual({ lastSeq: first.lastSeq, status: "succeeded" });
  });
});
