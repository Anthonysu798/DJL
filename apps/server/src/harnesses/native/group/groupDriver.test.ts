import {
  GroupId,
  GroupMemberId,
  ProjectId,
  ThreadId,
  type ChatAttachment,
  type Group,
  type GroupHandoff,
  type GroupMemberProvider,
  type GroupReply,
  type ProviderRuntimeEvent,
} from "@synara/contracts";
import { Effect, Stream } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeNativeAdapter } from "../adapter";
import type { NativeDriverFactory } from "../types";
import { createGroupDriverFactory } from "./groupDriver";
import type { GroupLiveControls } from "../../../groups/Services/GroupService";
import type { GroupRuntime } from "./groupRound";

type Behaviour = { kind: "reply"; text: string } | { kind: "fail" } | { kind: "hang" };

const threadId = ThreadId.makeUnsafe("group-thread");
let folder: string;
let group: Group;
let behaviours: Map<string, Behaviour>;
let prompts: Map<string, string[]>;
let closed: Set<string>;
let releases: Map<string, (text: string) => void>;
let childFactoryCalls: number;
let replies: GroupReply[];
let openGates: Map<string, Promise<void>>;
let live: GroupLiveControls | null;

const handleFor = (provider: string) => (provider === "codex" ? "Codex" : "Claude");

const fakeChildFactory: NativeDriverFactory = async (input, sink) => {
  childFactoryCalls += 1;
  const handle = handleFor(String(input.provider));
  await openGates.get(handle);
  return {
    id: `native-${handle}`,
    async send(turn) {
      prompts.get(handle)!.push(turn.input ?? "");
      const behaviour = behaviours.get(handle) ?? { kind: "reply", text: "ok" };
      if (behaviour.kind === "fail") {
        sink.fail(new Error(`${handle} crashed`));
        return;
      }
      const text =
        behaviour.kind === "reply"
          ? behaviour.text
          : await new Promise<string>((resolve) => releases.set(handle, resolve));
      sink.emit({
        type: "content.delta",
        itemId: "a1",
        payload: { streamKind: "assistant_text", delta: text },
      });
    },
    async interrupt() {
      releases.get(handle)?.("stopped");
    },
    close() {
      closed.add(handle);
    },
    models: async () => ({ models: [] }),
  };
};

function makeRuntime(): GroupRuntime {
  const log: { seq: number; author: string; text: string }[] = [];
  const sessions = new Map<string, { nativeSessionId: string | null; readSeq: number }>();
  let lastSpeakers: string[] = [];
  let lastRoundAll = false;
  return {
    loadGroup: async (id) => (id === threadId ? group : null),
    appendLog: async (_group, author, text) => {
      log.push({ seq: log.length + 1, author, text });
      return log.length;
    },
    logAfter: async (_group, seq) => log.filter((entry) => entry.seq > seq),
    memberRuntime: async (memberId) =>
      sessions.get(memberId) ?? { nativeSessionId: null, readSeq: 0 },
    saveMemberRuntime: async (memberId, patch) => {
      const current = sessions.get(memberId) ?? { nativeSessionId: null, readSeq: 0 };
      sessions.set(memberId, {
        nativeSessionId: patch.nativeSessionId ?? current.nativeSessionId,
        readSeq: patch.readSeq ?? current.readSeq,
      });
    },
    roundState: async () => ({ lastSpeakers, lastRoundAll }),
    saveRoundState: async (_group, state) => {
      lastSpeakers = state.lastSpeakers;
      lastRoundAll = state.lastRoundAll;
    },
    takeResume: async () => [] as GroupHandoff[],
    savePause: async () => {},
    recordReply: async (reply) => {
      replies.push(reply);
    },
    setMemberState: () => {},
    publishDraft: () => {},
    skills: async () => [],
  };
}

const childFactories = Object.fromEntries(
  (
    [
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "kimi",
      "iflow",
      "qwen",
      "codebuddy",
      "pi",
      "gemini",
    ] as const
  ).map((provider) => [provider, fakeChildFactory]),
) as Record<GroupMemberProvider, NativeDriverFactory>;

const imageAttachment: ChatAttachment = {
  type: "image",
  id: "att-1",
  name: "a.png",
  mimeType: "image/png",
  sizeBytes: 10,
};

function harness(provider: "group" | "codex" = "group") {
  const runtime = makeRuntime();
  const factory =
    provider === "group"
      ? createGroupDriverFactory({
          bridge: () => ({
            runtime,
            registerLive: (_threadId, controls) => {
              live = controls;
              return () => {};
            },
            readRoots: [],
          }),
          childFactories,
          childOptions: async () => ({}),
          resolveAttachment: (attachment) =>
            attachment.type === "image" ? `/resolved/${attachment.id}.png` : null,
          readSkill: async () => "# skill",
        })
      : fakeChildFactory;
  return Effect.gen(function* () {
    const adapter = yield* makeNativeAdapter(provider, factory);
    const events: ProviderRuntimeEvent[] = [];
    yield* Stream.runForEach(adapter.streamEvents, (event) =>
      Effect.sync(() => {
        events.push(event);
      }),
    ).pipe(Effect.forkChild);
    return { adapter, events };
  });
}

const until = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(predicate()).toBe(true);
};
const turnCompleted = (events: ProviderRuntimeEvent[]) =>
  events.some((event) => event.type === "turn.completed");

const scenario = <A>(
  body: (input: Effect.Success<ReturnType<typeof harness>>) => Promise<A>,
  provider: "group" | "codex" = "group",
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const input = yield* harness(provider);
        yield* Effect.promise(() =>
          Effect.runPromise(
            input.adapter.startSession({
              threadId,
              cwd: folder,
              runtimeMode: "approval-required",
              modelSelection:
                provider === "group"
                  ? { provider: "group", model: "group" }
                  : { provider: "codex", model: "gpt-5" },
            }),
          ),
        );
        return yield* Effect.promise(() => body(input));
      }),
    ),
  );

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "djl-group-driver-"));
  group = {
    id: GroupId.makeUnsafe("g1"),
    threadId,
    projectId: ProjectId.makeUnsafe("p1"),
    name: "Launch",
    folder,
    folderIsAuto: true,
    hopLimit: 6,
    skipAllWarning: false,
    pendingHandoffs: [],
    members: [
      {
        id: GroupMemberId.makeUnsafe("claude"),
        groupId: GroupId.makeUnsafe("g1"),
        provider: "claudeAgent",
        handle: "Claude",
        role: null,
        model: null,
        position: 0,
      },
      {
        id: GroupMemberId.makeUnsafe("codex"),
        groupId: GroupId.makeUnsafe("g1"),
        provider: "codex",
        handle: "Codex",
        role: null,
        model: null,
        position: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  behaviours = new Map();
  prompts = new Map([
    ["Claude", []],
    ["Codex", []],
  ]);
  closed = new Set();
  releases = new Map();
  childFactoryCalls = 0;
  replies = [];
  openGates = new Map();
  live = null;
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe("group native driver", () => {
  it("emits a delta before the completion for every member reply", async () => {
    const events = await scenario(async ({ adapter, events }) => {
      await Effect.runPromise(adapter.sendTurn({ threadId, input: "@all reply ok" }));
      await until(() => turnCompleted(events));
      return events;
    });
    const memberEvents = events.filter(
      (event) => typeof event.itemId === "string" && event.itemId.includes("gm."),
    );
    const byItem = new Map<string, string[]>();
    for (const event of memberEvents)
      byItem.set(event.itemId!, [...(byItem.get(event.itemId!) ?? []), event.type]);
    expect(byItem.size).toBe(2);
    for (const types of byItem.values()) expect(types).toEqual(["content.delta", "item.completed"]);
  });

  it("completes the turn only when every member has finished", async () => {
    behaviours.set("Claude", { kind: "hang" });
    await scenario(async ({ adapter, events }) => {
      await Effect.runPromise(adapter.sendTurn({ threadId, input: "@all go" }));
      await until(() => replies.length === 1);
      expect(turnCompleted(events)).toBe(false);
      releases.get("Claude")!("late");
      await until(() => turnCompleted(events));
    });
    expect(replies).toHaveLength(2);
  });

  it("steering a running round wakes an idle member at once", async () => {
    behaviours.set("Claude", { kind: "hang" });
    await scenario(async ({ adapter, events }) => {
      expect(adapter.capabilities.supportsTurnSteering).toBe(true);
      await Effect.runPromise(adapter.sendTurn({ threadId, input: "@Claude long task" }));
      await until(() => releases.has("Claude"));
      await Effect.runPromise(adapter.steerTurn!({ threadId, input: "@Codex quick question" }));
      await until(() => replies.length === 1);
      expect(replies[0]!.memberId).toBe("codex");
      expect(turnCompleted(events)).toBe(false);
      releases.get("Claude")!("done");
      await until(() => turnCompleted(events));
      expect(events.filter((event) => event.type === "turn.started")).toHaveLength(1);
    });
    expect(replies).toHaveLength(2);
  });

  it("a steer with no running round starts a new round", async () => {
    await scenario(async ({ adapter, events }) => {
      await Effect.runPromise(adapter.steerTurn!({ threadId, input: "@Codex hi" }));
      await until(() => turnCompleted(events));
    });
    expect(replies.map((reply) => reply.memberId)).toEqual(["codex"]);
  });

  it("a member removed while its CLI is starting does not keep that CLI", async () => {
    const opening = Promise.withResolvers<void>();
    openGates.set("Claude", opening.promise);
    await scenario(async ({ adapter, events }) => {
      await Effect.runPromise(adapter.sendTurn({ threadId, input: "@Claude go" }));
      await until(() => childFactoryCalls === 1);
      await live!.removeMember(GroupMemberId.makeUnsafe("claude"));
      opening.resolve();
      await until(() => turnCompleted(events));
      // Checked before the session ends, which would close every child anyway.
      expect(closed.has("Claude")).toBe(true);
    });
    expect(prompts.get("Claude")).toEqual([]);
  });

  it("a failing child does not fail the group turn", async () => {
    behaviours.set("Claude", { kind: "fail" });
    const events = await scenario(async ({ adapter, events }) => {
      await Effect.runPromise(adapter.sendTurn({ threadId, input: "@Claude @Codex go" }));
      await until(() => turnCompleted(events));
      return events;
    });
    expect(events.find((event) => event.type === "turn.completed")).toMatchObject({
      payload: { state: "completed" },
    });
    expect(replies.map((reply) => reply.status).toSorted()).toEqual(["failed", "ok"]);
  });

  it("lists a static model without opening children", async () => {
    const result = await scenario(({ adapter }) =>
      Effect.runPromise(adapter.listModels!({ provider: "group", cwd: folder })),
    );
    expect(result.models).toEqual([{ slug: "group", name: "Group" }]);
    expect(childFactoryCalls).toBe(0);
  });

  it("passes attachment paths into the member prompt", async () => {
    await scenario(async ({ adapter, events }) => {
      await Effect.runPromise(
        adapter.sendTurn({ threadId, input: "@Claude look", attachments: [imageAttachment] }),
      );
      await until(() => turnCompleted(events));
    });
    expect(prompts.get("Claude")!.at(-1)).toContain("/resolved/att-1.png");
  });

  it("other native providers still reject attachments", async () => {
    await expect(
      scenario(
        ({ adapter }) =>
          Effect.runPromise(
            adapter.sendTurn({ threadId, input: "look", attachments: [imageAttachment] }),
          ),
        "codex",
      ),
    ).rejects.toThrow("text prompts only");
  });

  it("closing the driver closes every child", async () => {
    await scenario(async ({ adapter, events }) => {
      await Effect.runPromise(adapter.sendTurn({ threadId, input: "@all hi" }));
      await until(() => turnCompleted(events));
      await Effect.runPromise(adapter.stopSession(threadId));
    });
    expect(closed).toEqual(new Set(["Claude", "Codex"]));
  });
});
