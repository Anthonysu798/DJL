import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  GroupGuestId,
  GroupId,
  GroupMemberId,
  ProjectId,
  ThreadId,
  type DesktopAgentLink,
  type Group,
} from "@djl/contracts";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { joinErrorText } from "~/multiAgents/agentLinks";
import { GroupGuestsSection } from "~/multiAgents/GroupGuestsSection";
import { useGroupGuestSync } from "~/multiAgents/groupGuestSync";
import { JoinGroupDialog, LentAgentsList, formatInviteCode } from "~/multiAgents/GroupLending";
import { GroupMembersPanel } from "~/multiAgents/GroupMembersPanel";
import { useGroupStore } from "~/multiAgents/groupStore";
import "../../index.css";

const api = vi.hoisted(() => ({
  groups: {
    update: vi.fn(async () => ({})),
    updateMember: vi.fn(async () => ({})),
    removeMember: vi.fn(async () => ({})),
    resetMember: vi.fn(async () => ({})),
    inviteGuest: vi.fn(async () => ({})),
    updateGuest: vi.fn(async () => ({})),
    removeGuest: vi.fn(async () => ({})),
    list: vi.fn(async () => ({ groups: [], replies: [] })),
    onEvent: vi.fn(() => () => {}),
  },
  harnesses: {
    listAccounts: vi.fn(async () => ({
      accounts: [
        { id: "codex", status: "ready" },
        { id: "claudeAgent", status: "ready" },
      ],
    })),
  },
}));
vi.mock("~/nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/nativeApi")>()),
  ensureNativeApi: () => api,
  readNativeApi: () => api,
}));
vi.mock("~/hooks/useProviderModelCatalog", () => ({
  useProviderModelCatalog: () => ({
    modelOptionsByProvider: {
      codex: [{ slug: "gpt-fast", name: "GPT Fast" }],
      claudeAgent: [{ slug: "claude-opus", name: "Claude Opus" }],
    },
  }),
}));

const groupId = GroupId.makeUnsafe("g1");
const guestId = GroupGuestId.makeUnsafe("a1b2c3d4e5f60718");
const bo = { id: guestId, name: "Bo", role: "agent" as const, createdAt: 1 };
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
  guests: [bo],
  members: [
    {
      id: GroupMemberId.makeUnsafe("m1"),
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
      id: GroupMemberId.makeUnsafe("m2"),
      groupId,
      provider: "codex",
      handle: "Bo",
      role: null,
      model: "gpt-visiting",
      position: 1,
      muted: false,
      contextUsage: null,
      guestId,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};
const guestLink = (status: "waiting" | "connected") => ({
  guestId,
  groupId,
  status,
  pairingCode: "ABCDE23456",
  pairingPayloadJson: "{}",
  pairingExpiresAt: Date.now() + 60_000,
  message: null,
});
const lent = (patch: Partial<DesktopAgentLink>): DesktopAgentLink => ({
  id: "link00000001",
  provider: "claudeAgent",
  model: null,
  status: "connected",
  hostName: "Alice's Mac",
  groupName: "Launch team",
  handle: "Bo",
  busy: false,
  message: null,
  createdAt: 1,
  ...patch,
});

/** Feeds the guest links from the fake desktop bridge into the shared store. */
function GuestSyncProbe() {
  useGroupGuestSync();
  return null;
}

type Bridge = NonNullable<typeof window.desktopBridge>;
const setBridge = (remote: Record<string, unknown>) => {
  window.desktopBridge = { remote } as unknown as Bridge;
};
const mount = (node: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>,
  );

beforeEach(() => useGroupStore.getState().reset());
afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
  delete (window as { desktopBridge?: unknown }).desktopBridge;
});

describe("inviting someone's agent", () => {
  it("an invite can be for their agent, with its own instructions", async () => {
    setBridge({ syncGroupGuests: async () => [] });
    await mount(<GroupGuestsSection group={{ ...group, guests: [] }} onError={() => {}} />);
    await page.getByRole("button", { name: "Invite a person" }).click();
    await page.getByRole("textbox", { name: "Their name" }).fill("Bo");
    await page.getByRole("button", { name: "What they can do" }).click();
    await page.getByRole("menuitemradio", { name: "Brings an agent" }).click();
    await expect.element(page.getByText(/answers with their subscription/)).toBeVisible();
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    expect(api.groups.inviteGuest).toHaveBeenCalledWith({ groupId, name: "Bo", role: "agent" });
  });

  it("the row follows the agent: waiting with a code, connected, then away", async () => {
    const desktop: { push: ((links: unknown[]) => void) | null } = { push: null };
    setBridge({
      syncGroupGuests: async () => [guestLink("waiting")],
      onGroupGuests: (listener: (links: unknown[]) => void) => {
        desktop.push = listener;
        listener([guestLink("waiting")]);
        return () => {};
      },
    });
    await mount(
      <>
        <GuestSyncProbe />
        <GroupGuestsSection group={group} onError={() => {}} />
      </>,
    );
    // A person and an agent connect differently, so this is not a choice to change.
    await expect
      .element(page.getByRole("button", { name: "What Bo can do" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText("Brings an agent")).toBeVisible();
    await expect.element(page.getByTestId("group-guest-code")).toHaveTextContent("ABCDE23456");
    await expect.element(page.getByText(/clicks Join a group, and enters/)).toBeVisible();

    const presence = (online: boolean) =>
      useGroupStore
        .getState()
        .applyEvent({ type: "guestAgent.presence", groupId, guestId, online });
    presence(true);
    desktop.push?.([guestLink("connected")]);
    await expect.element(page.getByText("Connected")).toBeVisible();
    await expect.element(page.getByTestId("group-guest-code")).not.toBeInTheDocument();

    presence(false);
    await expect.element(page.getByText("Their computer is offline")).toBeVisible();
    // Its code is used up; the owner makes a new one from the menu.
    await expect.element(page.getByTestId("group-guest-code")).not.toBeInTheDocument();
  });

  it("the visiting member shows whose it is, and leaves together with its invite", async () => {
    await mount(<GroupMembersPanel group={group} onClose={() => {}} onDeleted={() => {}} />);
    await expect
      .element(page.getByTestId("group-member-visiting-Bo"))
      .toHaveTextContent("gpt-visiting");
    // The owner picks models for their own agents only.
    await expect.element(page.getByRole("button", { name: "Model: Bo" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Model: Claude" })).toBeVisible();
    await page.getByRole("button", { name: "Options for Bo" }).first().click();
    await expect
      .element(page.getByRole("menuitem", { name: "Start fresh" }))
      .not.toBeInTheDocument();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    expect(api.groups.removeGuest).toHaveBeenCalledWith({ groupId, guestId });
    expect(api.groups.removeMember).not.toHaveBeenCalled();
  });
});

describe("lending an agent", () => {
  it("formats an invite code as it is typed", () => {
    expect(formatInviteCode("abcde23456")).toBe("ABCDE-23456");
    expect(formatInviteCode(" abc-de 234567890 ")).toBe("ABCDE-23456");
    expect(formatInviteCode("abc")).toBe("ABC");
  });

  it("shows the message written for the user, not Electron's wrapper", () => {
    expect(
      joinErrorText(
        new Error(
          "Error invoking remote method 'desktop:agent-links-join': Error: That invite code did not work. Ask for a new one.",
        ),
      ),
    ).toBe("That invite code did not work. Ask for a new one.");
    expect(joinErrorText(null)).toBe("");
  });

  it("joins a group with a code, the chosen agent and its model", async () => {
    const join = vi.fn(async () => [lent({})]);
    setBridge({ joinGroupAsAgent: join });
    const onOpenChange = vi.fn();
    await mount(<JoinGroupDialog open onOpenChange={onOpenChange} />);
    const submit = page.getByRole("button", { name: "Join", exact: true });
    await expect.element(submit).toBeDisabled();
    await page.getByRole("textbox", { name: "Invite code" }).fill("abcde23456");
    await expect
      .element(page.getByRole("textbox", { name: "Invite code" }))
      .toHaveValue("ABCDE-23456");
    await expect.element(page.getByText(/Join only groups of people you trust/)).toBeVisible();
    await expect.element(page.getByText(/Only Claude can be lent for now/)).toBeVisible();
    // Codex is set up here too, but it cannot run with no tools, so it is not offered.
    await page.getByTestId("join-group-agent").click();
    await expect.element(page.getByRole("menuitemradio", { name: "Claude" })).toBeVisible();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Codex" }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await page.getByTestId("join-group-model").click();
    await page.getByRole("menuitemradio", { name: "Claude Opus" }).click();
    await submit.click();
    expect(join).toHaveBeenCalledWith({
      code: "ABCDE-23456",
      provider: "claudeAgent",
      model: "claude-opus",
    });
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the dialog open and says why when the code does not work", async () => {
    setBridge({
      joinGroupAsAgent: async () => {
        throw new Error("Error invoking remote method 'x': Error: That invite code did not work.");
      },
    });
    const onOpenChange = vi.fn();
    await mount(<JoinGroupDialog open onOpenChange={onOpenChange} />);
    await page.getByRole("textbox", { name: "Invite code" }).fill("abcde23456");
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("That invite code did not work.");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("lists lent agents with their state, and takes one back", async () => {
    const leave = vi.fn(async () => []);
    setBridge({ leaveAgentLink: leave });
    await mount(
      <LentAgentsList
        links={[
          lent({ busy: true }),
          lent({ id: "link00000002", groupName: "Research", status: "offline" }),
          lent({ id: "link00000003", groupName: "Old team", status: "refused" }),
        ]}
      />,
    );
    const rows = page.getByTestId("lent-agent");
    await expect.element(rows.nth(0)).toHaveTextContent("Launch team");
    await expect.element(rows.nth(0)).toHaveTextContent("Claude · Answering…");
    await expect.element(rows.nth(1)).toHaveTextContent("Their computer is offline");
    await expect.element(rows.nth(2)).toHaveTextContent("No longer invited");
    await rows.nth(2).getByRole("button").click();
    await page.getByRole("menuitem", { name: "Leave this group" }).click();
    expect(leave).toHaveBeenCalledWith("link00000003");
  });

  it("shows nothing when no agent is lent", async () => {
    await mount(<LentAgentsList links={[]} />);
    await expect.element(page.getByText("Lent to other groups")).not.toBeInTheDocument();
  });
});
