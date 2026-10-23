import chineseCatalog from "../../i18n/locales/zh-Hans.json";
import { page } from "vitest/browser";
import { MessageId } from "@synara/contracts";
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
import { createCampaign, reviseCampaign } from "@synara/contracts";
import { MarketingChatCard } from "./MarketingChatCards";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="760" height="300"><rect width="760" height="300" fill="#e7e4dd"/><rect x="275" y="42" width="210" height="216" rx="18" fill="#fbfaf7"/><text x="380" y="140" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#444b44">Everyday essentials</text><text x="380" y="174" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#737970">UI DEMO</text></svg>';
  return {
    ...actual,
    mediaUrl: (id: string, rendered = false, download = false) =>
      id === "preview-image"
        ? "data:image/svg+xml," + encodeURIComponent(svg) + "#"
        : actual.mediaUrl(id, rendered, download),
  };
});

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
    await screen.getByRole("tab", { name: "小红书" }).click();
    await expect.element(screen.getByText("下一段旅程")).toBeVisible();
    await screen.getByRole("button", { name: "Make it shorter" }).click();
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
    await screen.getByRole("button", { name: "Edit copy" }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Caption" }))
      .toHaveValue("Original copy");
    await screen.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(screen.getByText("Original copy")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Review & publish" })).toBeDisabled();
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
    await expect.element(screen.getByText("DJL 已为你准备好")).toBeVisible();
    await screen.getByRole("tab", { name: "小红书" }).click();
    await expect.element(screen.getByText("让日常，简单一点。", { exact: false })).toBeVisible();
    const container = document.querySelector("[data-chat-scroll-container]") as HTMLElement;
    container.scrollTop = 0;
    await page.screenshot({ element: container, path: "/tmp/djl-marketing-chat-inline.png" });
    await screen.getByRole("button", { name: "预览并发布", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "确认并下载发布包" })).toBeVisible();
  } finally {
    await screen.unmount();
    html.style.cssText = previousStyle;
    await rendererI18n.changeLanguage("en");
  }
});
