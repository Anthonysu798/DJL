import "../../index.css";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MultiPostJob, MultiPostState } from "@djl/contracts";
import { MultiPostChatCard } from "./MultiPostChatCard";

const api = vi.hoisted(() => ({ state: vi.fn(), command: vi.fn() }));
vi.mock("./client", () => ({
  multiPostState: api.state,
  multiPostCommand: api.command,
  mediaPreviewUrl: (_thread: string, url: string) => url,
}));
const seeAll = vi.fn();
const job = (id: string, extra: Partial<MultiPostJob> = {}) =>
  ({
    id,
    workspaceId: "workspace",
    threadId: "chat",
    draftId: `draft-${id}`,
    revision: 1,
    accountId: "ig",
    adapterId: "DYNAMIC_INSTAGRAM",
    snapshot: { data: { title: "", content: "Meet DJL 👋 #BuiltWithDJL" } },
    target: { accountId: "ig", adapterId: "DYNAMIC_INSTAGRAM" },
    state: "published",
    dueAt: "2026-11-19T23:10:00.000Z",
    submittedAt: "2026-11-19T23:10:39.000Z",
    grantId: null,
    evidence: {
      state: "published",
      message: "Instagram confirmed that the post was shared.",
      observedAt: "2026-11-19T23:10:51.000Z",
    },
    error: null,
    createdAt: "2026-11-19T23:10:00.000Z",
    updatedAt: "2026-11-19T23:10:51.000Z",
    ...extra,
  }) as MultiPostJob;
let state: MultiPostState;
const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MultiPostChatCard threadId="chat" onSeeAll={seeAll} />
    </QueryClientProvider>,
  );
beforeEach(() => {
  state = {
    accounts: [
      {
        id: "ig",
        workspaceId: "workspace",
        platformKey: "instagram",
        label: "Instagram 3",
        status: "connected",
        identity: { provider: "instagram", accountId: "1", username: "djl.app", verifiedAt: "" },
        createdAt: "",
      },
    ],
    drafts: [],
    jobs: [],
    workflows: [],
    grants: [],
    capabilities: [
      {
        id: "DYNAMIC_INSTAGRAM",
        platformKey: "instagram",
        kind: "dynamic",
        displayName: "Instagram",
        homeUrl: "https://www.instagram.com",
        injectUrl: "https://www.instagram.com",
        identitySupported: true,
      },
    ],
    runtimeAvailable: true,
  } as MultiPostState;
  api.state.mockReset().mockImplementation(async () => structuredClone(state));
  api.command.mockReset().mockResolvedValue({});
  seeAll.mockClear();
});

it("says in one line that the post is live and where to view it", async () => {
  state.jobs = [
    job("new"),
    job("old", {
      state: "failed",
      error: "fetch failed",
      evidence: null,
      submittedAt: null,
      createdAt: "2026-11-19T21:57:00.000Z",
    }),
  ];
  const screen = await mount();
  await expect.element(page.getByText("Your post is live on Instagram.")).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "View it" }))
    .toHaveAttribute("href", "https://www.instagram.com/djl.app/");
  // Nothing else from the post, and nothing from older ones.
  expect(document.querySelectorAll(".mp-result-line")).toHaveLength(1);
  await expect.element(page.getByText("Meet DJL")).not.toBeInTheDocument();
  await expect.element(page.getByText("Instagram confirmed")).not.toBeInTheDocument();
  await expect.element(page.getByText("fetch failed")).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "All posts" }).click();
  expect(seeAll).toHaveBeenCalledOnce();
  await screen.unmount();
});

it("shows progress, then a plain failure with one way forward", async () => {
  state.jobs = [job("new", { state: "submitting", evidence: null })];
  const screen = await mount();
  await expect.element(page.getByText("Posting to Instagram…")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "All posts" })).not.toBeInTheDocument();
  state.jobs = [job("new", { state: "failed", error: "fetch failed", submittedAt: null })];
  await expect
    .element(page.getByText("Couldn't post to Instagram."), { timeout: 6000 })
    .toBeVisible();
  await expect.element(page.getByText("fetch failed")).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Try again" }).click();
  expect(api.command).toHaveBeenCalledWith("chat", { action: "retry-job", jobId: "new" });
  await screen.unmount();
});

it("points to Activity when a post needs the person, and names the account when a platform has two", async () => {
  state.accounts.push({ ...state.accounts[0]!, id: "ig-2", label: "Shop Instagram" });
  state.jobs = [job("new", { state: "needs-login", evidence: null, submittedAt: null })];
  const screen = await mount();
  await expect.element(page.getByText("Your Instagram 3 post needs you.")).toBeVisible();
  await page.getByRole("button", { name: "See what to do" }).click();
  expect(seeAll).toHaveBeenCalledOnce();
  await screen.unmount();
});

it("counts down an Autopilot post and stops it when the person says so", async () => {
  state.jobs = [
    job("new", {
      state: "queued",
      autopilot: true,
      evidence: null,
      submittedAt: null,
      dueAt: new Date(Date.now() + 9000).toISOString(),
      snapshot: { scheduledAt: null, data: { title: "", content: "Hello" } },
    } as Partial<MultiPostJob>),
  ];
  const screen = await mount();
  await expect.element(page.getByText(/Posting to Instagram in \d…/)).toBeVisible();
  await page.getByRole("button", { name: "Don't post" }).click();
  expect(api.command).toHaveBeenCalledWith("chat", { action: "cancel-job", jobId: "new" });
  await screen.unmount();
});

it("says it is trying again by itself after the connection dropped", async () => {
  state.jobs = [
    job("new", {
      state: "queued",
      evidence: null,
      submittedAt: null,
      retriedAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 25_000).toISOString(),
      snapshot: { scheduledAt: null, data: { title: "", content: "Hello" } },
    } as Partial<MultiPostJob>),
  ];
  const screen = await mount();
  await expect
    .element(page.getByText(/The connection dropped\. Trying Instagram again in \d+…/))
    .toBeVisible();
  await page.getByRole("button", { name: "Don't post" }).click();
  expect(api.command).toHaveBeenCalledWith("chat", { action: "cancel-job", jobId: "new" });
  await screen.unmount();
});

it("reminds the person to keep DJL open for a scheduled post", async () => {
  const at = new Date(Date.now() + 86_400_000).toISOString();
  state.jobs = [
    job("new", {
      state: "queued",
      evidence: null,
      submittedAt: null,
      dueAt: at,
      snapshot: { scheduledAt: at, data: { title: "", content: "Hello" } },
    } as Partial<MultiPostJob>),
  ];
  const screen = await mount();
  await expect
    .element(page.getByText(/Scheduled for Instagram: .*Keep DJL open then\./))
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Don't post" })).not.toBeInTheDocument();
  await screen.unmount();
});
