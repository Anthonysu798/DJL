import { describe, expect, it } from "vitest";

import {
  GROUP_INPUT_REFUSAL,
  classifyRequest,
  createWriteLock,
  decideRequest,
} from "./groupPolicy";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("classifyRequest", () => {
  it("classifies look-ups per agent", () => {
    expect(
      classifyRequest("claudeAgent", "command_execution_approval", { tool: "WebSearch" }),
    ).toBe("lookup");
    expect(classifyRequest("claudeAgent", "command_execution_approval", { tool: "Grep" })).toBe(
      "lookup",
    );
    expect(classifyRequest("claudeAgent", "command_execution_approval", { tool: "Bash" })).toBe(
      "change",
    );
    expect(
      classifyRequest("qwen", "command_execution_approval", { toolCall: { kind: "fetch" } }),
    ).toBe("lookup");
    expect(
      classifyRequest("gemini", "command_execution_approval", { toolCall: { kind: "search" } }),
    ).toBe("lookup");
    expect(
      classifyRequest("qwen", "command_execution_approval", { toolCall: { kind: "execute" } }),
    ).toBe("change");
    expect(classifyRequest("codex", "file_read_approval", {})).toBe("lookup");
    expect(classifyRequest("codex", "file_change_approval", {})).toBe("change");
    expect(classifyRequest("pi", "tool_user_input", {})).toBe("input");
  });
});

describe("decideRequest", () => {
  it("answers a member's question with the refusal text instead of declining", async () => {
    const answer = await decideRequest({
      provider: "claudeAgent",
      memberId: "m1",
      proposeOnly: false,
      lock: createWriteLock(),
      type: "tool_user_input",
      args: { questions: [{ question: "Which file?", options: [{ label: "a.ts" }] }] },
    });
    expect(answer).toEqual({ "Which file?": GROUP_INPUT_REFUSAL });
  });

  it("propose-only allows look-ups and refuses changes", async () => {
    const lock = createWriteLock();
    const base = { provider: "claudeAgent" as const, memberId: "m1", proposeOnly: true, lock };
    expect(
      await decideRequest({
        ...base,
        type: "command_execution_approval",
        args: { tool: "WebFetch" },
      }),
    ).toBe("accept");
    expect(
      await decideRequest({ ...base, type: "file_change_approval", args: { tool: "Edit" } }),
    ).toBe("decline");
    expect(lock.holder()).toBeNull();
  });

  it("a second writer waits until the first releases", async () => {
    const lock = createWriteLock();
    const change = {
      type: "file_change_approval" as const,
      args: {},
      proposeOnly: false,
      lock,
    };
    expect(await decideRequest({ ...change, provider: "codex", memberId: "m1" })).toBe("accept");
    expect(await decideRequest({ ...change, provider: "codex", memberId: "m1" })).toBe("accept");
    let settled = false;
    const waiting: boolean[] = [];
    const second = decideRequest({
      ...change,
      provider: "claudeAgent",
      memberId: "m2",
      onWaiting: (value) => waiting.push(value),
    }).then((decision) => {
      settled = true;
      return decision;
    });
    await tick();
    expect(settled).toBe(false);
    expect(waiting).toEqual([true]);
    lock.release("m1");
    expect(await second).toBe("accept");
    expect(waiting).toEqual([true, false]);
    expect(lock.holder()).toBe("m2");
  });

  it("an aborted wait is declined and leaves no one queued", async () => {
    const lock = createWriteLock();
    await lock.acquire("m1");
    const controller = new AbortController();
    const waiting = decideRequest({
      provider: "codex",
      memberId: "m2",
      proposeOnly: false,
      lock,
      type: "file_change_approval",
      args: {},
      signal: controller.signal,
    });
    controller.abort();
    expect(await waiting).toBe("decline");
    lock.release("m1");
    expect(lock.holder()).toBeNull();
  });

  it("releasing a queued member removes it from the queue", async () => {
    const lock = createWriteLock();
    await lock.acquire("m1");
    const queued = lock.acquire("m2");
    lock.release("m2");
    expect(await queued).toBe(false);
    lock.release("m1");
    expect(lock.holder()).toBeNull();
  });

  it("a wait that times out is declined", async () => {
    const lock = createWriteLock({ waitMs: 20 });
    await lock.acquire("m1");
    expect(
      await decideRequest({
        provider: "codex",
        memberId: "m2",
        proposeOnly: false,
        lock,
        type: "file_change_approval",
        args: {},
      }),
    ).toBe("decline");
  });
});
