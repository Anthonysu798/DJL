import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  GROUP_CATCH_UP_LIMIT,
  GROUP_DEFAULT_HOP_LIMIT,
  GROUP_MODEL_SELECTION,
  GROUP_ROLE_PRESETS,
  GroupCreateInput,
  GroupEvent,
  GroupListResult,
  GroupMemberProvider,
} from "./groups";
import { ModelSelection, NewTaskModelSelection } from "./orchestration";
import { ProjectKind } from "./project";

describe("group contracts", () => {
  it("defaults and bounds", () => {
    expect(GROUP_DEFAULT_HOP_LIMIT).toBe(6);
    expect(GROUP_CATCH_UP_LIMIT).toBe(40);
    expect(GROUP_ROLE_PRESETS).toEqual(["planner", "builder", "reviewer", "researcher", "writer"]);
    expect(() => Schema.decodeUnknownSync(GroupMemberProvider)("opencode")).toThrow();
    expect(() => Schema.decodeUnknownSync(GroupMemberProvider)("djlCloud")).toThrow();
    expect(Schema.decodeUnknownSync(GroupMemberProvider)("gemini")).toBe("gemini");
  });
  it("accepts the group model selection and project kind", () => {
    expect(Schema.decodeUnknownSync(ModelSelection)(GROUP_MODEL_SELECTION)).toEqual({
      provider: "group",
      model: "group",
    });
    expect(Schema.decodeUnknownSync(ProjectKind)("group")).toBe("group");
  });
  it("lets a new group thread be created", () => {
    expect(Schema.decodeUnknownSync(NewTaskModelSelection)(GROUP_MODEL_SELECTION).provider).toBe(
      "group",
    );
  });
  it("requires at least one member and a name", () => {
    expect(() =>
      Schema.decodeUnknownSync(GroupCreateInput)({ name: "Team", members: [] }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(GroupCreateInput)({ name: " ", members: [{ provider: "codex" }] }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(GroupCreateInput)({
        name: "Team",
        members: [{ provider: "codex", role: "reviewer" }],
      }).members[0]?.role,
    ).toBe("reviewer");
  });
  it("decodes a live draft, and a snapshot with or without live state", () => {
    const decode = Schema.decodeUnknownSync(GroupEvent);
    expect(
      decode({ type: "reply.draft", groupId: "g1", memberId: "m1", delta: "Hi", restart: true }),
    ).toMatchObject({ delta: "Hi", restart: true });
    expect(() => decode({ type: "reply.draft", groupId: "g1", memberId: "m1" })).toThrow();
    expect(decode({ type: "snapshot", groups: [], replies: [] })).not.toHaveProperty("live");
    const live = { memberStates: { m1: "working" }, drafts: { m1: "Hi" } };
    expect(decode({ type: "snapshot", groups: [], replies: [], live })).toMatchObject({ live });
    expect(
      Schema.decodeUnknownSync(GroupListResult)({ groups: [], replies: [], live }).live?.drafts,
    ).toEqual({ m1: "Hi" });
    expect(Schema.decodeUnknownSync(GroupListResult)({ groups: [], replies: [] }).live).toBe(
      undefined,
    );
  });
});
