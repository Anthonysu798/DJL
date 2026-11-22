import chineseCatalog from "../../i18n/locales/zh-Hans.json";
import { page } from "vitest/browser";
import { MessageId } from "@djl/contracts";
import { MessagesTimeline } from "../chat/MessagesTimeline";
import { rendererI18n } from "../../i18n";
import {
  buildThemeCssVariables,
  resolveThemePack,
  DEFAULT_THEME_STATE,
} from "../../theme/theme.logic";
import "../../index.css";
import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createCampaign, reviseCampaign } from "@djl/contracts";
import { MarketingChatCard } from "./MarketingChatCards";

const mediaEdits = vi.hoisted(() => ({ import: vi.fn(), command: vi.fn() }));
vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="760" height="300"><rect width="760" height="300" fill="#e7e4dd"/><rect x="275" y="42" width="210" height="216" rx="18" fill="#fbfaf7"/><text x="380" y="140" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#444b44">Everyday essentials</text><text x="380" y="174" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#737970">UI DEMO</text></svg>';
  return {
    ...actual,
    importMedia: mediaEdits.import,
    command: mediaEdits.command,
    mediaUrl: (id: string, rendered = false, download = false) =>
      id === "preview-image"
        ? "data:image/svg+xml," + encodeURIComponent(svg) + "#"
        : actual.mediaUrl(id, rendered, download),
  };
});

const publishingStatus = vi.hoisted(() => vi.fn());
const creatorInfo = vi.hoisted(() => vi.fn());
vi.mock("./socialPublishingClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./socialPublishingClient")>()),
  publishingState: publishingStatus,
  publishingCommand: creatorInfo,
}));

describe("beginner marketing chat card", () => {
  it("shows platform-specific previews and sends a natural-language revision request", async () => {
    const campaign = reviseCampaign(createCampaign("Room campaign"), {
      platforms: ["instagram", "red"],
      captions: { instagram: "Your next stay", red: "下一段旅程" },
    });
    const onPrompt = vi.fn(async () => true);
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <MarketingChatCard
          record={{ value: campaign, version: 1 }}
          assets={[]}
          threadId="chat-1"
          isWorking={false}
          onPrompt={onPrompt}
        />
      </QueryClientProvider>,
    );
    await expect.element(screen.getByText("Your next stay")).toBeVisible();
    await screen.getByRole("button", { name: "Review post" }).click();
    await expect
      .element(page.getByRole("button", { name: "Edit copy", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Make it shorter", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Social tools", exact: true }))
      .not.toBeInTheDocument();
    await page.getByRole("switch", { name: "Edit post", exact: true }).click();
    await page.getByRole("tab", { name: "小红书" }).click();
    await expect.element(page.getByRole("dialog").getByText("下一段旅程")).toBeVisible();
    await page.getByRole("button", { name: "Make it shorter" }).click();
    expect(onPrompt).toHaveBeenCalledWith(
      expect.stringContaining("marketing campaign captions shorter"),
    );
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining(campaign.id));
    await screen.unmount();
  });
  it("keeps the editing UI in the card and does not imply a successful publication", async () => {
    const campaign = reviseCampaign(createCampaign("Draft"), {
      platforms: ["instagram"],
      captions: { instagram: "Original copy" },
    });
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <MarketingChatCard
          record={{ value: campaign, version: 1 }}
          assets={[]}
          threadId="chat-2"
          isWorking={false}
        />
      </QueryClientProvider>,
    );
    await screen.getByRole("button", { name: "Review post" }).click();
    await page.getByRole("switch", { name: "Edit post", exact: true }).click();
    await page.getByRole("button", { name: "Edit copy" }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Caption" }))
      .toHaveValue("Original copy");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(page.getByRole("dialog").getByText("Original copy")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Export for manual posting" }))
      .toBeDisabled();
    await screen.unmount();
  });
});

it("renders the review card inside a real short chat transcript", async () => {
  await page.viewport(1000, 1000);
  const html = document.documentElement;
  const previousStyle = html.style.cssText;
  for (const [key, value] of Object.entries(
    buildThemeCssVariables(resolveThemePack(DEFAULT_THEME_STATE, "light"), "light").variables,
  ))
    html.style.setProperty(key, value);
  rendererI18n.addResourceBundle("zh-Hans", "chat", chineseCatalog.chat, true, true);
  await rendererI18n.changeLanguage("zh-Hans");
  const campaign = reviseCampaign(createCampaign("新品发布 · 界面演示"), {
    assetIds: ["preview-image"],
    platforms: ["instagram", "red"],
    captions: {
      instagram: "Make room for a little simplicity.\n\n[UI demo — no live advertisement]",
      red: "让日常，简单一点。\n\n把喜欢的细节，留在触手可及的地方。\n\n#新品灵感 #日常美学\n（界面演示，非真实广告）",
    },
  });
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <div
        style={{
          width: 850,
          height: 940,
          background: "var(--background)",
          color: "var(--foreground)",
        }}
      >
        <MessagesTimeline
          hasMessages
          isWorking={false}
          activeTurnInProgress={false}
          activeTurnStartedAt={null}
          timelineEntries={[
            {
              id: "demo-user-entry",
              kind: "message",
              createdAt: "2026-10-22T12:00:00Z",
              message: {
                id: MessageId.makeUnsafe("demo-user"),
                role: "user",
                text: "帮我准备 Instagram 和小红书的新品宣传，简洁、有质感。",
                createdAt: "2026-10-22T12:00:00Z",
                streaming: false,
              },
            },
            {
              id: "demo-assistant-entry",
              kind: "message",
              createdAt: "2026-10-22T12:00:01Z",
              message: {
                id: MessageId.makeUnsafe("demo-assistant"),
                role: "assistant",
                text: "可以在下面直接修改文案，或者告诉我换一种风格。确认后，我会整理成一个发布包。",
                createdAt: "2026-10-22T12:00:01Z",
                streaming: false,
              },
            },
          ]}
          turnDiffSummaryByAssistantMessageId={new Map()}
          nowIso="2026-10-22T12:00:02Z"
          expandedWorkGroups={{}}
          onToggleWorkGroup={() => {}}
          onOpenTurnDiff={() => {}}
          revertTurnCountByUserMessageId={new Map()}
          onRevertUserMessage={() => {}}
          isRevertingCheckpoint={false}
          onImageExpand={() => {}}
          markdownCwd={undefined}
          resolvedTheme="light"
          timestampFormat="locale"
          workspaceRoot={undefined}
          marketingCards={
            <div className="mx-auto max-w-3xl px-5 py-4">
              <MarketingChatCard
                record={{ value: campaign, version: 1 }}
                assets={[
                  {
                    id: "preview-image",
                    name: "UI demo",
                    mime: "image/png",
                    bytes: 100,
                    width: 760,
                    height: 300,
                    createdAt: "2026-10-22T12:00:00Z",
                  },
                ]}
                threadId="fixture-chat"
                isWorking={false}
                onPrompt={async () => false}
              />
            </div>
          }
        />
      </div>
    </QueryClientProvider>,
  );
  try {
    await expect.element(screen.getByText("新品发布 · 界面演示")).toBeVisible();
    await screen.getByRole("button", { name: "审核帖子" }).click();
    await page.getByRole("switch", { name: "修改内容", exact: true }).click();
    await page.getByRole("tab", { name: "小红书" }).click();
    await expect
      .element(page.getByRole("dialog").getByText("让日常，简单一点。", { exact: false }))
      .toBeVisible();
    const container = document.querySelector("[data-chat-scroll-container]") as HTMLElement;
    container.scrollTop = 0;
    await page.screenshot({ element: container, path: "/tmp/djl-marketing-chat-inline.png" });
    await page.getByRole("button", { name: "导出以手动发布", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "确认并下载发布包" })).toBeVisible();
  } finally {
    await screen.unmount();
    html.style.cssText = previousStyle;
    await rendererI18n.changeLanguage("en");
  }
});

it("keeps publishing controls out of the transcript and restores focus after closing review", async () => {
  const campaign = reviseCampaign(createCampaign("Compact review"), {
    platforms: ["instagram"],
    captions: { instagram: "A short preview" },
  });
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <MarketingChatCard
        record={{ value: campaign, version: 1 }}
        assets={[]}
        threadId="compact"
        isWorking={false}
      />
    </QueryClientProvider>,
  );
  await expect.element(screen.getByRole("button", { name: "Review post" })).toBeVisible();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Edit copy" })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Review post" }).click();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Review post" })).toHaveFocus();
  await screen.unmount();
});

it("keeps partial publishing results visible while the modal is closed", async () => {
  publishingStatus.mockResolvedValue({
    drafts: [{ tasks: [{ state: "published" }, { state: "failed" }] }],
    accounts: { accounts: [], providers: [] },
  });
  const campaign = { ...createCampaign("Partial result"), threadId: "partial" };
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <MarketingChatCard
        record={{ value: campaign, version: 1 }}
        assets={[]}
        threadId="partial"
        isWorking={false}
      />
    </QueryClientProvider>,
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent("Published / Failed");
  await expect.element(screen.getByRole("status")).toHaveTextContent("Publishing history");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await screen.unmount();
});

it("replaces media through the import API and binds the campaign update to its current version", async () => {
  publishingStatus.mockResolvedValue({ drafts: [], accounts: { accounts: [], providers: [] } });
  mediaEdits.import.mockResolvedValue({ value: { id: "replacement-media" }, version: 1 });
  mediaEdits.command.mockResolvedValue({});
  const campaign = {
    ...createCampaign("Replace media test"),
    threadId: "replace-chat",
    platforms: ["instagram"],
  };
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <MarketingChatCard
        record={{ value: campaign, version: 7 }}
        assets={[]}
        threadId="replace-chat"
        isWorking={false}
      />
    </QueryClientProvider>,
  );
  await screen.getByRole("button", { name: "Review post" }).click();
  await page.getByRole("switch", { name: "Edit post", exact: true }).click();
  const picker = document.querySelector<HTMLInputElement>(
    "input[type=file][accept='image/*,video/mp4']",
  )!;
  const transfer = new DataTransfer();
  const file = new File(["test-image"], "replacement.png", { type: "image/png" });
  transfer.items.add(file);
  picker.files = transfer.files;
  picker.dispatchEvent(new Event("change", { bubbles: true }));
  await expect.poll(() => mediaEdits.command.mock.calls.length).toBeGreaterThan(0);
  expect(mediaEdits.import).toHaveBeenCalledWith(file, expect.any(AbortSignal));
  expect(mediaEdits.command).toHaveBeenCalledWith({
    action: "update",
    id: campaign.id,
    version: 7,
    patch: { assetIds: ["replacement-media"] },
  });
  await screen.unmount();
});

it("keeps preview and publish controls inside a narrow viewport", async () => {
  await page.viewport(390, 844);
  publishingStatus.mockResolvedValue({ drafts: [], accounts: { accounts: [], providers: [] } });
  const campaign = {
    ...createCampaign("Mobile review"),
    threadId: "mobile",
    platforms: ["instagram"],
  };
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <MarketingChatCard
        record={{ value: campaign, version: 1 }}
        assets={[]}
        threadId="mobile"
        isWorking={false}
      />
    </QueryClientProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Review post" }).click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    const modal = document.querySelector<HTMLElement>(".publishing-review-modal")!;
    expect(modal.getBoundingClientRect().right).toBeLessThanOrEqual(390);
    expect(modal.scrollWidth).toBeLessThanOrEqual(modal.clientWidth + 1);
    await expect
      .element(page.getByRole("heading", { name: "Instagram", exact: true }))
      .toBeVisible();
  } finally {
    await screen.unmount();
    await page.viewport(1000, 1000);
  }
});

it("uses the selected JPEG asset for TikTok photo settings in the chat review modal", async () => {
  await page.viewport(1100, 1100);
  const html = document.documentElement;
  const previousStyle = html.style.cssText;
  for (const [key, value] of Object.entries(
    buildThemeCssVariables(resolveThemePack(DEFAULT_THEME_STATE, "light"), "light").variables,
  ))
    html.style.setProperty(key, value);
  publishingStatus.mockResolvedValue({
    drafts: [],
    accounts: {
      accounts: [
        {
          id: "photo-account",
          provider: "tiktok",
          username: "ui_demo",
          displayName: "UI Demo",
          status: "connected",
          capabilities: { publish: true, metrics: false },
        },
      ],
      providers: [],
    },
  });
  creatorInfo.mockResolvedValue({
    nickname: "UI Demo",
    username: "ui_demo",
    privacyLevels: ["SELF_ONLY"],
    duetDisabled: false,
    stitchDisabled: false,
    commentDisabled: false,
    maxVideoDurationSeconds: 60,
  });
  const campaign = {
    ...createCampaign("TikTok photo · UI demo"),
    threadId: "photo-chat",
    platforms: ["tiktok"],
    assetIds: ["preview-image"],
    captions: { tiktok: "Everyday essentials. UI demo — no live post." },
  };
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <MarketingChatCard
        record={{ value: campaign, version: 1 }}
        assets={[
          {
            id: "preview-image",
            name: "UI demo",
            mime: "image/jpeg",
            bytes: 100,
            createdAt: "2026-10-22T12:00:00Z",
          },
        ]}
        threadId="photo-chat"
        isWorking={false}
      />
    </QueryClientProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Review post", exact: true }).click();
    await page.getByRole("switch", { name: "TikTok · UI Demo (@ui_demo)" }).click();
    await expect.element(page.getByText("UI Demo (@ui_demo)", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Duet and Stitch settings", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText("Maximum video length: 60 seconds"))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("combobox", { name: "Who can see this post?" }))
      .toHaveValue("");
    await expect
      .element(page.getByRole("checkbox", { name: /By posting, you agree/ }))
      .not.toBeChecked();
    await page.screenshot({ path: "/tmp/djl-tiktok-photo-chat-modal.png" });
    expect(creatorInfo.mock.calls.every((call) => call[2].action === "creator-info")).toBe(true);
  } finally {
    await screen.unmount();
    html.style.cssText = previousStyle;
  }
});
