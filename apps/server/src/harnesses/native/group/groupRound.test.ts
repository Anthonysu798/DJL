import {
  GroupId,
  GroupMemberId,
  ProjectId,
  ThreadId,
  type Group,
  type GroupHandoff,
  type GroupMember,
  type GroupMission,
  type GroupMemberState,
  type GroupReply,
} from "@djl/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import type { ChildReply, ChildSession } from "./childSession";
import { startRound, type GroupCue, type GroupRuntime, type RoundHost } from "./groupRound";

type Step =
  | { kind: "reply"; text: string; files?: string[] }
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
  muted: false,
  contextUsage: null,
});

let group: Group;
let scripts: Map<string, Array<Step | ((prompt: string) => Step)>>;
let askedHandles: string[];
let prompts: Map<string, string[]>;
let flags: Map<string, boolean[]>;
let states: Map<string, GroupMemberState>;
let drafts: { handle: string; delta: string; restart: boolean }[];
let progress: ({ hops: number; quiet: string[] } | null)[];
let usage: Map<string, { usedTokens: number; maxTokens: number | null }>;
let activity: Map<string, number>;
let saved: Map<string, { setupRevSeen?: number; contextUsage?: unknown }>;
let runtime: GroupRuntime & {
  log: { seq: number; author: string; text: string }[];
  pause: GroupHandoff[];
  replies: GroupReply[];
  requestResume(): void;
  cues: Map<string, GroupCue>;
  reactions: { targetId: string; handle: string; kind: string | null }[];
  activities: { handle: string; kind: string | null; detail: string | null; from: string | null }[];
  missions: Map<string, GroupMission>;
  guests: Map<string, { name: string } | null>;
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
    contextUsage: () => usage.get(handle) ?? null,
    lastActivityAt: () => activity.get(handle) ?? Date.now(),
    async ask(prompt, onRequest): Promise<ChildReply> {
      askedHandles.push(handle);
      prompts.get(handle)!.push(prompt);
      const queue = scripts.get(handle) ?? [];
      const entry = queue.length > 1 ? queue.shift()! : (queue[0] ?? { kind: "reply", text: "ok" });
      const step = typeof entry === "function" ? entry(prompt) : entry;
      const work = {
        files: step.kind === "reply" ? [...(step.files ?? [])] : ([] as string[]),
        commands: [] as string[],
      };
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
    brief: "",
    setupRev: 0,
    defaultRecipient: "last",
    reviewerMemberId: null,
    members: [member("Claude", 0), member("Codex", 1), member("Gemini", 2)],
    createdAt: 1,
    updatedAt: 1,
  };
  scripts = new Map();
  askedHandles = [];
  prompts = new Map(group.members.map((entry) => [entry.handle, []]));
  flags = new Map(group.members.map((entry) => [entry.handle, []]));
  states = new Map();
  drafts = [];
  progress = [];
  usage = new Map();
  activity = new Map();
  saved = new Map();
  const memberRuntime = new Map<
    string,
    { nativeSessionId: string | null; readSeq: number; setupRevSeen?: number }
  >();
  let roundState = { lastSpeakers: [] as GroupMemberId[], lastRoundAll: false };
  let resumeRequested = false;
  const state = {
    log: [] as { seq: number; author: string; text: string }[],
    pause: [] as GroupHandoff[],
    replies: [] as GroupReply[],
    requestResume: () => {
      resumeRequested = true;
    },
    cues: new Map<string, GroupCue>(),
    reactions: [] as { targetId: string; handle: string; kind: string | null }[],
    activities: [] as {
      handle: string;
      kind: string | null;
      detail: string | null;
      from: string | null;
    }[],
    missions: new Map<string, GroupMission>(),
    guests: new Map<string, { name: string } | null>(),
    guestOf: async (_groupId: string, messageId: string) =>
      state.guests.has(messageId) ? state.guests.get(messageId)! : undefined,
    takeCue: async (messageId: string) => {
      const cue = state.cues.get(messageId) ?? null;
      state.cues.delete(messageId);
      return cue;
    },
    setReaction: (_groupId: string, targetId: string, memberId: string, kind: string | null) => {
      state.reactions.push({ targetId, handle: handleOf(memberId), kind });
    },
    publishActivity: (
      _groupId: string,
      memberId: string,
      activity: { kind: string; detail: string | null; from: string | null } | null,
    ) => {
      state.activities.push({
        handle: handleOf(memberId),
        kind: activity?.kind ?? null,
        detail: activity?.detail ?? null,
        from: activity?.from ? handleOf(activity.from) : null,
      });
    },
    loadMission: async (missionId: string) => state.missions.get(missionId) ?? null,
    saveMission: async (mission: GroupMission) => {
      state.missions.set(mission.id, mission);
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
      patch: {
        nativeSessionId?: string | null;
        readSeq?: number;
        setupRevSeen?: number;
        contextUsage?: unknown;
      },
    ) => {
      const current = memberRuntime.get(memberId) ?? { nativeSessionId: null, readSeq: 0 };
      memberRuntime.set(memberId, {
        nativeSessionId:
          patch.nativeSessionId === undefined ? current.nativeSessionId : patch.nativeSessionId,
        readSeq: patch.readSeq ?? current.readSeq,
        setupRevSeen: patch.setupRevSeen ?? current.setupRevSeen ?? 0,
      });
      saved.set(handleOf(memberId), {
        ...(patch.setupRevSeen !== undefined ? { setupRevSeen: patch.setupRevSeen } : {}),
        ...(patch.contextUsage !== undefined ? { contextUsage: patch.contextUsage } : {}),
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
    publishDraft: (_groupId: string, memberId: string, delta: string, restart: boolean) => {
      drafts.push({ handle: handleOf(memberId), delta, restart });
    },
    publishProgress: (
      _groupId: string,
      next: { hops: number; quiet: readonly string[] } | null,
    ) => {
      progress.push(next ? { hops: next.hops, quiet: next.quiet.map(handleOf) } : null);
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

  it("lets a member read the files attached to its message, and nothing else there", async () => {
    const decisions: string[] = [];
    host.openChild = async () => ({
      nativeSessionId: "native",
      contextUsage: () => null,
      lastActivityAt: () => Date.now(),
      async ask(_prompt, onRequest) {
        decisions.push(
          String(
            await onRequest("file_read_approval", {
              tool: "Read",
              input: { file_path: "/attachments/t1/a.png" },
            }),
          ),
        );
        decisions.push(
          String(
            await onRequest("file_read_approval", {
              tool: "Read",
              input: { file_path: "/attachments/other/b.png" },
            }),
          ),
        );
        return { status: "ok", text: "seen", work: { files: [], commands: [] } };
      },
      async stop() {},
      close() {},
    });
    await startRound(host, group, "@all look", { attachments: ["/attachments/t1/a.png"] }).done;
    expect(decisions.slice(0, 2)).toEqual(["accept", "decline"]);
  });

  it("publishes a member's draft while it writes, and nothing once it is stopped", async () => {
    const stopped = Promise.withResolvers<ChildReply>();
    let write: ((delta: string, restart: boolean) => void) | undefined;
    host.openChild = async () => ({
      nativeSessionId: "native",
      contextUsage: () => null,
      lastActivityAt: () => Date.now(),
      ask(_prompt, _onRequest, onDraft) {
        write = onDraft;
        onDraft?.("Hel", true);
        onDraft?.("lo", false);
        return stopped.promise;
      },
      async stop() {
        // A CLI can still send text between the stop request and its turn ending.
        write?.(" there", false);
        stopped.resolve({ status: "stopped", work: { files: [], commands: [] } });
      },
      close() {},
    });
    const running = round("@Claude go");
    await until(() => drafts.length === 2);
    await running.stopMember(idOf("Claude"));
    await running.done;
    expect(drafts).toEqual([
      { handle: "Claude", delta: "Hel", restart: true },
      { handle: "Claude", delta: "lo", restart: false },
    ]);
    expect(runtime.replies).toEqual([]);
  });

  it("records an empty reply without a hand-off", async () => {
    scripts.set("Claude", [{ kind: "reply", text: "" }]);
    await round("@Claude go").done;
    expect(runtime.replies.map((reply) => reply.status)).toEqual(["empty"]);
  });

  it("stop while a member's CLI is still opening never asks it", async () => {
    const opening = gateOf();
    const openChild = host.openChild;
    host.openChild = async (entry, resume) => {
      await opening.wait;
      return openChild(entry, resume);
    };
    const running = round("@Claude edit the file");
    await until(() => states.get("Claude") === "working");
    await running.stopAll();
    opening.release("");
    await running.done;
    expect(askedHandles).toEqual([]);
    expect(runtime.replies).toEqual([]);
  });

  it("continuing a paused @all round stays propose-only", async () => {
    pingPong("Claude", "Codex");
    await round("@all start").done;
    expect(runtime.pause.length).toBeGreaterThan(0);
    expect(runtime.pause.every((handoff) => handoff.proposeOnly === true)).toBe(true);
    runtime.requestResume();
    const before = askedHandles.length;
    await round("Continue").done;
    expect(askedHandles.length).toBeGreaterThan(before);
    expect([...flags.get("Claude")!, ...flags.get("Codex")!].every(Boolean)).toBe(true);
  });

  it("a storage error while recording a reply still ends the round", async () => {
    const recordReply = runtime.recordReply;
    let failures = 0;
    runtime.recordReply = async (reply) => {
      if (failures++ === 0) throw new Error("disk full");
      return recordReply(reply);
    };
    await round("@Claude @Codex go").done;
    expect(askedHandles.toSorted()).toEqual(["Claude", "Codex"]);
  });
});

describe("group rounds v2", () => {
  const withGroup = (patch: Partial<Group>) => {
    group = { ...group, ...patch };
  };
  const mute = (handle: string) =>
    withGroup({
      members: group.members.map((entry) =>
        entry.handle === handle ? { ...entry, muted: true } : entry,
      ),
    });
  const scriptSteps = (handle: string, steps: Step[]) => scripts.set(handle, steps);

  it("a pass stays out of the log and is recorded as passed", async () => {
    script("Claude", ["[PASS]"]);
    script("Codex", ["Here is an idea."]);
    script("Gemini", ["Another idea."]);
    await round("@all ideas?").done;
    expect(runtime.log.map((entry) => entry.text)).toEqual([
      "@all ideas?",
      "Here is an idea.",
      "Another idea.",
    ]);
    const claude = runtime.replies.find((reply) => reply.memberId === idOf("Claude"));
    expect(claude).toMatchObject({ status: "empty", passed: true, proposeOnly: true });
    expect(lastPromptFor("Codex")).toContain("[PASS]");
    await round("which one?").done;
    // Claude passed, so it is not one of the last speakers.
    expect(askedHandles.slice(3).toSorted()).toEqual(["Codex", "Gemini"]);
  });

  it("a member the user named is not offered the pass", async () => {
    await round("@Claude hi").done;
    expect(lastPromptFor("Claude")).not.toContain("[PASS]");
  });

  it("briefs members with the group brief and tells others when it changes", async () => {
    withGroup({ brief: "Answer in one line.", setupRev: 1 });
    await round("@Claude one").done;
    expect(lastPromptFor("Claude")).toContain("Answer in one line.");
    expect(saved.get("Claude")?.setupRevSeen).toBe(1);
    withGroup({ brief: "Answer in two lines.", setupRev: 2 });
    await round("@Claude two").done;
    expect(lastPromptFor("Claude")).toMatch(/changed the group's setup/);
    expect(lastPromptFor("Claude")).toContain("Answer in two lines.");
    await round("@Claude three").done;
    expect(lastPromptFor("Claude")).not.toMatch(/group brief|group's setup/);
  });

  it("default recipient everyone: a message without @ goes to all, propose-only", async () => {
    withGroup({ defaultRecipient: "all" });
    await round("@Claude first").done;
    await round("and now everyone").done;
    expect(askedHandles.slice(1).toSorted()).toEqual(["Claude", "Codex", "Gemini"]);
    expect(flags.get("Codex")).toEqual([true]);
  });

  it("default recipient lead: messages without @ go to the lead, who may edit", async () => {
    withGroup({ defaultRecipient: idOf("Gemini") });
    await round("plan the release").done;
    expect(askedHandles).toEqual(["Gemini"]);
    expect(flags.get("Gemini")).toEqual([false]);
    expect(lastPromptFor("Gemini")).toMatch(/You are the group's lead/);
    await round("@Codex just you").done;
    await round("back to the lead").done;
    expect(askedHandles).toEqual(["Gemini", "Codex", "Gemini"]);
  });

  it("a muted member sits out @all and hand-offs but answers when the user names it", async () => {
    mute("Gemini");
    script("Claude", ["@Gemini can you check?"]);
    await round("@all ideas?").done;
    expect(askedHandles).not.toContain("Gemini");
    await round("@Claude go").done;
    expect(askedHandles).not.toContain("Gemini");
    await round("@Gemini your view?").done;
    expect(askedHandles.at(-1)).toBe("Gemini");
    expect(prompts.get("Claude")![0]).toMatch(/@Gemini .*muted/);
  });

  it("failure hand-over skips a muted member", async () => {
    mute("Codex");
    fail("Claude", "Usage limit reached");
    await round("@Claude do it").done;
    expect(askedHandles).toEqual(["Claude", "Gemini"]);
  });

  it("wakes the reviewer read-only after another member changes files", async () => {
    withGroup({ reviewerMemberId: idOf("Codex") });
    scriptSteps("Claude", [{ kind: "reply", text: "Added the page.", files: ["page.tsx"] }]);
    script("Codex", ["Looks right."]);
    await round("@Claude add a page").done;
    expect(askedHandles).toEqual(["Claude", "Codex"]);
    expect(flags.get("Codex")).toEqual([true]);
    expect(lastPromptFor("Codex")).toContain("page.tsx");
    expect(lastPromptFor("Codex")).toMatch(/reviewer/);
    // The review is not a proposal.
    const review = runtime.replies.find((reply) => reply.memberId === idOf("Codex"));
    expect(review?.proposeOnly).toBeUndefined();
    expect(progress.findLast(Boolean)).toEqual({ hops: 1, quiet: [] });
    expect(progress.at(-1)).toBeNull();
  });

  it("the reviewer's fix request lets the author edit, and the loop stops at the hop limit", async () => {
    withGroup({ reviewerMemberId: idOf("Codex"), hopLimit: 3 });
    scriptSteps("Claude", [{ kind: "reply", text: "Changed it.", files: ["a.ts"] }]);
    script("Codex", ["@Claude rename the function"]);
    await round("@Claude change a.ts").done;
    // Claude, review, fix, review: three hops, then the next fix waits for Continue.
    expect(askedHandles).toEqual(["Claude", "Codex", "Claude", "Codex"]);
    expect(flags.get("Claude")).toEqual([false, false]);
    expect(runtime.pause).toHaveLength(1);
    expect(runtime.pause[0]).toMatchObject({ toMemberId: idOf("Claude") });
  });

  it("a review past the hop limit is saved with its files and resumes as a review", async () => {
    withGroup({ reviewerMemberId: idOf("Codex"), hopLimit: 1 });
    scriptSteps("Claude", [
      { kind: "reply", text: "@Gemini look", files: ["x.ts"] },
      { kind: "reply", text: "ok" },
    ]);
    await round("@Claude go").done;
    expect(runtime.pause).toEqual([
      expect.objectContaining({ toMemberId: idOf("Codex"), reviewFiles: ["x.ts"] }),
    ]);
    runtime.requestResume();
    await round("Continue").done;
    expect(lastPromptFor("Codex")).toMatch(/You are the group's reviewer/);
    expect(flags.get("Codex")).toEqual([true]);
  });

  it("no review for the reviewer's own changes, a muted reviewer, or a reply that names it", async () => {
    withGroup({ reviewerMemberId: idOf("Codex") });
    scriptSteps("Codex", [{ kind: "reply", text: "Done.", files: ["b.ts"] }]);
    await round("@Codex edit b.ts").done;
    expect(askedHandles).toEqual(["Codex"]);
    scriptSteps("Claude", [{ kind: "reply", text: "@Codex please check", files: ["c.ts"] }]);
    script("Codex", ["fine"]);
    await round("@Claude edit c.ts").done;
    expect(askedHandles.filter((name) => name === "Codex")).toHaveLength(2);
    mute("Codex");
    scriptSteps("Claude", [{ kind: "reply", text: "Edited.", files: ["d.ts"] }]);
    await round("@Claude edit d.ts").done;
    expect(askedHandles.at(-1)).toBe("Claude");
  });

  it("saves the member's context usage when its reply completes", async () => {
    usage.set("Claude", { usedTokens: 1500, maxTokens: 200_000 });
    await round("@Claude hi").done;
    expect(saved.get("Claude")?.contextUsage).toEqual({ usedTokens: 1500, maxTokens: 200_000 });
  });

  it("reports a working member with no activity as quiet, and clears it at the end", async () => {
    host.quietAfterMs = 20;
    host.quietCheckMs = 5;
    const gate = hangUntilReleased("Claude");
    activity.set("Claude", Date.now() - 1000);
    const running = round("@Claude long task");
    await until(() => progress.some((entry) => entry?.quiet.includes("Claude") === true));
    gate.release("done");
    await running.done;
    expect(progress.at(-1)).toBeNull();
  });

  it("a muting made while the round runs stops agents from waking that member", async () => {
    const gate = hangUntilReleased("Claude");
    const running = round("@Claude go");
    await until(() => askedHandles.includes("Claude"));
    mute("Codex");
    gate.release("@Codex please check");
    await running.done;
    expect(askedHandles).toEqual(["Claude"]);
  });

  it("the automatic reviewer is not a last speaker, so a follow-up goes to the author", async () => {
    withGroup({ reviewerMemberId: idOf("Codex") });
    scriptSteps("Claude", [
      { kind: "reply", text: "Added it.", files: ["a.ts"] },
      { kind: "reply", text: "Planned b.ts." },
    ]);
    script("Codex", ["Looks right."]);
    await round("@Claude add a.ts").done;
    expect(askedHandles).toEqual(["Claude", "Codex"]);
    await round("now plan b.ts").done;
    expect(askedHandles.slice(2)).toEqual(["Claude"]);
    expect(flags.get("Claude")!.at(-1)).toBe(false);
  });

  it("start fresh drops the old reply, closes the CLI, and the next wake ignores the saved session", async () => {
    const dropped: string[] = [];
    const opened: (string | null)[] = [];
    const baseOpen = host.openChild;
    const baseDrop = host.dropChild;
    host.openChild = async (entry, resume) => {
      opened.push(resume);
      return baseOpen(entry, resume);
    };
    host.dropChild = (memberId) => {
      dropped.push(handleOf(memberId));
      baseDrop(memberId);
    };
    await round("@Claude one").done;
    const gate = hangUntilReleased("Claude");
    const running = round("@Claude two");
    await until(() => askedHandles.filter((name) => name === "Claude").length === 2);
    await running.resetMember(idOf("Claude"));
    gate.release("late answer from the old session");
    running.post("@Claude three");
    await running.done;
    expect(dropped).toContain("Claude");
    expect(runtime.log.map((entry) => entry.text)).not.toContain(
      "late answer from the old session",
    );
    // First wake fresh, second resumed the saved session, third forced fresh after the reset.
    expect(opened).toEqual([null, "native-Claude", null]);
    expect(lastPromptFor("Claude")).toContain("You are @Claude");
  });

  it("a member the user named cannot pass; its [PASS] is shown as written", async () => {
    script("Claude", ["[PASS]"]);
    await round("@Claude anything?").done;
    expect(runtime.replies[0]?.passed).toBeUndefined();
    expect(runtime.log.at(-1)?.text).toBe("[PASS]");
  });

  it("a failed review is not handed on to another member", async () => {
    withGroup({ reviewerMemberId: idOf("Codex") });
    scriptSteps("Claude", [{ kind: "reply", text: "Changed it.", files: ["a.ts"] }]);
    fail("Codex", "Usage limit reached");
    await round("@Claude change a.ts").done;
    expect(askedHandles).toEqual(["Claude", "Codex"]);
  });
});

describe("mission mode in rounds", () => {
  const withGroup = (patch: Partial<Group>) => {
    group = { ...group, ...patch };
  };
  const scriptSteps = (handle: string, steps: Step[]) => scripts.set(handle, steps);
  const roundWith = (text: string, extras: { messageId?: string } = {}) =>
    startRound(host, group, text, extras);
  const reactionsFor = (targetId: string) =>
    runtime.reactions
      .filter((entry) => entry.targetId === targetId)
      .map((entry) => `${entry.handle}:${entry.kind}`);
  const mission = (patch: Partial<GroupMission>): GroupMission => ({
    id: "mission-1" as GroupMission["id"],
    groupId,
    goal: "Ship the landing page",
    status: "planning",
    plannerMemberId: idOf("Claude"),
    planReplyId: null,
    steps: [],
    currentStep: 0,
    stats: { files: [], commands: 0, reviews: 0, replies: 0 },
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
    ...patch,
  });

  it("members put 👀 on the message they pick up, then how it ended", async () => {
    script("Claude", ["Here you go."]);
    script("Codex", ["[PASS]"]);
    fail("Gemini", "Usage limit reached");
    await roundWith("@all ideas?", { messageId: "msg-1" }).done;
    expect(reactionsFor("msg-1").toSorted()).toEqual(
      [
        "Claude:seen",
        "Claude:done",
        "Codex:seen",
        "Codex:passed",
        "Gemini:seen",
        "Gemini:failed",
      ].toSorted(),
    );
  });

  it("a stopped member takes its 👀 back", async () => {
    hang("Claude");
    const running = roundWith("@Claude long one", { messageId: "msg-2" });
    await until(() => askedHandles.includes("Claude"));
    await running.stopMember(idOf("Claude"));
    await running.done;
    expect(reactionsFor("msg-2")).toEqual(["Claude:seen", "Claude:null"]);
  });

  it("a hand-off reacts on the reply that handed off, and the stage shows who it came from", async () => {
    script("Claude", ["@Codex please check"]);
    script("Codex", ["Checked."]);
    await roundWith("@Claude go", { messageId: "msg-3" }).done;
    const claudeReply = runtime.replies.find((reply) => reply.memberId === idOf("Claude"))!;
    expect(reactionsFor(claudeReply.replyId)).toEqual(["Codex:seen", "Codex:done"]);
    expect(runtime.activities.filter((entry) => entry.handle === "Codex")).toEqual([
      { handle: "Codex", kind: "thinking", detail: null, from: "Claude" },
      { handle: "Codex", kind: null, detail: null, from: null },
    ]);
  });

  it("a reaction posted by DJL reacts on the reacted answer, not on a hidden message", async () => {
    runtime.cues.set("cue-1", { kind: "reaction", targetId: "reply-9" });
    script("Claude", ["A better answer."]);
    await roundWith("@Claude 👎 try again", { messageId: "cue-1" }).done;
    expect(reactionsFor("reply-9")).toEqual(["Claude:seen", "Claude:done"]);
    expect(reactionsFor("cue-1")).toEqual([]);
  });

  it("a plan request is read-only, starts no hand-offs, and becomes the mission's steps", async () => {
    runtime.missions.set("mission-1", mission({}));
    runtime.cues.set("cue-plan", { kind: "missionPlan", missionId: "mission-1" });
    script("Claude", ["Plan:\n- [ ] @Codex build the page\n- [ ] @Gemini check it"]);
    await roundWith("@Claude plan this", { messageId: "cue-plan" }).done;
    expect(askedHandles).toEqual(["Claude"]);
    expect(flags.get("Claude")).toEqual([true]);
    expect(lastPromptFor("Claude")).toMatch(/mission plan request/);
    const saved = runtime.missions.get("mission-1")!;
    expect(saved.status).toBe("ready");
    expect(saved.steps.map((step) => [handleOf(step.memberId), step.text])).toEqual([
      ["Codex", "build the page"],
      ["Gemini", "check it"],
    ]);
    expect(saved.planReplyId).toBe(runtime.replies[0]?.replyId);
  });

  it("a plan with no steps marks the mission failed", async () => {
    runtime.missions.set("mission-1", mission({}));
    runtime.cues.set("cue-plan", { kind: "missionPlan", missionId: "mission-1" });
    script("Claude", ["I would rather not."]);
    await roundWith("@Claude plan this", { messageId: "cue-plan" }).done;
    expect(runtime.missions.get("mission-1")?.status).toBe("failed");
  });

  it("runs the steps one after another and finishes with stats", async () => {
    runtime.missions.set(
      "mission-1",
      mission({
        status: "running",
        steps: [
          { text: "build the page", memberId: idOf("Codex"), status: "pending" },
          { text: "check it", memberId: idOf("Gemini"), status: "pending" },
        ],
      }),
    );
    runtime.cues.set("cue-start", { kind: "missionStart", missionId: "mission-1" });
    scriptSteps("Codex", [{ kind: "reply", text: "Built it.", files: ["page.tsx"] }]);
    script("Gemini", ["Looks right."]);
    await roundWith("Start the mission", { messageId: "cue-start" }).done;
    expect(askedHandles).toEqual(["Codex", "Gemini"]);
    expect(flags.get("Codex")).toEqual([false]);
    expect(lastPromptFor("Gemini")).toMatch(/step 2 of 2 of the mission/);
    const done = runtime.missions.get("mission-1")!;
    expect(done.status).toBe("done");
    expect(done.steps.map((step) => step.status)).toEqual(["done", "done"]);
    expect(done.stats).toEqual({ files: ["page.tsx"], commands: 0, reviews: 0, replies: 2 });
    expect(done.finishedAt).not.toBeNull();
  });

  it("a step whose members all fail pauses the mission on that step", async () => {
    runtime.missions.set(
      "mission-1",
      mission({
        status: "running",
        steps: [
          { text: "build", memberId: idOf("Codex"), status: "pending" },
          { text: "check", memberId: idOf("Gemini"), status: "pending" },
        ],
      }),
    );
    runtime.cues.set("cue-start", { kind: "missionStart", missionId: "mission-1" });
    fail("Codex", "Usage limit reached");
    fail("Gemini", "Signed out");
    await roundWith("Start", { messageId: "cue-start" }).done;
    const paused = runtime.missions.get("mission-1")!;
    expect(paused.status).toBe("paused");
    expect(paused.steps[0]?.status).toBe("failed");
    expect(paused.currentStep).toBe(0);
  });

  it("a hand-off past the hop limit inside a step pauses the mission until Continue", async () => {
    withGroup({ hopLimit: 1 });
    runtime.missions.set(
      "mission-1",
      mission({
        status: "running",
        steps: [{ text: "build", memberId: idOf("Claude"), status: "pending" }],
      }),
    );
    runtime.cues.set("cue-start", { kind: "missionStart", missionId: "mission-1" });
    pingPong("Claude", "Codex");
    await roundWith("Start", { messageId: "cue-start" }).done;
    expect(runtime.missions.get("mission-1")?.status).toBe("paused");
    expect(runtime.pause[0]?.mission).toEqual({ missionId: "mission-1", step: 0 });
    scripts.set("Claude", [{ kind: "reply", text: "Done now." }]);
    scripts.set("Codex", [{ kind: "reply", text: "Done now." }]);
    runtime.requestResume();
    await round("Continue").done;
    expect(runtime.missions.get("mission-1")?.status).toBe("done");
  });
});

describe("guests in rounds", () => {
  const roundWith = (text: string, messageId: string) =>
    startRound(host, group, text, { messageId });

  it("a guest's message gets a proposal only, and the agent is told who is asking", async () => {
    runtime.guests.set("guest-msg-1", { name: "Alex" });
    script("Claude", ["I would add a pause button to the header."]);
    await roundWith("@Claude can you add a pause button?", "guest-msg-1").done;
    const prompt = lastPromptFor("Claude");
    expect(prompt).toContain("This message is from Alex, a guest the user invited");
    expect(prompt).toContain("you cannot change files or run commands");
    expect(runtime.replies.at(-1)).toMatchObject({ status: "ok", proposeOnly: true });
    expect(runtime.log.map((entry) => entry.author)).toContain("Alex (guest)");
  });

  it("a removed or watch-only guest wakes nobody and leaves no trace", async () => {
    runtime.guests.set("guest-msg-2", null);
    script("Claude", ["should never be asked"]);
    await roundWith("@Claude delete everything", "guest-msg-2").done;
    expect(prompts.get("Claude") ?? []).toHaveLength(0);
    expect(runtime.log).toHaveLength(0);
    expect(runtime.replies).toHaveLength(0);
  });

  it("other agents later read the guest's message under the guest's name", async () => {
    runtime.guests.set("guest-msg-3", { name: "Alex" });
    script("Claude", ["Here is my idea."]);
    await roundWith("@Claude any idea for the title?", "guest-msg-3").done;
    script("Codex", ["Agreed."]);
    await round("@Codex what do you think?").done;
    expect(lastPromptFor("Codex")).toContain("Alex (guest)");
  });

  it("a guest's message never restarts hand-offs the owner paused", async () => {
    runtime.pause.push({
      fromMemberId: idOf("Claude"),
      toMemberId: idOf("Codex"),
      text: "@Codex keep editing",
    } as never);
    runtime.guests.set("guest-msg-4", { name: "Alex" });
    script("Claude", ["A proposal."]);
    await roundWith("@Claude continue", "guest-msg-4").done;
    expect(prompts.get("Codex") ?? []).toHaveLength(0);
    expect(runtime.pause).toHaveLength(1);
  });
});
