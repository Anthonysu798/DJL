// FILE: groupMission.ts
// Purpose: Pure helpers for Multi agents missions: who plans, reading the planner's checklist
//          into steps, and updating a mission's steps and stats.
// Layer: Native harness (group)

import {
  GROUP_MISSION_MAX_STEPS,
  GroupMemberId,
  type Group,
  type GroupMember,
  type GroupMission,
  type GroupMissionStats,
  type GroupMissionStep,
  type GroupMissionStepStatus,
} from "@djl/contracts";

export const EMPTY_MISSION_STATS: GroupMissionStats = {
  files: [],
  commands: 0,
  reviews: 0,
  replies: 0,
};

/** The lead plans; otherwise a member with the Planner role; otherwise the first unmuted one. */
export function pickPlanner(group: Group): GroupMember | null {
  const ordered = group.members.toSorted((left, right) => left.position - right.position);
  return (
    ordered.find((member) => member.id === group.defaultRecipient) ??
    ordered.find((member) => member.role === "planner") ??
    ordered.find((member) => !member.muted) ??
    ordered[0] ??
    null
  );
}

// "- [ ] @Codex build the page", "1. @Claude: review it", "* [x] @Gemini — research".
const STEP_LINE =
  /^\s*(?:[-*+•]|\d+[.)])\s*(?:\[[ xX]?\]\s*)?\*{0,2}@([^\s:,.*—–-]+)\*{0,2}\s*[:,—–-]?\s*(.+?)\s*$/;

/** Reads the planner's checklist into steps; lines naming no member of the group are dropped. */
export function parseMissionPlan(
  text: string,
  members: readonly Pick<GroupMember, "id" | "handle">[],
): GroupMissionStep[] {
  const byHandle = new Map(members.map((member) => [member.handle.toLowerCase(), member]));
  const steps: GroupMissionStep[] = [];
  for (const line of text.split("\n")) {
    const match = STEP_LINE.exec(line);
    if (!match) continue;
    const member = byHandle.get((match[1] ?? "").toLowerCase());
    const stepText = (match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!member || !stepText) continue;
    steps.push({
      text: stepText,
      memberId: GroupMemberId.makeUnsafe(member.id),
      status: "pending",
    });
    if (steps.length >= GROUP_MISSION_MAX_STEPS) break;
  }
  return steps;
}

export function withStepStatus(
  mission: GroupMission,
  index: number,
  status: GroupMissionStepStatus,
): GroupMission {
  return {
    ...mission,
    steps: mission.steps.map((step, position) => (position === index ? { ...step, status } : step)),
  };
}

export function addMissionStats(
  stats: GroupMissionStats,
  delta: { files: readonly string[]; commands: number; reviews: number; replies: number },
): GroupMissionStats {
  return {
    files: [...new Set([...stats.files, ...delta.files])],
    commands: stats.commands + delta.commands,
    reviews: stats.reviews + delta.reviews,
    replies: stats.replies + delta.replies,
  };
}

/** What the planner is asked for, so DJL can read its answer into steps. */
export function missionPlanInstructions(handles: readonly string[]): string {
  return [
    "This is a mission plan request. Do not start the work yet: only plan it.",
    "Reply with one short line about the plan, then the steps as a checklist, one per line,",
    "exactly like this:",
    "- [ ] @Handle what this member should do",
    `Use 2 to ${GROUP_MISSION_MAX_STEPS} steps. Give each step to the member best suited for it`,
    `(${handles.map((handle) => `@${handle}`).join(", ")}), keep each step to one sentence, write`,
    "the steps in the language of the request, and end with a step that checks the result.",
  ].join("\n");
}
