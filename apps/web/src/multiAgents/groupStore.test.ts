import { GroupId, GroupMemberId, ProjectId, ThreadId, type Group } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useGroupStore } from "./groupStore";

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
  members: [],
  createdAt: 1,
  updatedAt: 1,
};
const m1 = GroupMemberId.makeUnsafe("m1");

beforeEach(() => useGroupStore.getState().reset());

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
});
