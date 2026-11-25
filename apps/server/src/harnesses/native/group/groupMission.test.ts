import { GroupId, GroupMemberId, ProjectId, ThreadId, type Group } from "@djl/contracts";
import { describe, expect, it } from "vitest";

import { parseMissionPlan, pickPlanner, withStepStatus, addMissionStats } from "./groupMission";

const members = [
  { id: GroupMemberId.makeUnsafe("m1"), handle: "Claude" },
  { id: GroupMemberId.makeUnsafe("m2"), handle: "Codex" },
  { id: GroupMemberId.makeUnsafe("m3"), handle: "Claude2" },
];

const groupWith = (patch: Partial<Group>): Group => ({
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
  members: members.map((member, position) => ({
    id: member.id,
    groupId: GroupId.makeUnsafe("g1"),
    provider: "claudeAgent",
    handle: member.handle,
    role: null,
    model: null,
    position,
    muted: false,
    contextUsage: null,
  })),
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

describe("parseMissionPlan", () => {
  it("reads checklist, numbered and bold lines, matching handles exactly", () => {
    const steps = parseMissionPlan(
      [
        "Here is the plan.",
        "- [ ] @Codex build the landing page",
        "1. @claude: write the copy",
        "* [x] **@Claude2** — check everything",
        "- [ ] @Nobody does nothing",
        "@Codex not a list line",
      ].join("\n"),
      members,
    );
    expect(steps).toEqual([
      { text: "build the landing page", memberId: "m2", status: "pending" },
      { text: "write the copy", memberId: "m1", status: "pending" },
      { text: "check everything", memberId: "m3", status: "pending" },
    ]);
  });

  it("keeps at most seven steps", () => {
    const text = Array.from({ length: 10 }, (_, index) => `- [ ] @Codex step ${index}`).join("\n");
    expect(parseMissionPlan(text, members)).toHaveLength(7);
  });
});

describe("pickPlanner", () => {
  it("prefers the lead, then a Planner, then the first unmuted member", () => {
    const base = groupWith({});
    expect(pickPlanner(groupWith({ defaultRecipient: base.members[2]!.id }))?.handle).toBe(
      "Claude2",
    );
    expect(
      pickPlanner(
        groupWith({
          members: base.members.map((member) =>
            member.handle === "Codex" ? { ...member, role: "planner" } : member,
          ),
        }),
      )?.handle,
    ).toBe("Codex");
    expect(
      pickPlanner(
        groupWith({
          members: base.members.map((member) =>
            member.handle === "Claude" ? { ...member, muted: true } : member,
          ),
        }),
      )?.handle,
    ).toBe("Codex");
  });
});

describe("mission updates", () => {
  it("changes one step and merges stats with distinct files", () => {
    const steps = parseMissionPlan("- [ ] @Codex a\n- [ ] @Claude b", members);
    const mission = {
      id: "x",
      steps,
    } as unknown as Parameters<typeof withStepStatus>[0];
    expect(withStepStatus(mission, 1, "done").steps.map((step) => step.status)).toEqual([
      "pending",
      "done",
    ]);
    expect(
      addMissionStats(
        { files: ["a.ts"], commands: 1, reviews: 0, replies: 1 },
        { files: ["a.ts", "b.ts"], commands: 2, reviews: 1, replies: 2 },
      ),
    ).toEqual({ files: ["a.ts", "b.ts"], commands: 3, reviews: 1, replies: 3 });
  });
});
