import {
  GroupId,
  GroupMemberId,
  MessageId,
  ProjectId,
  ThreadId,
  type Group,
  type GroupMember,
  type GroupReply,
  type OrchestrationMessage,
} from "@djl/contracts";
import { describe, expect, it } from "vitest";

import {
  GROUP_CUE_MESSAGE_PREFIX,
  contextLevel,
  contextShare,
  missionProgress,
  questProgress,
  reactionSummary,
  deriveGroupChatRows,
  planIntroText,
  proposalRoundEnds,
  replyImages,
  undoableRound,
  isLargeGroup,
  shouldConfirmAll,
  workChipCounts,
  type GroupChatRow,
} from "./groupChat.logic";

const groupId = GroupId.makeUnsafe("g1");
const member = (
  id: string,
  handle: string,
  provider: GroupMember["provider"],
  position: number,
) => ({
  id: GroupMemberId.makeUnsafe(id),
  groupId,
  provider,
  handle,
  role: null,
  model: null,
  position,
  muted: false,
  contextUsage: null,
});
const groupOf = (count: number): Group => ({
  id: groupId,
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
  members: Array.from({ length: count }, (_, index) =>
    index === 0
      ? member("m1", "Claude", "claudeAgent", 0)
      : index === 1
        ? member("m2", "Codex", "codex", 1)
        : member(`m${index + 1}`, `Agent${index + 1}`, "qwen", index),
  ),
  createdAt: 1,
  updatedAt: 1,
});
const group = groupOf(2);

const message = (id: string, role: "user" | "assistant", text: string): OrchestrationMessage => ({
  id: MessageId.makeUnsafe(id),
  role,
  text,
  turnId: null,
  streaming: false,
  source: "native",
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
});
const user = (id: string, text: string) => message(id, "user", text);
const assistant = (id: string, text: string) => message(id, "assistant", text);
const reply = (overrides: Partial<GroupReply>): GroupReply => ({
  groupId,
  replyId: "r1",
  memberId: GroupMemberId.makeUnsafe("m1"),
  status: "ok",
  error: null,
  files: [],
  commands: [],
  ...overrides,
});
const memberRow = (work: { files: string[]; commands: string[] }): GroupChatRow => ({
  kind: "member",
  id: "x",
  replyId: "x",
  memberId: GroupMemberId.makeUnsafe("m1"),
  handle: "Claude",
  provider: "claudeAgent",
  role: null,
  text: "done",
  status: "ok",
  error: null,
  passed: false,
  proposeOnly: false,
  turnId: null,
  ...work,
});

describe("replyImages", () => {
  it("gathers several images into a gallery and takes them out of the text", () => {
    const text = [
      "Generated **10 logos**. Use concept 1.",
      "",
      "1. [Interlocking monogram](/g/logos/01.png)",
      "2. [Editorial serif](</g/logos/02 serif.png>)",
      "3. See the [brief](/g/brief.pdf) and [orbit](/g/logos/03.webp) too",
      "",
      "![01.png](/g/logos/01.png)",
    ].join("\n");
    expect(replyImages(text)).toEqual({
      text: "Generated **10 logos**. Use concept 1.\n\n3. See the [brief](/g/brief.pdf) and [orbit](/g/logos/03.webp) too",
      images: [
        { src: "/g/logos/01.png", label: "Interlocking monogram" },
        { src: "</g/logos/02 serif.png>", label: "Editorial serif" },
        { src: "/g/logos/03.webp", label: "orbit" },
      ],
    });
  });

  it("leaves a reply with a single image, or only web images, as it is", () => {
    const single = "Here it is.\n\n![sunset.png](/g/sunset.png)";
    expect(replyImages(single)).toEqual({ text: single, images: [] });
    const web = "![a](https://example.test/a.png) ![b](https://example.test/b.png)";
    expect(replyImages(web)).toEqual({ text: web, images: [] });
  });
});

describe("deriveGroupChatRows", () => {
  it("labels each reply with its member and keeps every reply visible", () => {
    const rows = deriveGroupChatRows(
      [
        user("u1", "@all hi"),
        assistant("assistant:t1:gm.m1.r1", "ok"),
        assistant("assistant:t1:gm.m2.r2", "ok"),
      ],
      group,
      {},
    );
    expect(rows.map((row) => row.kind)).toEqual(["user", "member", "member"]);
    expect(rows[1]).toMatchObject({ handle: "Claude", provider: "claudeAgent" });
    expect(rows[2]).toMatchObject({ handle: "Codex" });
  });

  it("keeps sent images viewable and lists other files by name", () => {
    const rows = deriveGroupChatRows(
      [
        {
          ...user("u1", "look at this"),
          attachments: [
            {
              type: "image",
              id: "img-1",
              name: "screen.png",
              previewUrl: "/attachments/img-1",
            },
            { type: "file", id: "f-1", name: "notes.md" },
          ],
        },
      ],
      group,
      {},
    );
    expect(rows[0]).toMatchObject({
      kind: "user",
      images: [{ id: "img-1", name: "screen.png", previewUrl: "/attachments/img-1" }],
      fileNames: ["notes.md"],
    });
  });

  it("marks failed and empty replies from the reply record", () => {
    const rows = deriveGroupChatRows(
      [assistant("assistant:t1:gm.m1.r1", "Usage limit reached")],
      group,
      {
        r1: reply({ status: "failed", error: "Usage limit reached" }),
      },
    );
    expect(rows[0]).toMatchObject({
      kind: "member",
      status: "failed",
      error: "Usage limit reached",
    });
  });

  it("carries the files and commands from the reply record", () => {
    const rows = deriveGroupChatRows([assistant("assistant:t1:gm.m1.r1", "done")], group, {
      r1: reply({ files: ["a.ts"], commands: ["bun test"] }),
    });
    expect(rows[0]).toMatchObject({ files: ["a.ts"], commands: ["bun test"] });
  });

  it("keeps a reply from a removed member readable", () => {
    expect(
      deriveGroupChatRows([assistant("assistant:t1:gm.gone.r1", "old")], group, {})[0],
    ).toMatchObject({
      kind: "unknown-member",
      text: "old",
    });
  });

  it("skips system messages and assistant messages that are not member replies", () => {
    expect(
      deriveGroupChatRows([message("s1", "assistant", "x"), user("u1", "hi")], group, {}).map(
        (row) => row.kind,
      ),
    ).toEqual(["user"]);
  });
});

describe("chips and warnings", () => {
  it("shows the chip only when work happened", () => {
    expect(
      workChipCounts(memberRow({ files: ["a.ts", "b.ts", "c.ts"], commands: ["bun test", "ls"] })),
    ).toEqual({ files: 3, commands: 2 });
    expect(workChipCounts(memberRow({ files: [], commands: [] }))).toBeNull();
  });

  it("asks before @all from four members", () => {
    expect(shouldConfirmAll(groupOf(3), "@all go")).toBe(false);
    expect(shouldConfirmAll(groupOf(4), "@all go")).toBe(true);
    expect(shouldConfirmAll(groupOf(4), "@所有人 go")).toBe(true);
    expect(shouldConfirmAll(groupOf(4), "@Claude go")).toBe(false);
    expect(shouldConfirmAll({ ...groupOf(4), skipAllWarning: true }, "@all go")).toBe(false);
  });

  it("warns about large groups from eight members", () => {
    expect(isLargeGroup(groupOf(7))).toBe(false);
    expect(isLargeGroup(groupOf(8))).toBe(true);
  });
});

const userRow = (id: string): GroupChatRow => ({
  kind: "user",
  id,
  text: "@all ideas?",
  images: [],
  fileNames: [],
});

describe("group v2 rows", () => {
  const proposal = (id: string, memberId: string, extra: Partial<GroupMemberRowFields> = {}) =>
    ({
      ...(memberRow({ files: [], commands: [] }) as GroupMemberRowFields),
      id,
      memberId: GroupMemberId.makeUnsafe(memberId),
      handle: memberId === "m1" ? "Claude" : "Codex",
      proposeOnly: true,
      ...extra,
    }) as GroupChatRow;
  type GroupMemberRowFields = Extract<GroupChatRow, { kind: "member" }>;

  it("marks passed and proposal replies and keeps the turn", () => {
    const rows = deriveGroupChatRows(
      [{ ...assistant("t1:gm.m1.r1", "…"), turnId: "turn-1" } as OrchestrationMessage],
      group,
      { r1: reply({ status: "empty", passed: true, proposeOnly: true }) },
    );
    expect(rows[0]).toMatchObject({ passed: true, proposeOnly: true, turnId: "turn-1" });
  });

  it("offers Combine and Discuss under the last reply of a round with two proposals", () => {
    const rows = [
      userRow("u1"),
      proposal("a", "m1"),
      proposal("b", "m2"),
      proposal("c", "m1", { passed: true, status: "empty" }),
      userRow("u2"),
      proposal("d", "m1"),
      proposal("e", "m1", { proposeOnly: false }),
    ];
    const ends = proposalRoundEnds(rows);
    expect([...ends.keys()]).toEqual(["c"]);
    expect(ends.get("c")?.map((row) => row.handle)).toEqual(["Claude", "Codex"]);
  });

  it("finds the newest round with file changes and puts Undo under its last reply", () => {
    const rows = [
      proposal("a", "m1", { turnId: "turn-1" }),
      proposal("b", "m2", { turnId: "turn-2" }),
      proposal("c", "m1", { turnId: "turn-2" }),
      proposal("d", "m1", { turnId: "turn-3" }),
    ];
    expect(
      undoableRound(rows, [
        { turnId: "turn-1", files: [{}], checkpointTurnCount: 1, status: "ready" },
        { turnId: "turn-2", files: [{}, {}], checkpointTurnCount: 2, status: "ready" },
        { turnId: "turn-3", files: [], checkpointTurnCount: 3, status: "ready" },
      ]),
    ).toEqual({ rowId: "c", turnCount: 2, files: 2 });
    expect(
      undoableRound(rows, [
        { turnId: "turn-1", files: [{}], checkpointTurnCount: 1, status: "error" },
      ]),
    ).toBeNull();
  });

  it("grades how full a member's context is", () => {
    expect(contextShare(null)).toBeNull();
    expect(contextShare({ usedTokens: 10, maxTokens: null })).toBeNull();
    expect(contextShare({ usedTokens: 75, maxTokens: 100 })).toBe(0.75);
    expect(contextLevel(0.5)).toBe("ok");
    expect(contextLevel(0.75)).toBe("high");
    expect(contextLevel(0.9)).toBe("full");
    expect(contextLevel(null)).toBe("ok");
  });
});

describe("mission mode rows", () => {
  it("hides the messages DJL posted for the user", () => {
    const rows = deriveGroupChatRows(
      [user(`${GROUP_CUE_MESSAGE_PREFIX}1`, "@Claude 👎 try again"), user("u1", "hello")],
      group,
      {},
    );
    expect(rows.map((row) => row.id)).toEqual(["u1"]);
  });

  it("groups members' status reactions apart from the user's own", () => {
    const summary = reactionSummary([
      { groupId, targetId: "r1", actor: "m1", kind: "seen", createdAt: 1 },
      { groupId, targetId: "r1", actor: "m2", kind: "done", createdAt: 2 },
      { groupId, targetId: "r1", actor: "user", kind: "like", createdAt: 3 },
    ]);
    expect(summary.members).toEqual([
      { memberId: "m1", kind: "seen" },
      { memberId: "m2", kind: "done" },
    ]);
    expect([...summary.user]).toEqual(["like"]);
  });

  it("ticks quests off from what happened in the group", () => {
    const rows = deriveGroupChatRows(
      [user("u1", "@all hi"), assistant("t1:gm.m1.r1", "hello")],
      group,
      {},
    );
    const none = questProgress({ group, rows: [], reactions: {}, missions: [] });
    expect(Object.values(none)).toEqual([false, false, false, false]);
    const some = questProgress({
      group,
      rows,
      reactions: { r1: [{ groupId, targetId: "r1", actor: "user", kind: "like", createdAt: 1 }] },
      missions: [],
    });
    expect(some).toEqual({ meet: true, askOne: false, react: true, mission: false });
  });

  it("counts mission progress without skipped steps", () => {
    const mission = {
      steps: [
        { text: "a", memberId: "m1", status: "done" },
        { text: "b", memberId: "m2", status: "skipped" },
        { text: "c", memberId: "m1", status: "running" },
      ],
    } as unknown as Parameters<typeof missionProgress>[0];
    expect(missionProgress(mission)).toEqual({ done: 1, total: 2 });
  });
});

describe("planIntroText", () => {
  it("keeps a plan's intro and drops the checklist the mission card shows", () => {
    const plan = [
      "Plan: build a mini-game.",
      "",
      "- [ ] @Codex define the game",
      "- [ ] @Cursor build it in `index.html`",
      "2. **@Codex** check it",
      "",
      "- a note that names no agent stays",
    ].join("\n");
    expect(planIntroText(plan)).toBe(
      "Plan: build a mini-game.\n\n- a note that names no agent stays",
    );
    expect(planIntroText("- [ ] @Codex only steps")).toBe("");
  });
});

describe("guest messages", () => {
  const guestId = "a1b2c3d4e5f60718";
  const message = (id: string) => ({ id, role: "user" as const, text: "hi" });

  it("carry the guest's name, or an empty name once the guest was removed", () => {
    const withGuest = {
      ...group,
      guests: [{ id: guestId, name: "Alex", role: "chat", createdAt: 1 }],
    };
    const rows = deriveGroupChatRows(
      [message(`group-guest-${guestId}-m1`), message("owner-message")],
      withGuest as unknown as Group,
      {},
    );
    expect(rows[0]).toMatchObject({ kind: "user", guest: "Alex" });
    expect(rows[1]).not.toHaveProperty("guest");
    const afterRemoval = deriveGroupChatRows([message(`group-guest-${guestId}-m1`)], group, {});
    expect(afterRemoval[0]).toMatchObject({ kind: "user", guest: "" });
  });
});
