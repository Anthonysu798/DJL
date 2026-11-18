import {
  GroupId,
  GroupMemberId,
  ProjectId,
  ThreadId,
  type Group,
  type GroupHandoff,
  type GroupMember,
  type GroupMemberState,
  type GroupReply,
} from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import type { ChildReply, ChildSession } from "./childSession";
import { startRound, type GroupRuntime, type RoundHost } from "./groupRound";

type Step =
  | { kind: "reply"; text: string }
  | { kind: "fail"; error: string }
  | { kind: "hang"; gate?: Gate };
interface Gate {
  release(text: string): void;
  wait: Promise<string>;
}

const gateOf = (): Gate => {
  const { promise: wait, resolve: release } = Promise.withResolvers<string>();
  return { release, wait };
};

const groupId = GroupId.makeUnsafe("g1");
const member = (handle: string, position: number): GroupMember => ({
  id: GroupMemberId.makeUnsafe(`id-${handle}`),
  groupId,
  provider: handle === "Codex" ? "codex" : handle === "Gemini" ? "gemini" : "claudeAgent",
  handle,
  role: null,
  model: null,
  position,
});

let group: Group;
let scripts: Map<string, Array<Step | ((prompt: string) => Step)>>;
let askedHandles: string[];
let prompts: Map<string, string[]>;
let flags: Map<string, boolean[]>;
let states: Map<string, GroupMemberState>;
let runtime: GroupRuntime & {
  log: { seq: number; author: string; text: string }[];
  pause: GroupHandoff[];
  replies: GroupReply[];
  requestResume(): void;
};
let host: RoundHost;

const handleOf = (memberId: string) =>
  group.members.find((entry) => entry.id === memberId)?.handle ?? memberId;
const idOf = (handle: string) => group.members.find((entry) => entry.handle === handle)!.id;

function fakeChild(handle: string): ChildSession {
  let stopHang: (() => void) | null = null;
  let stopRequested = false;
  return {
    nativeSessionId: `native-${handle}`,
    async ask(prompt, onRequest): Promise<ChildReply> {
      askedHandles.push(handle);
      prompts.get(handle)!.push(prompt);
      const queue = scripts.get(handle) ?? [];
      const entry = queue.length > 1 ? queue.shift()! : (queue[0] ?? { kind: "reply", text: "ok" });
      const step = typeof entry === "function" ? entry(prompt) : entry;
      const work = { files: [], commands: [] };
      if (step.kind === "fail") return { status: "failed", error: step.error, work };
      const decision = await onRequest("file_change_approval", { tool: "Edit" });
      flags.get(handle)!.push(decision === "decline");
      if (step.kind === "reply")
        return step.text ? { status: "ok", text: step.text, work } : { status: "empty", work };
      if (stopRequested) {
        stopRequested = false;
        return { status: "stopped", work };
      }
      const stopped = new Promise<ChildReply>((resolve) => {
        stopHang = () => resolve({ status: "stopped", work });
      });
      const released = step.gate
        ? step.gate.wait.then((text): ChildReply => ({ status: "ok", text, work }))
        : new Promise<ChildReply>(() => {});
      return Promise.race([stopped, released]);
    },
    async stop() {
      if (stopHang) stopHang();
      else stopRequested = true;
    },
    close() {},
  };
}

beforeEach(() => {
  group = {
    id: groupId,
    threadId: ThreadId.makeUnsafe("thread-g1"),
    projectId: ProjectId.makeUnsafe("project-g1"),
    name: "Launch",
    folder: "/tmp/g1",
    folderIsAuto: true,
    hopLimit: 6,
    skipAllWarning: false,
    pendingHandoffs: [],
    members: [member("Claude", 0), member("Codex", 1), member("Gemini", 2)],
    createdAt: 1,
    updatedAt: 1,
  };
  scripts = new Map();
  askedHandles = [];
  prompts = new Map(group.members.map((entry) => [entry.handle, []]));
  flags = new Map(group.members.map((entry) => [entry.handle, []]));
  states = new Map();
  const memberRuntime = new Map<string, { nativeSessionId: string | null; readSeq: number }>();
  let roundState = { lastSpeakers: [] as GroupMemberId[], lastRoundAll: false };
  let resumeRequested = false;
  const state = {
    log: [] as { seq: number; author: string; text: string }[],
    pause: [] as GroupHandoff[],
    replies: [] as GroupReply[],
    requestResume: () => {
      resumeRequested = true;
    },
    loadGroup: async () => group,
    appendLog: async (_groupId: string, author: string, text: string) => {
      const seq = state.log.length + 1;
      state.log.push({ seq, author, text });
      return seq;
    },
    logAfter: async (_groupId: string, seq: number) => state.log.filter((entry) => entry.seq > seq),
    memberRuntime: async (memberId: string) =>
      memberRuntime.get(memberId) ?? { nativeSessionId: null, readSeq: 0 },
    saveMemberRuntime: async (
      memberId: string,
      patch: { nativeSessionId?: string | null; readSeq?: number },
    ) => {
      const current = memberRuntime.get(memberId) ?? { nativeSessionId: null, readSeq: 0 };
      memberRuntime.set(memberId, {
        nativeSessionId:
          patch.nativeSessionId === undefined ? current.nativeSessionId : patch.nativeSessionId,
        readSeq: patch.readSeq ?? current.readSeq,
      });
    },
    roundState: async () => roundState,
    saveRoundState: async (_groupId: string, next: typeof roundState) => {
      roundState = { lastSpeakers: [...next.lastSpeakers], lastRoundAll: next.lastRoundAll };
    },
    takeResume: async () => {
      const pending = resumeRequested ? state.pause : [];
      state.pause = [];
      resumeRequested = false;
      return pending;
    },
    savePause: async (_groupId: string, handoffs: GroupHandoff[]) => {
      state.pause = [...handoffs];
    },
    recordReply: async (reply: GroupReply) => {
      state.replies.push(reply);
    },
    setMemberState: (_groupId: string, memberId: string, value: GroupMemberState) => {
      states.set(handleOf(memberId), value);
    },
    skills: async () => [],
  };
  runtime = state as typeof runtime;
  const children = new Map<string, ChildSession>();
  let ids = 0;
  host = {
    runtime,
    openChild: async (entry) => {
      const existing = children.get(entry.id);
      if (existing) return existing;
      const child = fakeChild(entry.handle);
      children.set(entry.id, child);
      return child;
    },
    dropChild: (memberId) => {
      children.delete(memberId);
    },
    emitReply: () => {},
    newId: () => `r${++ids}`,
  };
});

const round = (text: string) => startRound(host, group, text);
const script = (handle: string, texts: string[]) =>
  scripts.set(
    handle,
    texts.map((text) => ({ kind: "reply", text })),
  );
const fail = (handle: string, error: string) => scripts.set(handle, [{ kind: "fail", error }]);
const hang = (handle: string) => scripts.set(handle, [{ kind: "hang" }]);
const hangUntilReleased = (handle: string) => {
  const gate = gateOf();
  scripts.set(handle, [
    { kind: "hang", gate },
    { kind: "reply", text: "ok" },
  ]);
  return gate;
};
const pingPong = (a: string, b: string) => {
  scripts.set(a, [() => ({ kind: "reply", text: `@${b} your turn` })]);
  scripts.set(b, [() => ({ kind: "reply", text: `@${a} your turn` })]);
};
const until = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(predicate()).toBe(true);
};
const lastPromptFor = (handle: string) => prompts.get(handle)!.at(-1) ?? "";

describe("group rounds", () => {
  it("@Name wakes one member; a no-@ follow-up goes to the last speaker", async () => {
    await round("@Claude are you there?").done;
    expect(askedHandles).toEqual(["Claude"]);
    await round("and now?").done;
    expect(askedHandles).toEqual(["Claude", "Claude"]);
  });

  it("the first message with no @ wakes everyone, propose-only", async () => {
    await round("hello").done;
    expect(new Set(askedHandles)).toEqual(new Set(["Claude", "Codex", "Gemini"]));
    expect([...flags.values()].flat()).toEqual([true, true, true]);
  });

  it("a follow-up to @all stays propose-only; naming two is not", async () => {
    await round("@all ideas?").done;
    await round("shorter").done;
    expect([...flags.values()].map((list) => list.slice(0, 2))).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
    await round("@Claude @Codex fix it").done;
    expect(flags.get("Claude")!.at(-1)).toBe(false);
    expect(flags.get("Codex")!.at(-1)).toBe(false);
  });

  it("a localized @all wakes everyone", async () => {
    await round("@所有人 仅回复收到").done;
    expect(new Set(askedHandles)).toEqual(new Set(["Claude", "Codex", "Gemini"]));
  });

  it("an agent's mention wakes that member and counts a hop", async () => {
    script("Claude", ["@Codex please review"]);
    script("Codex", ["Looks good."]);
    await round("@Claude write it").done;
    expect(askedHandles).toEqual(["Claude", "Codex"]);
    expect(lastPromptFor("Codex")).toContain("@Codex please review");
    expect(runtime.pause).toEqual([]);
  });

  it("pauses after 6 hops and resumes on continue", async () => {
    pingPong("Claude", "Codex");
    await round("@Claude start").done;
    expect(askedHandles).toHaveLength(7);
    expect(runtime.pause).toHaveLength(1);
    runtime.requestResume();
    await round("Continue").done;
    expect(askedHandles).toHaveLength(14);
  });

  it("an agent's own @all and self-mention wake nobody", async () => {
    script("Claude", ["@all and @Claude listen"]);
    await round("@Claude go").done;
    expect(askedHandles).toEqual(["Claude"]);
  });

  it("a new user message while paused drops the pending hand-offs", async () => {
    pingPong("Claude", "Codex");
    await round("@Claude start").done;
    scripts.set("Gemini", [{ kind: "reply", text: "sure" }]);
    await round("@Gemini something else").done;
    expect(askedHandles.at(-1)).toBe("Gemini");
    expect(runtime.pause).toEqual([]);
  });

  it("hands a failed sole task to the next member once", async () => {
    fail("Claude", "Usage limit reached");
    script("Codex", ["Done instead."]);
    await round("@Claude do it").done;
    expect(askedHandles).toEqual(["Claude", "Codex"]);
    expect(runtime.replies.map((reply) => reply.status)).toEqual(["failed", "ok"]);
    expect(runtime.replies[0]?.error).toBe("Usage limit reached");
  });

  it("does not hand over inside an @all round", async () => {
    fail("Claude", "boom");
    await round("@all go").done;
    expect(askedHandles.filter((name) => name === "Codex")).toHaveLength(1);
  });

  it("each member only receives what it has not seen", async () => {
    script("Claude", ["claude reply"]);
    await round("@Claude one").done;
    await round("@Codex two").done;
    expect(lastPromptFor("Codex")).toContain("one");
    expect(lastPromptFor("Codex")).toContain("claude reply");
    await round("@Codex three").done;
    expect(lastPromptFor("Codex")).not.toContain("since you last spoke");
  });

  it("briefs a member on its first wake only", async () => {
    await round("@Claude one").done;
    await round("@Claude two").done;
    expect(prompts.get("Claude")![0]).toContain("Launch");
    expect(prompts.get("Claude")![1]).not.toContain("Launch");
  });

  it("removing a member mid-round stops it and lets the others finish", async () => {
    hang("Claude");
    script("Codex", ["ok"]);
    const running = round("@Claude @Codex go");
    await until(() => askedHandles.includes("Claude") && askedHandles.includes("Codex"));
    await running.removeMember(idOf("Claude"));
    await running.done;
    expect(runtime.replies.map((reply) => reply.status)).toEqual(["ok"]);
  });

  it("a second message for a busy member waits for that member only", async () => {
    const gate = hangUntilReleased("Claude");
    script("Codex", ["ok"]);
    const running = round("@Claude long task");
    await until(() => askedHandles.includes("Claude"));
    running.post("@Codex quick question");
    await until(() => askedHandles.includes("Codex"));
    expect(states.get("Claude")).toBe("working");
    gate.release("done");
    await running.done;
    expect(runtime.replies).toHaveLength(2);
  });

  it("a named message posted during an @all round is not propose-only", async () => {
    const gate = hangUntilReleased("Codex");
    const running = round("@all ideas?");
    await until(() => askedHandles.filter((name) => name === "Claude").length === 1);
    running.post("@Claude do it");
    gate.release("idea");
    await running.done;
    expect(flags.get("Claude")).toEqual([true, false]);
  });

  it("a hand-off inside an @all round stays propose-only", async () => {
    scripts.set("Claude", [
      { kind: "reply", text: "@Codex what do you think?" },
      { kind: "reply", text: "ok" },
    ]);
    await round("@all ideas?").done;
    expect(flags.get("Codex")).toEqual([true, true]);
  });

  it("stop all ends every member and completes the round", async () => {
    hang("Claude");
    hang("Codex");
    const running = round("@Claude @Codex go");
    await until(() => askedHandles.length === 2);
    await running.stopAll();
    await running.done;
    expect(runtime.replies).toEqual([]);
  });

  it("records an empty reply without a hand-off", async () => {
    scripts.set("Claude", [{ kind: "reply", text: "" }]);
    await round("@Claude go").done;
    expect(runtime.replies.map((reply) => reply.status)).toEqual(["empty"]);
  });
});
