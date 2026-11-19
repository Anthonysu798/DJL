import "../../index.css";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createCampaign } from "@synara/contracts";
import { SocialPublishingCard } from "./SocialPublishingCard";
const actions = vi.hoisted(() => ({ state: vi.fn(), command: vi.fn(), preview: vi.fn() }));
vi.mock("./socialPublishingClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./socialPublishingClient")>()),
  publishingState: actions.state,
  publishingCommand: actions.command,
  publishingMediaPreview: actions.preview,
}));
const account = {
  id: "account-one",
  provider: "instagram",
  username: "shop",
  displayName: "Shop",
  status: "connected",
  capabilities: { publish: true, metrics: false },
};
const draft = {
  id: "draft-one",
  revision: 3,
  confirmedAt: null,
  content: {
    accountIds: ["account-one"],
    captions: { "account-one": "Final saved caption" },
    caption: "",
    mediaFileIds: ["media"],
    timezone: "America/Toronto",
    scheduledAt: "2030-07-10T16:30:00.000Z",
  },
  tasks: [],
};
const campaign = {
  ...createCampaign("Launch"),
  threadId: "chat",
  platforms: ["instagram", "tiktok"],
  captions: { instagram: "Campaign caption" },
};
function mount(disabled = false, mediaKind: "image" | "video" = "video") {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SocialPublishingCard
        campaign={campaign}
        version={4}
        disabled={disabled}
        mediaKind={mediaKind}
      />
    </QueryClientProvider>,
  );
}
describe("publishing review card", () => {
  beforeEach(() => {
    actions.preview.mockReset();
    actions.preview.mockResolvedValue({
      mimeType: "image/jpeg",
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    });
  });

  it.each([false, true])(
    "requires every saved carousel photo to load (broken second photo: %s)",
    async (broken) => {
      const carousel = {
        ...draft,
        content: {
          ...draft.content,
          publicationMode: "now",
          mediaFileIds: ["media-one", "media-two"],
        },
      };
      actions.state.mockResolvedValue({
        accounts: { accounts: [account], providers: [] },
        drafts: [],
      });
      actions.command.mockReset();
      actions.command.mockResolvedValue(carousel);
      const image =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
        );
      actions.preview.mockResolvedValue({
        mimeType: "image/jpeg",
        url: image,
        media: [
          { url: image, mimeType: "image/jpeg" },
          { url: broken ? "data:image/jpeg;base64,not-an-image" : image, mimeType: "image/jpeg" },
        ],
      });
      const screen = await mount(false, "image");
      await screen.getByRole("switch", { name: "Instagram · Shop (@shop)" }).click();
      await screen.getByRole("button", { name: "Review post", exact: true }).click();
      await expect.element(screen.getByRole("img", { name: "Saved photo 1 of 2" })).toBeVisible();
      const confirm = screen.getByRole("button", { name: "Confirm and publish", exact: true });
      if (broken) {
        await expect.element(screen.getByRole("alert")).toBeVisible();
        await expect.element(confirm).toBeDisabled();
      } else {
        await expect.element(confirm).toBeEnabled();
        await screen.getByRole("button", { name: "Next photo" }).click();
        await expect.element(screen.getByRole("img", { name: "Saved photo 2 of 2" })).toBeVisible();
      }
      expect(actions.command.mock.calls.every((call) => call[2].action === "prepare")).toBe(true);
      await screen.unmount();
    },
  );
  it("keeps past posts behind a switch without issuing publishing actions", async () => {
    const completed = (id: string, updatedAt: string) => ({
      ...draft,
      id,
      updatedAt,
      confirmedAt: updatedAt,
      tasks: [
        {
          id: `${id}-task`,
          accountId: account.id,
          state: "published",
          revision: 3,
          errorCode: null,
        },
      ],
    });
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [
        completed("older", "2029-01-01T00:00:00Z"),
        completed("newer", "2029-02-01T00:00:00Z"),
      ],
    });
    actions.command.mockReset();
    actions.command.mockResolvedValue({
      postUrl: "https://www.instagram.com/p/result/",
      metrics: { views: 1, likes: 0, comments: null, shares: null },
    });
    const screen = await mount();
    await expect.element(screen.getByRole("link", { name: "View published post" })).toBeVisible();
    await expect.element(screen.getByTestId("publishing-draft-summary")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("switch", { name: "Show statistics", exact: true }))
      .not.toBeChecked();
    await screen.getByRole("switch", { name: "Show previous posts", exact: true }).click();
    await expect
      .poll(() => document.querySelectorAll('[data-testid="publishing-draft-summary"]').length)
      .toBe(2);
    await screen.getByRole("switch", { name: "Show previous posts", exact: true }).click();
    await expect.element(screen.getByTestId("publishing-draft-summary")).not.toBeInTheDocument();
    expect(actions.command.mock.calls.every((call) => call[2].action === "metrics")).toBe(true);
    await screen.unmount();
  });

  it("prepares without publishing and requires explicit confirmation of saved captions, account, revision and timezone", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [],
    });
    actions.command.mockReset();
    actions.command.mockResolvedValue(draft);
    const screen = await mount();
    await screen.getByRole("switch", { name: "Instagram · Shop (@shop)" }).click();
    await screen.getByRole("switch", { name: "Schedule for later", exact: true }).click();
    await screen.getByLabelText("Publishing time", { exact: true }).fill("2030-07-10T12:30");
    await screen.getByRole("button", { name: "Review post", exact: true }).click();
    await expect.element(screen.getByText("Final saved caption")).toBeVisible();
    await expect.element(screen.getByText("Ready to post?", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Confirm and schedule publication" }))
      .toBeEnabled();
    expect(actions.preview).toHaveBeenCalledWith(campaign, 4, "draft-one", 3);
    await page.screenshot({ path: "/tmp/djl-social-publishing-review.png" });
    expect(actions.command).toHaveBeenCalledTimes(1);
    expect(actions.command.mock.calls[0]?.[2]).toMatchObject({
      action: "prepare",
      accountIds: ["account-one"],
    });
    await screen.getByRole("button", { name: "Confirm and schedule publication" }).click();
    expect(actions.command.mock.calls[1]?.[2]).toEqual({
      action: "confirm",
      draftId: "draft-one",
      revision: 3,
    });
    await screen.unmount();
  });
  it("prepares publish-now without inventing a future schedule and still requires confirmation", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [],
    });
    actions.command.mockReset();
    actions.command.mockResolvedValue({
      ...draft,
      content: { ...draft.content, publicationMode: "now" },
    });
    const screen = await mount();
    await screen.getByRole("switch", { name: "Instagram · Shop (@shop)" }).click();
    await expect
      .element(screen.getByRole("switch", { name: "Schedule for later", exact: true }))
      .not.toBeChecked();
    await expect
      .element(screen.getByLabelText("Publishing time", { exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Review post", exact: true }).click();
    expect(actions.command.mock.calls[0]?.[2]).toMatchObject({
      action: "prepare",
      publicationMode: "now",
    });
    expect(actions.command.mock.calls[0]?.[2]).not.toHaveProperty("scheduledAt");
    expect(actions.command).toHaveBeenCalledTimes(1);
    await screen.getByRole("button", { name: "Confirm and publish", exact: true }).click();
    expect(actions.command.mock.calls[1]?.[2]).toMatchObject({
      action: "confirm",
      draftId: draft.id,
      revision: draft.revision,
    });
    await screen.unmount();
  });
  it("opens the sole unconfirmed cloud draft directly for one-click confirmation", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [{ ...draft, content: { ...draft.content, publicationMode: "now" } }],
    });
    actions.command.mockReset();
    const screen = await mount();
    await expect.element(screen.getByText("Final saved caption")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Confirm and publish", exact: true }))
      .toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Review saved draft" }))
      .not.toBeInTheDocument();
    expect(actions.command).not.toHaveBeenCalled();
    await screen.unmount();
  });
  it("shows known media preparation as processing without offering an unsafe retry", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [
        {
          ...draft,
          confirmedAt: "2029-01-01T00:00:00Z",
          tasks: [
            {
              id: "preparing",
              accountId: account.id,
              state: "uncertain",
              errorCode: "awaiting_provider",
              publishStartedAt: null,
              revision: 3,
            },
          ],
        },
      ],
    });
    actions.command.mockReset();
    const screen = await mount();
    await expect.element(screen.getByText("Publishing", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByText("awaiting_provider", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Retry this target" }))
      .not.toBeInTheDocument();
    expect(actions.command).not.toHaveBeenCalled();
    await screen.unmount();
  });
  it("scopes retry to failed targets only", async () => {
    actions.state.mockResolvedValue({
      accounts: {
        accounts: [account, { ...account, id: "tiktok-one", provider: "tiktok" }],
        providers: [],
      },
      drafts: [
        {
          ...draft,
          confirmedAt: "2029-01-01T00:00:00Z",
          tasks: [
            {
              id: "failed-target",
              accountId: account.id,
              state: "failed",
              revision: 3,
              errorCode: "rejected",
            },
            {
              id: "uncertain-target",
              accountId: account.id,
              state: "uncertain",
              revision: 3,
              errorCode: null,
            },
          ],
        },
      ],
    });
    actions.command.mockReset();
    actions.command.mockResolvedValue(draft);
    const screen = await mount();
    await expect
      .element(
        screen.getByText(
          "The platform may have accepted this post. Check the account before taking further action; automatic retry is disabled.",
        ),
      )
      .toBeVisible();
    await screen.getByRole("button", { name: "Retry this target" }).click();
    expect(actions.command).toHaveBeenCalledWith(campaign, 4, {
      action: "task",
      taskId: "failed-target",
      revision: 3,
      taskAction: "retry",
    });
    await screen.unmount();
  });
  it("shows unavailable metrics as unavailable rather than zero and uses only returned official links", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [
        {
          ...draft,
          confirmedAt: "2029-01-01T00:00:00Z",
          tasks: [
            {
              id: "published-target",
              accountId: account.id,
              state: "published",
              revision: 3,
              errorCode: null,
            },
          ],
        },
      ],
    });
    actions.command.mockReset();
    actions.command.mockResolvedValue({
      postUrl: "https://www.instagram.com/p/example/",
      metrics: { views: null, likes: 0, comments: 2, shares: null },
    });
    const screen = await mount();
    await expect.element(screen.getByText("Unavailable").first()).not.toBeInTheDocument();
    await screen.getByRole("switch", { name: "Show statistics", exact: true }).click();
    await screen.getByRole("button", { name: "Refresh results" }).click();
    await expect
      .element(screen.getByRole("link", { name: "View published post" }))
      .toHaveAttribute("href", "https://www.instagram.com/p/example/");
    expect(actions.command).toHaveBeenCalledWith(campaign, 4, {
      action: "metrics",
      taskId: "published-target",
      revision: 3,
    });
    await expect.element(screen.getByText("Unavailable").first()).toBeVisible();
    await expect.element(screen.getByText(/^Retrieved /)).toBeVisible();
    await expect
      .element(
        screen.getByText(
          "Draft changes won’t affect this post. Edit and confirm again before publishing.",
        ),
      )
      .not.toBeInTheDocument();
    await screen.unmount();
  });
  it("loads creator settings and requires manual privacy and music agreement before TikTok review", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [{ ...account, id: "tiktok-one", provider: "tiktok" }], providers: [] },
      drafts: [],
    });
    actions.command.mockReset();
    actions.command.mockImplementation(async (_campaign, _version, input) =>
      input.action === "creator-info"
        ? {
            nickname: "Official Creator",
            username: "creator",
            privacyLevels: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
            duetDisabled: true,
            stitchDisabled: false,
            commentDisabled: false,
            maxVideoDurationSeconds: 60,
          }
        : draft,
    );
    const screen = await mount();
    await screen.getByRole("switch", { name: "TikTok · Shop (@shop)" }).click();
    await expect.element(screen.getByText("Official Creator (@creator)")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Review post", exact: true }))
      .toBeDisabled();
    await screen.getByText("Duet and Stitch settings", { exact: true }).click();
    await expect.element(screen.getByRole("switch", { name: "Allow Duet" })).toBeDisabled();
    await expect.element(screen.getByRole("switch", { name: "Allow comments" })).not.toBeChecked();
    await screen
      .getByRole("combobox", { name: "Who can see this post?" })
      .selectOptions("SELF_ONLY");
    await screen
      .getByRole("switch", { name: "This content promotes a brand, product or service" })
      .click();
    await expect
      .element(screen.getByRole("switch", { name: "Branded content for another business" }))
      .toBeDisabled();
    await screen.getByRole("switch", { name: "Your brand", exact: true }).click();
    await screen.getByRole("checkbox", { name: /By posting, you agree/ }).click();
    await page.screenshot({ path: "/tmp/djl-tiktok-publishing-options.png" });
    await screen.getByRole("button", { name: "Review post", exact: true }).click();
    expect(actions.command).toHaveBeenLastCalledWith(
      campaign,
      4,
      expect.objectContaining({
        action: "prepare",
        tiktokOptions: {
          privacyLevel: "SELF_ONLY",
          disableComment: true,
          disableDuet: true,
          disableStitch: true,
          brandContent: false,
          brandOrganic: true,
          isAigc: false,
          musicUsageConfirmed: true,
        },
      }),
    );
    await screen.unmount();
  });
  it("shows photo settings and still requires an explicit audience and fresh branded-content agreement", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [{ ...account, id: "tiktok-one", provider: "tiktok" }], providers: [] },
      drafts: [],
    });
    actions.command.mockReset();
    actions.command.mockImplementation(async (_campaign, _version, input) =>
      input.action === "creator-info"
        ? {
            nickname: "Photo Creator",
            username: "photos",
            privacyLevels: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
            duetDisabled: false,
            stitchDisabled: false,
            commentDisabled: true,
            maxVideoDurationSeconds: 60,
          }
        : { ...draft, content: { ...draft.content, tiktokOptions: input.tiktokOptions } },
    );
    const screen = await mount(false, "image");
    await screen.getByRole("switch", { name: "TikTok · Shop (@shop)" }).click();
    await expect.element(screen.getByText("Photo Creator (@photos)")).toBeVisible();
    await expect.element(screen.getByRole("switch", { name: "Allow comments" })).toBeDisabled();
    await expect
      .element(screen.getByRole("switch", { name: "Allow Duet" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("switch", { name: "Allow Stitch" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Maximum video length: 60 seconds"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("combobox", { name: "Who can see this post?" }))
      .toHaveValue("");
    const agreement = screen.getByRole("checkbox", { name: /By posting, you agree/ });
    await expect.element(agreement).not.toBeChecked();
    await agreement.click();
    await expect
      .element(screen.getByRole("button", { name: "Review post", exact: true }))
      .toBeDisabled();
    await screen
      .getByRole("combobox", { name: "Who can see this post?" })
      .selectOptions("PUBLIC_TO_EVERYONE");
    await expect
      .element(screen.getByRole("button", { name: "Review post", exact: true }))
      .toBeEnabled();
    await screen
      .getByRole("switch", { name: "This content promotes a brand, product or service" })
      .click();
    await expect.element(agreement).not.toBeChecked();
    await agreement.click();
    await expect
      .element(screen.getByRole("button", { name: "Review post", exact: true }))
      .toBeDisabled();
    await screen.getByRole("switch", { name: "Branded content for another business" }).click();
    await expect.element(agreement).not.toBeChecked();
    await expect
      .element(screen.getByRole("link", { name: "Branded Content Policy" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Review post", exact: true }))
      .toBeDisabled();
    await agreement.click();
    await screen.getByRole("switch", { name: "This post contains AI-generated content" }).click();
    await page.screenshot({ path: "/tmp/djl-tiktok-photo-options.png" });
    await screen.getByRole("button", { name: "Review post", exact: true }).click();
    expect(actions.command).toHaveBeenLastCalledWith(
      campaign,
      4,
      expect.objectContaining({
        action: "prepare",
        tiktokOptions: {
          privacyLevel: "PUBLIC_TO_EVERYONE",
          disableComment: true,
          disableDuet: true,
          disableStitch: true,
          brandContent: true,
          brandOrganic: false,
          isAigc: true,
          musicUsageConfirmed: true,
        },
      }),
    );
    await expect
      .element(screen.getByRole("img", { name: "Media saved for this publishing revision" }))
      .toBeVisible();
    await expect.element(screen.getByText("Comments: Off", { exact: true })).toBeVisible();
    expect(actions.command.mock.calls.some((call) => call[2].action === "confirm")).toBe(false);
    await screen.unmount();
  });
  it("edits the saved draft by id and revision and requires a new confirmation", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [
        {
          ...draft,
          confirmedAt: "2029-01-01T00:00:00Z",
          tasks: [
            {
              id: "queued-target",
              accountId: account.id,
              state: "queued",
              revision: 3,
              errorCode: null,
            },
          ],
        },
      ],
    });
    actions.command.mockReset();
    actions.command.mockResolvedValueOnce({
      ...draft,
      revision: 4,
      content: { ...draft.content, captions: { "account-one": "Updated campaign caption" } },
    });
    const screen = await mount();
    await expect
      .element(screen.getByRole("button", { name: "Confirm and schedule publication" }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Edit content or time" }).click();
    await expect
      .element(screen.getByRole("switch", { name: "Instagram · Shop (@shop)" }))
      .toBeChecked();
    await expect
      .element(
        screen.getByText(
          "Reviewing these changes cancels the old schedule. Confirm again to set a new one.",
        ),
      )
      .toBeVisible();
    await screen.getByRole("button", { name: "Review post", exact: true }).click();
    expect(actions.command).toHaveBeenLastCalledWith(
      campaign,
      4,
      expect.objectContaining({
        action: "prepare",
        draftId: "draft-one",
        revision: 3,
        accountIds: ["account-one"],
      }),
    );
    await expect.element(screen.getByText("Updated campaign caption")).toBeVisible();
    expect(actions.command).toHaveBeenCalledTimes(1);
    actions.command.mockRejectedValueOnce(
      new Error("This publishing preview changed. Prepare and review it again."),
    );
    await screen.getByRole("button", { name: "Confirm and schedule publication" }).click();
    expect(actions.command).toHaveBeenLastCalledWith(campaign, 4, {
      action: "confirm",
      draftId: "draft-one",
      revision: 4,
    });
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("This publishing preview changed. Prepare and review it again.");
    await screen.unmount();
  });
  it("blocks confirmation when the immutable cloud preview cannot be loaded", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [],
    });
    actions.command.mockReset();
    actions.command.mockResolvedValue(draft);
    actions.preview.mockRejectedValue(new Error("Preview expired"));
    const screen = await mount();
    await screen.getByRole("switch", { name: "Instagram · Shop (@shop)" }).click();
    await screen.getByRole("button", { name: "Review post", exact: true }).click();
    await expect
      .element(
        screen.getByText(
          "The saved media preview could not load. Prepare the draft again before confirming.",
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Confirm and schedule publication" }))
      .toBeDisabled();
    expect(actions.command).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });
  it("copies only the returned official post URL and reports actual clipboard success", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [
        {
          ...draft,
          confirmedAt: "2029-01-01T00:00:00Z",
          tasks: [
            {
              id: "share-target",
              accountId: account.id,
              state: "published",
              revision: 3,
              errorCode: null,
            },
          ],
        },
      ],
    });
    actions.command.mockReset();
    actions.command.mockResolvedValue({
      postUrl: "https://www.instagram.com/p/real-result/",
      metrics: { views: 15, likes: 0, comments: null, shares: null },
    });
    const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = await mount();
    try {
      await expect
        .element(screen.getByRole("link", { name: "View published post", exact: true }))
        .toHaveAttribute("href", "https://www.instagram.com/p/real-result/");
      await screen.getByRole("button", { name: "Copy link", exact: true }).click();
      await expect
        .element(screen.getByRole("button", { name: "Link copied", exact: true }))
        .toBeVisible();
      expect(clipboard).toHaveBeenCalledWith("https://www.instagram.com/p/real-result/");
      expect(actions.command.mock.calls.every((call) => call[2].action === "metrics")).toBe(true);
    } finally {
      clipboard.mockRestore();
      await screen.unmount();
    }
  });

  it("does not expose share actions for an untrusted upstream URL", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [
        {
          ...draft,
          confirmedAt: "2029-01-01T00:00:00Z",
          tasks: [
            {
              id: "unsafe-link",
              accountId: account.id,
              state: "published",
              revision: 3,
              errorCode: null,
            },
          ],
        },
      ],
    });
    actions.command.mockResolvedValue({
      postUrl: "https://www.instagram.com.evil.example/p/post/",
      metrics: { views: null, likes: null, comments: null, shares: null },
    });
    const screen = await mount();
    await expect.element(screen.getByText("Post link unavailable", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Copy link", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "View published post" }))
      .not.toBeInTheDocument();
    await screen.unmount();
  });

  it("blocks an existing confirmation while campaign content is being edited", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [{ ...draft, content: { ...draft.content, publicationMode: "now" } }],
    });
    actions.command.mockReset();
    const screen = await mount(true);
    await expect
      .element(screen.getByText("Save your content changes before confirming a post."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Confirm and publish", exact: true }))
      .toBeDisabled();
    expect(actions.command).not.toHaveBeenCalled();
    await screen.unmount();
  });
  it("shows readiness from the connected account, loaded preview and saved time", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [{ ...draft, content: { ...draft.content, publicationMode: "now" } }],
    });
    actions.command.mockReset();
    const screen = await mount();
    await expect
      .element(screen.getByText("Ready for your confirmation", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Account connected", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Media preview loaded", { exact: true }))
      .not.toBeInTheDocument();
    expect(document.querySelector('[data-provider="instagram"] svg')).not.toBeNull();
    expect(actions.command).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it("blocks confirmation if the saved account loses its publishing connection", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [{ ...account, status: "expired" }], providers: [] },
      drafts: [{ ...draft, content: { ...draft.content, publicationMode: "now" } }],
    });
    actions.command.mockReset();
    const screen = await mount();
    await expect.element(screen.getByText("Check account", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByText("Ready for your confirmation", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Confirm and publish", exact: true }))
      .toBeDisabled();
    expect(actions.command).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it("does not call an expired schedule ready even when its media can be displayed", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [
        { ...draft, content: { ...draft.content, scheduledAt: "2020-01-01T00:00:00.000Z" } },
      ],
    });
    actions.command.mockReset();
    const screen = await mount();
    await expect.element(screen.getByText("Choose a future time", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Confirm and schedule publication" }))
      .toBeDisabled();
    expect(actions.command).not.toHaveBeenCalled();
    await screen.unmount();
  });
  it("checks the scheduled deadline again when confirmation is clicked", async () => {
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [draft],
    });
    actions.command.mockReset();
    const screen = await mount();
    const confirm = screen.getByRole("button", { name: "Confirm and schedule publication" });
    await expect.element(confirm).toBeEnabled();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(draft.content.scheduledAt) + 1);
    try {
      await confirm.click();
      expect(actions.command).not.toHaveBeenCalled();
      await expect.element(screen.getByRole("alert")).toHaveTextContent(/future/);
    } finally {
      clock.mockRestore();
      await screen.unmount();
    }
  });
  it("preserves an unchanged saved fold instant when editing a schedule", async () => {
    const content = {
      ...draft.content,
      publicationMode: "scheduled",
      scheduledAt: "2030-11-03T06:30:00.000Z",
    };
    actions.state.mockResolvedValue({
      accounts: { accounts: [account], providers: [] },
      drafts: [
        {
          ...draft,
          confirmedAt: "2026-10-27T00:00:00Z",
          content,
          tasks: [{ id: "queued", revision: 3, accountId: account.id, state: "queued" }],
        },
      ],
    });
    actions.command.mockReset();
    actions.command.mockResolvedValue({ ...draft, revision: 4, content });
    const screen = await mount();
    await screen.getByRole("button", { name: "Edit content or time" }).click();
    await expect
      .element(screen.getByLabelText("Publishing time", { exact: true }))
      .toHaveValue("2030-11-03T01:30");
    await screen.getByRole("button", { name: "Review post", exact: true }).click();
    expect(actions.command).toHaveBeenCalledWith(
      campaign,
      4,
      expect.objectContaining({
        action: "prepare",
        draftId: draft.id,
        scheduledAt: "2030-11-03T06:30:00.000Z",
        timezone: "America/Toronto",
      }),
    );
    await screen.unmount();
  });
});
