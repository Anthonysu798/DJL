import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  GroupGuestId,
  GroupId,
  GroupMemberId,
  GroupMissionId,
  ProjectId,
  ThreadId,
  type Group,
  type GroupMission,
} from "@djl/contracts";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import type { GroupMemberRow } from "~/multiAgents/groupChat.logic";
import { GroupComposer, type GroupComposerHandle } from "~/multiAgents/GroupComposer";
import { GroupMessageRow } from "~/multiAgents/GroupMessageRow";
import { GroupMissionCard } from "~/multiAgents/GroupMissionCard";
import { GroupQuests } from "~/multiAgents/GroupQuests";
import { GroupMemberReactions, GroupReactionBar } from "~/multiAgents/GroupReactions";
import { GroupGuestsSection } from "~/multiAgents/GroupGuestsSection";
import { GroupMembersPanel } from "~/multiAgents/GroupMembersPanel";
import { useGroupGuestSync } from "~/multiAgents/groupGuestSync";
import { GroupChoiceMenu } from "~/multiAgents/GroupMenu";
import { GroupReplyActions } from "~/multiAgents/GroupReplyActions";
import { GroupMissionPill, GroupStage, GroupWorkingLabel } from "~/multiAgents/GroupStage";
import "../../index.css";

const api = vi.hoisted(() => ({
  groups: {
    react: vi.fn(async () => {}),
    missionStart: vi.fn(async () => ({})),
    missionStop: vi.fn(async () => ({})),
    missionRemoveStep: vi.fn(async () => ({})),
    missionPlan: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    list: vi.fn(async () => ({ groups: [], replies: [] })),
    onEvent: vi.fn(() => () => {}),
    updateMember: vi.fn(async () => ({})),
    inviteGuest: vi.fn(async () => ({})),
    updateGuest: vi.fn(async () => ({})),
    removeGuest: vi.fn(async () => ({})),
  },
  harnesses: { listAccounts: vi.fn(async () => ({ accounts: [] })) },
  provider: { listSkillsCatalog: vi.fn(async () => ({ skills: [] })) },
}));
vi.mock("~/nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/nativeApi")>()),
  ensureNativeApi: () => api,
  readNativeApi: () => api,
}));

vi.mock("~/hooks/useProviderModelCatalog", () => ({
  useProviderModelCatalog: () => ({
    modelOptionsByProvider: { codex: [{ slug: "gpt-fast", name: "GPT Fast" }], claudeAgent: [] },
  }),
}));

const groupId = GroupId.makeUnsafe("g1");
const claude = GroupMemberId.makeUnsafe("m1");
const codex = GroupMemberId.makeUnsafe("m2");
const group: Group = {
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
  members: [
    {
      id: claude,
      groupId,
      provider: "claudeAgent",
      handle: "Claude",
      role: null,
      model: null,
      position: 0,
      muted: false,
      contextUsage: null,
    },
    {
      id: codex,
      groupId,
      provider: "codex",
      handle: "Codex",
      role: null,
      model: null,
      position: 1,
      muted: false,
      contextUsage: null,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};
const row: GroupMemberRow = {
  kind: "member",
  id: "t1:gm.m1.r1",
  replyId: "r1",
  memberId: claude,
  handle: "Claude",
  provider: "claudeAgent",
  role: null,
  text: "Here is my answer.",
  status: "ok",
  error: null,
  files: [],
  commands: [],
  passed: false,
  proposeOnly: false,
  turnId: null,
};
const mission = (patch: Partial<GroupMission>): GroupMission => ({
  id: GroupMissionId.makeUnsafe("mission-1"),
  groupId,
  goal: "Ship the landing page",
  status: "ready",
  plannerMemberId: claude,
  planReplyId: "r1",
  steps: [
    { text: "build the page", memberId: codex, status: "pending" },
    { text: "check it", memberId: claude, status: "pending" },
  ],
  currentStep: 0,
  stats: { files: [], commands: 0, reviews: 0, replies: 0 },
  createdAt: 1,
  startedAt: null,
  finishedAt: null,
  ...patch,
});

/** Feeds the guest links from the fake desktop bridge into the shared store. */
function GuestSyncProbe() {
  useGroupGuestSync();
  return null;
}

const mount = (node: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>,
  );

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

describe("Mission mode", () => {
  it("a tap reaction asks the agent to act, and a like is only feedback", async () => {
    await mount(<GroupReactionBar group={group} row={row} reactions={[]} />);
    await page.getByRole("button", { name: "Not quite" }).click();
    expect(api.groups.react).toHaveBeenCalledWith({
      groupId,
      replyId: "r1",
      kind: "dislike",
      message:
        "@Claude 👎 That answer is not quite right. Try again with a different, better answer.",
    });
    await page.getByRole("button", { name: "Good" }).click();
    expect(api.groups.react).toHaveBeenLastCalledWith({ groupId, replyId: "r1", kind: "like" });
  });

  it("shows which member picked a message up and how it ended", async () => {
    await mount(
      <GroupMemberReactions
        group={group}
        reactions={[
          { groupId, targetId: "u1", actor: claude, kind: "seen", createdAt: 1 },
          { groupId, targetId: "u1", actor: codex, kind: "done", createdAt: 2 },
        ]}
      />,
    );
    await expect.element(page.getByRole("img", { name: "Claude is on it" })).toBeVisible();
    await expect.element(page.getByRole("img", { name: "Codex answered" })).toBeVisible();
  });

  it("a ready mission can lose a step and start", async () => {
    await mount(<GroupMissionCard group={group} mission={mission({})} />);
    await expect.element(page.getByText("Ship the landing page")).toBeVisible();
    await expect.element(page.getByText("build the page")).toBeVisible();
    await page.getByRole("button", { name: "Remove step" }).first().click();
    expect(api.groups.missionRemoveStep).toHaveBeenCalledWith({
      groupId,
      missionId: "mission-1",
      index: 0,
    });
    await page.getByRole("button", { name: "Start mission" }).click();
    expect(api.groups.missionStart).toHaveBeenCalledWith({
      groupId,
      missionId: "mission-1",
      message: "Start the mission: Ship the landing page",
    });
  });

  it("a paused mission offers retry and skip; a done one shows its recap", async () => {
    await mount(
      <GroupMissionCard
        group={group}
        mission={mission({
          status: "paused",
          steps: [
            { text: "build the page", memberId: codex, status: "failed" },
            { text: "check it", memberId: claude, status: "pending" },
          ],
        })}
      />,
    );
    await page.getByRole("button", { name: "Skip step" }).click();
    expect(api.groups.missionStart).toHaveBeenCalledWith({
      groupId,
      missionId: "mission-1",
      skipCurrent: true,
      message: "Skip that step and go on with the mission.",
    });
    await cleanup();
    await mount(
      <GroupMissionCard
        group={group}
        mission={mission({
          status: "done",
          steps: [
            { text: "build the page", memberId: codex, status: "done" },
            { text: "check it", memberId: claude, status: "done" },
          ],
          stats: { files: ["page.tsx"], commands: 3, reviews: 1, replies: 2 },
          startedAt: 0,
          finishedAt: 125_000,
        })}
      />,
    );
    await expect.element(page.getByText("Mission complete")).toBeVisible();
    await expect.element(page.getByText("1 file changed")).toBeVisible();
    await expect.element(page.getByText("2 minutes")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Copy summary" })).toBeVisible();
  });

  it("the header shows who is working; the working line says what, and for whom", async () => {
    const activity = { kind: "reading", detail: "page.tsx", from: claude } as const;
    await mount(
      <>
        <GroupStage group={group} activities={{ [codex]: activity }} busy={new Set([codex])} />
        <GroupMissionPill mission={mission({ status: "running" })} />
        <GroupWorkingLabel
          group={group}
          member={group.members[1]!}
          activity={activity}
          waiting={false}
        />
      </>,
    );
    await expect.element(page.getByRole("img", { name: "Claude: Ready" })).toBeVisible();
    await expect
      .element(page.getByRole("img", { name: "Codex: Reading page.tsx" }))
      .toHaveAttribute("data-active", "true");
    await expect.element(page.getByText("Codex · Reading page.tsx")).toBeVisible();
    await expect.element(page.getByText("from Claude")).toBeVisible();
    await expect.element(page.getByTestId("group-stage-mission")).toHaveTextContent("0/2");
  });

  it("an answer's extra actions sit in one menu, and Copy confirms itself", async () => {
    const send = vi.fn(async () => true);
    const onReply = vi.fn();
    // The desktop app refuses the browser clipboard API, so Copy must still work without it.
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValue(new Error("Write permission denied."));
    const execCommand = vi.spyOn(document, "execCommand").mockReturnValue(true);
    await mount(
      <div className="group/row">
        <GroupReplyActions group={group} row={row} rows={[row]} send={send} onReply={onReply} />
      </div>,
    );
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Codex" }).click();
    expect(send).toHaveBeenCalledWith({
      text: expect.stringContaining("Please check this answer from Claude."),
    });
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Reply to this" }).click();
    expect(onReply).toHaveBeenCalledWith(row);
    await page.getByRole("button", { name: "Copy" }).click();
    await expect.element(page.getByText("Copied")).toBeVisible();
    expect(writeText).toHaveBeenCalledWith("Here is my answer.");
    expect(execCommand).toHaveBeenCalledWith("copy");
    vi.restoreAllMocks();
  });

  it("settings: every choice is one label and one picker", async () => {
    await mount(<GroupMembersPanel group={group} onClose={() => {}} onDeleted={() => {}} />);
    await page.getByRole("button", { name: "Model: Codex" }).click();
    await page.getByRole("menuitemradio", { name: "GPT Fast" }).click();
    expect(api.groups.updateMember).toHaveBeenCalledWith({
      groupId,
      memberId: codex,
      model: "gpt-fast",
    });
    await page.getByRole("button", { name: "Messages without @ go to" }).click();
    await page.getByRole("menuitemradio", { name: "Everyone" }).click();
    expect(api.groups.update).toHaveBeenCalledWith({ groupId, defaultRecipient: "all" });
    await page.getByRole("button", { name: "Check changes automatically" }).click();
    await page.getByRole("menuitemradio", { name: "Codex" }).click();
    expect(api.groups.update).toHaveBeenLastCalledWith({ groupId, reviewerMemberId: codex });
    await page.getByRole("button", { name: "Options for Claude" }).click();
    await expect.element(page.getByText("Context used · Not reported yet")).toBeVisible();
    await page.getByRole("menuitemcheckbox", { name: "Mute" }).click();
    expect(api.groups.updateMember).toHaveBeenLastCalledWith({
      groupId,
      memberId: claude,
      muted: true,
    });
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByText("Group brief")).not.toBeInTheDocument();
    await page.getByRole("button", { name: "More settings" }).click();
    await expect.element(page.getByText("Group brief")).toBeVisible();
  });

  it("a long model list can be searched", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      slug: `m-${index}`,
      name: index === 7 ? "Sol Large" : `Model ${index}`,
    }));
    await mount(
      <GroupChoiceMenu
        label="Model"
        value="m-0"
        choices={many.map((option) => ({ value: option.slug, label: option.name }))}
        searchPlaceholder="Search models"
        onChange={() => {}}
      />,
    );
    await page.getByRole("button", { name: "Model" }).click();
    await page.getByRole("searchbox", { name: "Search models" }).fill("sol");
    await expect.element(page.getByRole("menuitemradio", { name: "Sol Large" })).toBeVisible();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Model 3" }))
      .not.toBeInTheDocument();
    await page.getByRole("searchbox", { name: "Search models" }).fill("zzz");
    await expect.element(page.getByText("No matches")).toBeVisible();
  });

  it("quests tick off and Try it hands the quest to the chat", async () => {
    window.localStorage.clear();
    const onTry = vi.fn();
    await mount(
      <GroupQuests
        group={group}
        progress={{ meet: true, askOne: false, react: true, mission: false }}
        onTry={onTry}
      />,
    );
    await expect.element(page.getByText("2 of 4")).toBeVisible();
    await expect.element(page.getByTestId("group-quest-meet")).toHaveAttribute("data-done", "true");
    await page.getByTestId("group-quest-mission").getByRole("button", { name: "Try it" }).click();
    expect(onTry).toHaveBeenCalledWith("mission");
  });

  it("Reply shows who is being answered and keeps the input clean", async () => {
    const send = vi.fn(async (_input: { text: string }) => true);
    const handle: { current: GroupComposerHandle | null } = { current: null };
    await mount(
      <GroupComposer group={group} send={send} handle={handle} onExpandImage={() => {}} />,
    );
    handle.current!.replyTo({
      handle: "Codex",
      provider: "codex",
      text: "[index.html](/Users/me/group/index.html) (**Orbit Rush**) is ready.",
    });
    await expect
      .element(page.getByTestId("group-composer-reply"))
      .toHaveTextContent("Replying to Codexindex.html (Orbit Rush) is ready.");
    await expect.element(page.getByTestId("group-composer-input")).toHaveValue("");
    await userEvent.click(page.getByTestId("group-composer-input"));
    await userEvent.keyboard("add a pause button");
    await page.getByRole("button", { name: "Send" }).click();
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        text: "@Codex add a pause button\n> index.html (Orbit Rush) is ready.",
        attachments: [],
      }),
    );
    await expect.element(page.getByTestId("group-composer-reply")).not.toBeInTheDocument();
    handle.current!.replyTo({ handle: "Codex", provider: "codex", text: "Again." });
    await page.getByRole("button", { name: "Cancel reply" }).click();
    await expect.element(page.getByTestId("group-composer-reply")).not.toBeInTheDocument();
  });

  it("a sent reply shows its quote as one quiet line above the user's words", async () => {
    await mount(
      <GroupMessageRow
        cwd="/tmp/g1"
        row={{
          kind: "user",
          id: "u9",
          text: "@Codex add a pause button\n> index.html (Orbit Rush) is ready.",
          images: [],
          fileNames: [],
        }}
      />,
    );
    await expect
      .element(page.getByTestId("group-row-quote"))
      .toHaveTextContent("index.html (Orbit Rush) is ready.");
    await expect.element(page.getByText("@Codex add a pause button")).toBeVisible();
    await expect.element(page.getByText("> index.html")).not.toBeInTheDocument();
  });

  it("People: invite someone, hand over the code, change what they can do, remove them", async () => {
    const guestId = GroupGuestId.makeUnsafe("a1b2c3d4e5f60718");
    const alex = { id: guestId, name: "Alex", role: "chat" as const, createdAt: 1 };
    const links = [
      {
        guestId,
        groupId,
        status: "waiting" as const,
        pairingCode: "ABCDE23456",
        pairingPayloadJson: "{}",
        pairingExpiresAt: Date.now() + 60_000,
        message: null,
      },
    ];
    const renew = vi.fn(async () => links);
    window.desktopBridge = {
      remote: {
        syncGroupGuests: async () => links,
        renewGroupGuestInvite: renew,
        onGroupGuests: (listener: (next: typeof links) => void) => {
          listener(links);
          return () => {};
        },
      },
    } as unknown as NonNullable<typeof window.desktopBridge>;
    try {
      const screen = await mount(
        <>
          <GuestSyncProbe />
          <GroupGuestsSection group={{ ...group, guests: [alex] }} onError={() => {}} />
        </>,
      );
      await expect.element(page.getByText("Waiting for them to join")).toBeVisible();
      await expect.element(page.getByTestId("group-guest-code")).toHaveTextContent("ABCDE23456");
      await page.getByRole("button", { name: "What Alex can do" }).click();
      await page.getByRole("menuitemradio", { name: "Can watch" }).click();
      expect(api.groups.updateGuest).toHaveBeenCalledWith({ groupId, guestId, role: "viewer" });
      await page.getByRole("button", { name: "Options for Alex" }).click();
      await page.getByRole("menuitem", { name: "New invite code" }).click();
      expect(renew).toHaveBeenCalledWith(guestId);
      await page.getByRole("button", { name: "Options for Alex" }).click();
      await page.getByRole("menuitem", { name: "Remove from group" }).click();
      expect(api.groups.removeGuest).toHaveBeenCalledWith({ groupId, guestId });
      await page.getByRole("button", { name: "Invite a person" }).click();
      await page.getByRole("textbox", { name: "Their name" }).fill("  Sam ");
      await page.getByRole("button", { name: "Invite", exact: true }).click();
      expect(api.groups.inviteGuest).toHaveBeenCalledWith({ groupId, name: "Sam", role: "chat" });
      await screen.unmount();
    } finally {
      delete (window as { desktopBridge?: unknown }).desktopBridge;
    }
  });

  it("a guest's message sits on the left under their name", async () => {
    await mount(
      <GroupMessageRow
        cwd="/tmp/g1"
        row={{
          kind: "user",
          id: "group-guest-a1b2c3d4e5f60718-m1",
          guest: "Alex",
          text: "@Claude can you add a pause button?",
          images: [],
          fileNames: [],
        }}
      />,
    );
    const row = page.getByTestId("group-row-guest");
    await expect.element(row).toHaveTextContent("Alex");
    await expect.element(row).toHaveTextContent("guest");
    await expect.element(page.getByText("@Claude can you add a pause button?")).toBeVisible();
  });

  it("the composer's flag turns a message into a mission goal", async () => {
    const send = vi.fn(async () => true);
    const onMission = vi.fn(async (_goal: string) => true);
    await mount(
      <GroupComposer group={group} send={send} onExpandImage={() => {}} onMission={onMission} />,
    );
    await page.getByTestId("group-composer-mission").click();
    await expect
      .element(page.getByTestId("group-composer-input"))
      .toHaveAttribute("placeholder", "Describe the goal for the team…");
    await userEvent.click(page.getByTestId("group-composer-input"));
    await userEvent.keyboard("Ship the landing page");
    await page.getByRole("button", { name: "Send" }).click();
    await vi.waitFor(() => expect(onMission).toHaveBeenCalledWith("Ship the landing page"));
    expect(send).not.toHaveBeenCalled();
    await expect.element(page.getByTestId("group-composer-input")).toHaveValue("");
  });
});
