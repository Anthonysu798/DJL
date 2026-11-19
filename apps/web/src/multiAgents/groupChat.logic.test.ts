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
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveGroupChatRows,
  replyImages,
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
  memberId: GroupMemberId.makeUnsafe("m1"),
  handle: "Claude",
  provider: "claudeAgent",
  role: null,
  text: "done",
  status: "ok",
  error: null,
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
