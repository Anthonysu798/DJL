import { GroupId, GroupMemberId, ProjectId, ThreadId, type Group } from "@djl/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { batchDrafts, useGroupStore } from "./groupStore";

const group: Group = {
  id: GroupId.makeUnsafe("g1"),
  threadId: ThreadId.makeUnsafe("t1"),
  projectId: ProjectId.makeUnsafe("p1"),
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
  members: [],
  createdAt: 1,
  updatedAt: 1,
};
const m1 = GroupMemberId.makeUnsafe("m1");

const m2 = GroupMemberId.makeUnsafe("m2");
const draft = (memberId: GroupMemberId, delta: string, restart = false) =>
  ({ type: "reply.draft", groupId: group.id, memberId, delta, restart }) as const;
const state = (memberId: GroupMemberId, value: "idle" | "working" | "waiting" | "failed") =>
  ({ type: "member.state", groupId: group.id, memberId, state: value }) as const;

beforeEach(() => useGroupStore.getState().reset());
afterEach(() => vi.unstubAllGlobals());

describe("group store", () => {
  it("applies snapshot, member state, reply and delete events", () => {
    const store = () => useGroupStore.getState();
    store().applyEvent({ type: "snapshot", groups: [group], replies: [] });
    expect(store().loaded).toBe(true);
    expect(store().groups[group.id]?.name).toBe("Launch");
    store().applyEvent({ type: "member.state", groupId: group.id, memberId: m1, state: "working" });
    expect(store().memberStates[m1]).toBe("working");
    store().applyEvent({
      type: "reply.recorded",
      reply: {
        groupId: group.id,
        replyId: "r1",
        memberId: m1,
        status: "ok",
        error: null,
        files: [],
        commands: [],
      },
    });
    expect(store().replies.r1?.memberId).toBe(m1);
    store().applyEvent({ type: "group.upserted", group: { ...group, name: "Renamed" } });
    expect(store().groups[group.id]?.name).toBe("Renamed");
    store().applyEvent({ type: "group.deleted", groupId: group.id, folder: "/tmp/g1" });
    expect(store().groups[group.id]).toBeUndefined();
  });

  it("builds each member's draft, replacing it when the member starts a new message", () => {
    const store = () => useGroupStore.getState();
    store().applyEvent(draft(m1, "Let me look.", true));
    store().applyEvent(draft(m2, "Hi", true));
    store().applyEvent(draft(m1, "The answer ", true));
    store().applyEvent(draft(m1, "is 4."));
    expect(store().drafts).toEqual({ [m1]: "The answer is 4.", [m2]: "Hi" });
  });

  it("drops a draft when the member stops being busy or its reply is recorded", () => {
    const store = () => useGroupStore.getState();
    store().applyEvent(draft(m1, "one", true));
    store().applyEvent(state(m1, "waiting"));
    expect(store().drafts[m1]).toBe("one");
    store().applyEvent(state(m1, "idle"));
    expect(store().drafts).toEqual({});
    store().applyEvent(draft(m1, "two", true));
    store().applyEvent(state(m1, "failed"));
    expect(store().drafts).toEqual({});
    store().applyEvent(draft(m1, "three", true));
    store().applyEvent({
      type: "reply.recorded",
      reply: {
        groupId: group.id,
        replyId: "r2",
        memberId: m1,
        status: "ok",
        error: null,
        files: [],
        commands: [],
      },
    });
    expect(store().drafts).toEqual({});
  });

  it("a snapshot with live state replaces member states and drafts; one without keeps them", () => {
    const store = () => useGroupStore.getState();
    store().applyEvent(state(m2, "working"));
    store().applyEvent(draft(m2, "old", true));
    store().applyEvent({ type: "snapshot", groups: [group], replies: [] });
    expect(store().drafts).toEqual({ [m2]: "old" });
    store().applyEvent({
      type: "snapshot",
      groups: [group],
      replies: [],
      live: { memberStates: { [m1]: "working" }, drafts: { [m1]: "So far" } },
    });
    expect(store().memberStates).toEqual({ [m1]: "working" });
    expect(store().drafts).toEqual({ [m1]: "So far" });
  });

  it("applies a burst of draft pieces once per frame, in order with other events", () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => frames.push(run));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const applied: unknown[] = [];
    const push = batchDrafts((event) => applied.push(event));
    push(draft(m1, "a", true));
    push(draft(m1, "b"));
    push(draft(m2, "x", true));
    push(draft(m1, "c"));
    expect(applied).toEqual([]);
    expect(frames).toHaveLength(1);
    frames[0]!();
    expect(applied).toEqual([draft(m1, "abc", true), draft(m2, "x", true)]);
    push(draft(m1, "d"));
    push(draft(m1, "new", true));
    push(state(m1, "idle"));
    expect(applied.slice(2)).toEqual([draft(m1, "new", true), state(m1, "idle")]);
  });

  it("keeps each group's round progress until the round ends", () => {
    const store = () => useGroupStore.getState();
    store().applyEvent({
      type: "round.progress",
      groupId: group.id,
      progress: { hops: 2, hopLimit: 6, quiet: [m1] },
    });
    expect(store().rounds[group.id]).toEqual({ hops: 2, hopLimit: 6, quiet: [m1] });
    store().applyEvent({ type: "round.progress", groupId: group.id, progress: null });
    expect(store().rounds[group.id]).toBeUndefined();
  });
});
