import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GroupId, GroupMemberId, ProjectId, ThreadId, type Group } from "@djl/contracts";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import type { GroupSendInput } from "~/multiAgents/GroupChatView";
import { GroupComposer } from "~/multiAgents/GroupComposer";
import { GroupImageViewer } from "~/multiAgents/GroupImageViewer";
import "../../index.css";

const api = vi.hoisted(() => ({
  provider: {
    listSkillsCatalog: vi.fn(async () => ({
      skills: [
        {
          name: "frontend-design",
          description: "Build polished interfaces",
          path: "/skills/frontend-design/SKILL.md",
          enabled: true,
        },
        { name: "review", path: "/skills/review/SKILL.md", enabled: true },
        { name: "switched-off", path: "/skills/off/SKILL.md", enabled: false },
      ],
    })),
  },
  groups: { update: vi.fn(async () => ({})) },
}));
vi.mock("~/nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/nativeApi")>()),
  ensureNativeApi: () => api,
  readNativeApi: () => api,
}));

const group: Group = {
  id: GroupId.makeUnsafe("g1"),
  threadId: ThreadId.makeUnsafe("t1"),
  projectId: ProjectId.makeUnsafe("p1"),
  name: "Launch team",
  folder: "/tmp/g1",
  folderIsAuto: true,
  hopLimit: 6,
  skipAllWarning: true,
  pendingHandoffs: [],
  brief: "",
  setupRev: 0,
  defaultRecipient: "last",
  reviewerMemberId: null,
  members: [
    {
      id: GroupMemberId.makeUnsafe("m1"),
      groupId: GroupId.makeUnsafe("g1"),
      provider: "claudeAgent",
      handle: "Claude",
      role: null,
      model: null,
      position: 0,
      muted: false,
      contextUsage: null,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

function Harness(props: {
  send: (input: GroupSendInput) => Promise<boolean>;
  group?: Group | undefined;
}) {
  const [preview, setPreview] = useState<ExpandedImagePreview | null>(null);
  return (
    <>
      <GroupComposer group={props.group ?? group} send={props.send} onExpandImage={setPreview} />
      <GroupImageViewer preview={preview} onChange={setPreview} />
    </>
  );
}

async function mount(send = vi.fn(async (_input: GroupSendInput) => true), withGroup?: Group) {
  await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness send={send} group={withGroup} />
    </QueryClientProvider>,
  );
  return send;
}

const input = () => page.getByTestId("group-composer-input");

function attach(...files: File[]) {
  const element = document.querySelector<HTMLInputElement>("[data-testid='group-composer-files']")!;
  const list = new DataTransfer();
  for (const file of files) list.items.add(file);
  Object.defineProperty(element, "files", { configurable: true, value: list.files });
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(async () => {
  await cleanup();
});

describe("GroupComposer", () => {
  it("uses the main chat composer card with a + menu and a round send button", async () => {
    await mount();
    await expect.element(input()).toBeVisible();
    expect(input().element().closest(".chat-composer-surface")).not.toBeNull();
    await expect.element(page.getByRole("button", { name: "Composer extras" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("colours a mention as it is typed and shows who the message goes to", async () => {
    await mount();
    await userEvent.click(input());
    await userEvent.keyboard("hello @Claude ");
    const mirror = page.getByTestId("group-composer-mirror").element();
    await vi.waitFor(() =>
      expect(mirror.querySelector("[data-token='mention']")?.textContent).toBe("@Claude"),
    );
    // The mirror draws the same characters the field holds, so the caret stays aligned.
    expect(mirror.textContent?.replace("\u200b", "")).toBe("hello @Claude ");
    await expect
      .element(page.getByTestId("group-composer-recipients"))
      .toHaveTextContent("Sends to Claude");
  });

  it("says where a message without @ goes when the group has a lead or sends to everyone", async () => {
    await mount(undefined, { ...group, defaultRecipient: group.members[0]!.id });
    await userEvent.click(input());
    await userEvent.keyboard("plan it");
    await expect
      .element(page.getByTestId("group-composer-recipients"))
      .toHaveTextContent("Sends to Claude");
    await cleanup();
    await mount(undefined, { ...group, defaultRecipient: "all" });
    await userEvent.click(input());
    await userEvent.keyboard("ideas?");
    await expect
      .element(page.getByTestId("group-composer-recipients"))
      .toHaveTextContent("Sends to everyone");
    await cleanup();
    await mount();
    await userEvent.click(input());
    await userEvent.keyboard("and then?");
    await expect.element(page.getByTestId("group-composer-recipients")).not.toBeInTheDocument();
  });

  it("starts a mention from the @ button", async () => {
    await mount();
    await page.getByRole("button", { name: "Mention an agent" }).click();
    await expect.element(input()).toHaveValue("@");
    await expect.element(page.getByRole("option", { name: /@Claude/ })).toBeVisible();
  });

  it("opens the skill menu on $ and sends the chosen skill", async () => {
    const send = await mount();
    await userEvent.click(input());
    await userEvent.keyboard("Try $fro");
    await expect.element(page.getByText("frontend-design", { exact: true })).toBeVisible();
    expect(page.getByText("switched-off").elements()).toHaveLength(0);

    await userEvent.keyboard("{Enter}");
    await expect.element(input()).toHaveValue("Try $frontend-design ");
    await userEvent.keyboard("now{Enter}");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Try $frontend-design now",
        skills: [{ name: "frontend-design", path: "/skills/frontend-design/SKILL.md" }],
      }),
    );
  });

  it("shows attached images as thumbnails that open full size, and sends them", async () => {
    const send = await mount();
    attach(
      new File(["png"], "screen.png", { type: "image/png" }),
      new File(["md"], "notes.md", { type: "text/markdown" }),
    );
    const thumbnail = page.getByRole("button", { name: "Preview screen.png" });
    await expect.element(thumbnail).toBeVisible();
    await expect.element(page.getByText("notes.md")).toBeVisible();

    await thumbnail.click();
    await expect
      .element(page.getByRole("dialog", { name: "Expanded image preview" }))
      .toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(page.getByRole("dialog", { name: "Expanded image preview" }).elements()).toHaveLength(0);

    await userEvent.click(input());
    await userEvent.keyboard("@Claude look{Enter}");
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    const sent = send.mock.calls[0]![0];
    expect(
      sent.attachments?.map((entry) => [entry.type, "name" in entry ? entry.name : ""]),
    ).toEqual([
      ["image", "screen.png"],
      ["file", "notes.md"],
    ]);
    await expect
      .element(page.getByRole("button", { name: "Preview screen.png" }))
      .not.toBeInTheDocument();
  });
});
