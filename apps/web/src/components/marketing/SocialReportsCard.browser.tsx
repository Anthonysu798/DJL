import "../../index.css";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createCampaign } from "@synara/contracts";
import { SocialReportsCard } from "./SocialReportsCard";
const actions = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("./socialPublishingClient", () => ({ publishingCommand: actions.command }));
const campaign = { ...createCampaign("Recap"), threadId: "report-chat" };
const state = {
  schedule: {
    id: null,
    draftId: "owned-draft",
    threadId: campaign.threadId,
    enabled: false,
    timezone: "America/Toronto",
    weekday: 1,
    hour: 9,
    minute: 0,
    nextRunAt: null,
  },
  reports: [],
};
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SocialReportsCard campaign={campaign} version={1} draftId="owned-draft" />
    </QueryClientProvider>,
  );
}
describe("weekly recap preferences", () => {
  beforeEach(() => {
    actions.command.mockReset();
    actions.command.mockImplementation(async (_campaign, _version, input) =>
      input.action === "report-schedule"
        ? {
            ...state,
            schedule: {
              ...state.schedule,
              ...input.schedule,
              id: "schedule",
              nextRunAt: input.schedule.enabled ? "2027-03-08T14:00:00Z" : null,
            },
          }
        : state,
    );
  });
  it("starts off and only saves an enabled schedule after the explicit checkbox and save action", async () => {
    await mount();
    const optIn = page.getByRole("checkbox", { name: /Weekly in-chat recap/ });
    await expect.element(optIn).not.toBeChecked();
    await expect.element(page.getByRole("button", { name: "Save preference" })).toBeDisabled();
    expect(actions.command.mock.calls.every(([, , input]) => input.action === "report-state")).toBe(
      true,
    );
    await optIn.click();
    expect(
      actions.command.mock.calls.some(([, , input]) => input.action === "report-schedule"),
    ).toBe(false);
    await page.getByRole("button", { name: "Save preference" }).click();
    await expect
      .poll(
        () =>
          actions.command.mock.calls.find(([, , input]) => input.action === "report-schedule")?.[2],
      )
      .toEqual({
        action: "report-schedule",
        draftId: "owned-draft",
        schedule: { enabled: true, timezone: "America/Toronto", weekday: 1, hour: 9, minute: 0 },
      });
    expect(
      actions.command.mock.calls.some(([, , input]) =>
        ["prepare", "confirm", "task"].includes(input.action),
      ),
    ).toBe(false);
  });
  it("shows provider counts and unavailable metrics without invented totals or performance claims", async () => {
    actions.command.mockResolvedValue({
      ...state,
      reports: [
        {
          id: "report",
          threadId: campaign.threadId,
          periodStart: "2027-03-01T14:00:00Z",
          periodEnd: "2027-03-08T14:00:00Z",
          retrievedAt: "2027-03-08T14:01:00Z",
          publishedPosts: 2,
          inspectedPosts: 2,
          truncated: false,
          partial: true,
          providers: [
            {
              provider: "instagram",
              publishedPosts: 2,
              metrics: { views: null, likes: 3, comments: 0, shares: null },
            },
          ],
          posts: [],
        },
      ],
    });
    await mount();
    await expect.element(page.getByText("2 published posts", { exact: true })).toBeVisible();
    await expect.element(page.getByText("instagram · 2 posts", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText(/platform metrics retrieved/)).toBeVisible();
    await expect.element(page.getByText(/Some platform metrics were unavailable/)).toBeVisible();
    expect(actions.command.mock.calls.every(([, , input]) => input.action === "report-state")).toBe(
      true,
    );
  });
});
