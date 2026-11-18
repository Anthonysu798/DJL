import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  GROUP_INPUT_REFUSAL,
  classifyRequest,
  createWriteLock,
  decideRequest,
} from "./groupPolicy";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

const sandbox = mkdtempSync(join(tmpdir(), "djl-group-policy-"));
const folder = join(sandbox, "group");
const outside = join(sandbox, "outside");
mkdirSync(folder);
mkdirSync(outside);
writeFileSync(join(outside, "id_rsa"), "secret");
symlinkSync(join(outside, "id_rsa"), join(folder, "link-to-key"));
const roots = [folder];
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

describe("reads outside the allowed folders", () => {
  it("accepts reads inside the group folder, relative or absolute", () => {
    expect(
      classifyRequest(
        "claudeAgent",
        "file_read_approval",
        { tool: "Read", input: { file_path: "a.ts" } },
        roots,
      ),
    ).toBe("lookup");
    expect(
      classifyRequest(
        "claudeAgent",
        "command_execution_approval",
        { tool: "Grep", input: { pattern: "x" } },
        roots,
      ),
    ).toBe("lookup");
    expect(
      classifyRequest(
        "qwen",
        "file_read_approval",
        { toolCall: { kind: "read", locations: [{ path: join(folder, "b.md") }] } },
        roots,
      ),
    ).toBe("lookup");
  });
  it("treats reads outside the folders, or through a symlink out, as changes", () => {
    expect(
      classifyRequest(
        "claudeAgent",
        "file_read_approval",
        { tool: "Read", input: { file_path: join(outside, "id_rsa") } },
        roots,
      ),
    ).toBe("change");
    expect(
      classifyRequest(
        "claudeAgent",
        "file_read_approval",
        { tool: "Read", input: { file_path: "../outside/id_rsa" } },
        roots,
      ),
    ).toBe("change");
    expect(
      classifyRequest(
        "claudeAgent",
        "file_read_approval",
        { tool: "Read", input: { file_path: join(folder, "link-to-key") } },
        roots,
      ),
    ).toBe("change");
    expect(
      classifyRequest(
        "gemini",
        "file_read_approval",
        { toolCall: { kind: "read", locations: [{ path: join(outside, "id_rsa") }] } },
        roots,
      ),
    ).toBe("change");
  });
  it("treats searches whose pattern or glob leaves the folder as changes", () => {
    const claude = (tool: string, input: Record<string, unknown>) =>
      classifyRequest("claudeAgent", "command_execution_approval", { tool, input }, roots);
    expect(claude("Glob", { pattern: "**/*.ts" })).toBe("lookup");
    expect(claude("Glob", { pattern: "/etc/**" })).toBe("change");
    expect(claude("Glob", { pattern: "~/.ssh/*" })).toBe("change");
    expect(claude("Glob", { pattern: "../outside/*" })).toBe("change");
    expect(claude("Grep", { pattern: "key", glob: "../outside/**" })).toBe("change");
    expect(claude("Grep", { pattern: "key", path: outside })).toBe("change");
  });
  it("treats an ACP search with no known location as a change", () => {
    const acp = (toolCall: Record<string, unknown>) =>
      classifyRequest("qwen", "command_execution_approval", { toolCall }, roots);
    expect(acp({ kind: "search" })).toBe("change");
    expect(acp({ kind: "search", locations: [{ path: folder }] })).toBe("lookup");
    expect(acp({ kind: "search", rawInput: { dir_path: outside } })).toBe("change");
    expect(acp({ kind: "search", rawInput: { path: folder } })).toBe("lookup");
  });
  it("treats a Read with no path as a change", () => {
    expect(classifyRequest("claudeAgent", "file_read_approval", { tool: "Read" }, roots)).toBe(
      "change",
    );
  });
  it("an @all round cannot read a file outside the folder", async () => {
    expect(
      await decideRequest({
        provider: "claudeAgent",
        memberId: "m1",
        proposeOnly: true,
        lock: createWriteLock(),
        roots,
        type: "file_read_approval",
        args: { tool: "Read", input: { file_path: join(outside, "id_rsa") } },
      }),
    ).toBe("decline");
  });
  it("does not count ACP think calls as look-ups", () => {
    expect(
      classifyRequest("qwen", "command_execution_approval", { toolCall: { kind: "think" } }, roots),
    ).toBe("change");
  });
});

describe("classifyRequest", () => {
  it("classifies look-ups per agent", () => {
    expect(
      classifyRequest("claudeAgent", "command_execution_approval", { tool: "WebSearch" }, roots),
    ).toBe("lookup");
    expect(
      classifyRequest("claudeAgent", "command_execution_approval", { tool: "Grep" }, roots),
    ).toBe("lookup");
    expect(
      classifyRequest("claudeAgent", "command_execution_approval", { tool: "Bash" }, roots),
    ).toBe("change");
    expect(
      classifyRequest("qwen", "command_execution_approval", { toolCall: { kind: "fetch" } }, roots),
    ).toBe("lookup");
    expect(
      classifyRequest(
        "gemini",
        "command_execution_approval",
        { toolCall: { kind: "search", locations: [{ path: folder }] } },
        roots,
      ),
    ).toBe("lookup");
    expect(
      classifyRequest(
        "qwen",
        "command_execution_approval",
        { toolCall: { kind: "execute" } },
        roots,
      ),
    ).toBe("change");
    // A read that names no path cannot be checked against the folder, so it is not a look-up.
    expect(classifyRequest("codex", "file_read_approval", {}, roots)).toBe("change");
    expect(
      classifyRequest("codex", "file_read_approval", { path: join(folder, "a.ts") }, roots),
    ).toBe("lookup");
    expect(classifyRequest("codex", "file_change_approval", {}, roots)).toBe("change");
    expect(classifyRequest("pi", "tool_user_input", {}, roots)).toBe("input");
  });
});

describe("decideRequest", () => {
  it("answers a member's question with the refusal text instead of declining", async () => {
    const answer = await decideRequest({
      provider: "claudeAgent",
      memberId: "m1",
      proposeOnly: false,
      lock: createWriteLock(),
      roots,
      type: "tool_user_input",
      args: { questions: [{ question: "Which file?", options: [{ label: "a.ts" }] }] },
    });
    expect(answer).toEqual({ "Which file?": GROUP_INPUT_REFUSAL });
  });

  it("propose-only allows look-ups and refuses changes", async () => {
    const lock = createWriteLock();
    const base = {
      provider: "claudeAgent" as const,
      memberId: "m1",
      proposeOnly: true,
      lock,
      roots,
    };
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
      roots,
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
      roots,
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
        roots,
        type: "file_change_approval",
        args: {},
      }),
    ).toBe("decline");
  });
});
