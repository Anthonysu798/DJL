import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createCampaign } from "@djl/contracts";
import type { CloudSocialDraft } from "@djl/contracts/cloud";
import { resetSocialAccountCache } from "./accountCache";
import { SocialReviewShare } from "./SocialReviewShare";
const actions = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("./socialPublishingClient", () => ({ publishingCommand: actions.command }));
const campaign = { ...createCampaign("Synthetic review"), threadId: "synthetic-chat" };
const draft: CloudSocialDraft = {
  id: "draft",
  userId: "user",
  orgId: "org",
  threadId: "synthetic-chat",
  revision: 1,
  content: {
    caption: "Synthetic",
    captions: {},
    mediaFileIds: ["file"],
    accountIds: [],
    scheduledAt: "2030-01-01T00:00:00Z",
    timezone: "UTC",
  },
  confirmedAt: null,
  updatedAt: "2026-10-27T00:00:00Z",
  tasks: [],
};
describe("owner review sharing in Agent Chat", () => {
  it("requires explicit disclosure before creation and keeps the URL in owner copy state", async () => {
    actions.command.mockReset();
    const link = {
      id: "link",
      draftId: "draft",
      revision: 1,
      createdAt: "2026-10-27T00:00:00Z",
      expiresAt: "2030-01-01T00:00:00Z",
      revokedAt: null,
      isCurrent: true,
      feedback: [],
    };
    let created = false;
    actions.command.mockImplementation(async (_campaign, _version, input) => {
      if (input.action === "create-review-link") {
        created = true;
        return {
          link,
          token: "synthetic-token",
          reviewPath: "/social/review#token=synthetic-token",
          reviewUrl: "https://example.invalid/social/review#token=synthetic-token",
        };
      }
      return created ? [link] : [];
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={client}>
        <SocialReviewShare campaign={campaign} version={2} draft={draft} />
      </QueryClientProvider>,
    );
    try {
      await screen.getByRole("button", { name: "Share for review" }).click();
      await expect
        .element(screen.getByRole("button", { name: "Create review link" }))
        .toBeDisabled();
      await screen.getByRole("checkbox").click();
      await screen.getByRole("button", { name: "Create review link" }).click();
      await expect
        .element(screen.getByRole("textbox", { name: "Review link", exact: true }))
        .toHaveValue("https://example.invalid/social/review#token=synthetic-token");
      expect(actions.command).toHaveBeenCalledWith(campaign, 2, {
        action: "create-review-link",
        draftId: "draft",
        revision: 1,
        expiresInHours: 72,
        disclosureAccepted: true,
      });
      expect(
        actions.command.mock.calls.every(
          (call) => !["confirm", "schedule", "publish"].includes(call[2].action),
        ),
      ).toBe(true);
      await expect
        .element(screen.getByText(/Publishing still requires your final confirmation/))
        .toBeVisible();
    } finally {
      await screen.unmount();
      client.clear();
    }
  });
  it("labels stale approvals and reviewer names as unverified and permits revocation", async () => {
    actions.command.mockReset();
    let revoked = false;
    actions.command.mockImplementation(async (_campaign, _version, input) => {
      if (input.action === "revoke-review-link") {
        revoked = true;
        return { revoked: true };
      }
      return [
        {
          id: "old-link",
          draftId: "draft",
          revision: 1,
          createdAt: "2026-10-27T00:00:00Z",
          expiresAt: "2030-01-01T00:00:00Z",
          revokedAt: revoked ? "2026-10-27T00:00:00Z" : null,
          isCurrent: false,
          feedback: [
            {
              id: "feedback",
              reviewerName: "Synthetic name",
              identityVerified: false,
              decision: "approved",
              comment: "",
              createdAt: "2026-10-27T00:00:00Z",
            },
          ],
        },
      ];
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={client}>
        <SocialReviewShare campaign={campaign} version={2} draft={{ ...draft, revision: 2 }} />
      </QueryClientProvider>,
    );
    try {
      await screen.getByRole("button", { name: "Share for review" }).click();
      await expect.element(screen.getByText(/Earlier approvals do not apply/)).toBeVisible();
      await expect.element(screen.getByText(/unverified name/)).toBeVisible();
      await screen.getByRole("button", { name: "Revoke link" }).click();
      expect(actions.command).toHaveBeenCalledWith(campaign, 2, {
        action: "revoke-review-link",
        draftId: "draft",
        linkId: "old-link",
      });
      await expect.element(screen.getByText(/Revoked/)).toBeVisible();
    } finally {
      await screen.unmount();
      client.clear();
    }
  });
  it("discards an old account's late create result while preserving the new account's pending state", async () => {
    actions.command.mockReset();
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    const oldRequest = new Promise((resolve) => {
      finishOld = resolve;
    });
    const newRequest = new Promise((resolve) => {
      finishNew = resolve;
    });
    let creates = 0;
    actions.command.mockImplementation(async (_campaign, _version, input) =>
      input.action === "create-review-link" ? (++creates === 1 ? oldRequest : newRequest) : [],
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={client}>
        <SocialReviewShare campaign={campaign} version={2} draft={draft} />
      </QueryClientProvider>,
    );
    try {
      await screen.getByRole("button", { name: "Share for review" }).click();
      await screen.getByRole("checkbox").click();
      await screen.getByRole("button", { name: "Create review link" }).click();
      await expect
        .element(screen.getByRole("button", { name: "Create review link" }))
        .toBeDisabled();
      await resetSocialAccountCache(client);
      await expect.element(screen.getByRole("checkbox")).not.toBeChecked();
      await screen.getByRole("checkbox").click();
      await expect
        .element(screen.getByRole("button", { name: "Create review link" }))
        .toBeEnabled();
      await screen.getByRole("button", { name: "Create review link" }).click();
      finishOld({
        link: { id: "old-link", revision: 1 },
        reviewUrl: "https://example.invalid/old-account-secret",
      });
      await oldRequest;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await expect
        .element(screen.getByRole("textbox", { name: "Review link", exact: true }))
        .not.toBeInTheDocument();
      await expect
        .element(screen.getByRole("button", { name: "Create review link" }))
        .toBeDisabled();
      finishNew({
        link: { id: "new-link", revision: 1 },
        reviewUrl: "https://example.invalid/new-account-review",
      });
      await expect
        .element(screen.getByRole("textbox", { name: "Review link", exact: true }))
        .toHaveValue("https://example.invalid/new-account-review");
      await expect
        .element(screen.getByRole("button", { name: "Create review link" }))
        .toBeEnabled();
      await resetSocialAccountCache(client);
      await expect
        .element(screen.getByRole("textbox", { name: "Review link", exact: true }))
        .not.toBeInTheDocument();
      await expect.element(screen.getByRole("checkbox")).not.toBeChecked();
    } finally {
      finishOld({});
      finishNew({});
      await screen.unmount();
      client.clear();
    }
  });
  it("does not invalidate private queries after an unmounted create finishes", async () => {
    actions.command.mockReset();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    actions.command.mockImplementation(async (_campaign, _version, input) =>
      input.action === "create-review-link" ? pending : [],
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const screen = await render(
      <QueryClientProvider client={client}>
        <SocialReviewShare campaign={campaign} version={2} draft={draft} />
      </QueryClientProvider>,
    );
    await screen.getByRole("button", { name: "Share for review" }).click();
    await screen.getByRole("checkbox").click();
    await screen.getByRole("button", { name: "Create review link" }).click();
    await screen.unmount();
    finish({
      link: { id: "unmounted-link", revision: 1 },
      reviewUrl: "https://example.invalid/unmounted-secret",
    });
    await pending;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });
});
