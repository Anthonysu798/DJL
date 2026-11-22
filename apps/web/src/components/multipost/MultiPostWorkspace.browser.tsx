import "../../index.css";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MultiPostDraft, MultiPostState } from "@djl/contracts";
const adapters = (["dynamic", "article", "video", "podcast"] as const).map((kind) => ({
  id: kind === "dynamic" ? "DYNAMIC_X" : `${kind.toUpperCase()}_X`,
  platformKey: "x",
  kind,
  displayName: "X",
  homeUrl: "https://x.com",
  injectUrl: "https://x.com/compose",
  identitySupported: true,
  automaticSubmit: true,
}));
import MultiPostWorkspace from "./MultiPostWorkspace";
const api = vi.hoisted(() => ({ state: vi.fn(), command: vi.fn(), upload: vi.fn() }));
vi.mock("./client", () => ({
  multiPostState: api.state,
  multiPostCommand: api.command,
  uploadMultiPostMedia: api.upload,
  mediaPreviewUrl: (_thread: string, url: string) => url,
}));
let state: MultiPostState;
let client: QueryClient;
const draft: MultiPostDraft = {
  id: "draft",
  workspaceId: "workspace",
  threadId: "chat",
  revision: 1,
  kind: "dynamic",
  data: { title: "Saved exact title", content: "Saved exact copy" },
  targets: [{ accountId: "personal", adapterId: "DYNAMIC_X" }],
  approvedRevision: null,
  publicationMode: "now",
  scheduledAt: null,
  timezone: "America/Toronto",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function mount(initialView?: "authorizations", initialWorkflowId?: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MultiPostWorkspace
        threadId="chat"
        onBack={() => {}}
        {...(initialView ? { initialView } : {})}
        {...(initialWorkflowId ? { initialWorkflowId } : {})}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state = {
    accounts: ["personal", "brand"].map((id) => ({
      id,
      workspaceId: "workspace",
      platformKey: "x",
      label: id === "personal" ? "Personal" : "Brand",
      status: "connected",
      identity: {
        provider: "x",
        accountId: id,
        username: id,
        verifiedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    })),
    drafts: [],
    jobs: [],
    workflows: [],
    grants: [],
    capabilities: adapters,
    runtimeAvailable: true,
  };
  api.state.mockReset().mockImplementation(async () => structuredClone(state));
  api.command.mockReset().mockResolvedValue({});
  api.upload.mockReset();
});
describe("MultiPost workbench", () => {
  it("switches all four editors and keeps independent accounts selectable", async () => {
    mount();
    await expect.element(page.getByRole("checkbox", { name: "Personal" })).toBeVisible();
    await expect.element(page.getByRole("checkbox", { name: "Brand" })).toBeVisible();
    await page.getByRole("button", { name: "Article", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Markdown", exact: true }))
      .toBeVisible();
    await expect.element(page.getByLabelText("Word document", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Video", exact: true }).click();
    await expect.element(page.getByLabelText("Video file", { exact: true })).toBeVisible();
    await expect.element(page.getByLabelText("Vertical cover", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Podcast", exact: true }).click();
    await expect.element(page.getByLabelText("Audio file", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Post", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Caption", exact: true })).toBeVisible();
    expect(api.command).not.toHaveBeenCalled();
  });
  it("saves the exact copy and both account targets without approving or submitting", async () => {
    api.command.mockImplementation(async (_thread, input) =>
      input.action === "save-draft" ? { ...draft, ...input.draft } : {},
    );
    mount();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Two account campaign");
    await page.getByRole("textbox", { name: "Caption", exact: true }).fill("Exact local caption");
    await page.getByRole("checkbox", { name: "Personal" }).click();
    await page.getByRole("checkbox", { name: "Brand" }).click();
    await page.getByRole("button", { name: "Save for review" }).click();
    await expect.poll(() => api.command.mock.calls.length).toBe(1);
    expect(api.command.mock.calls[0]?.[1]).toMatchObject({
      action: "save-draft",
      draft: {
        kind: "dynamic",
        data: { title: "Two account campaign", content: "Exact local caption" },
        targets: [
          { accountId: "personal", adapterId: "DYNAMIC_X" },
          { accountId: "brand", adapterId: "DYNAMIC_X" },
        ],
      },
    });
  });
  it("keeps a submitted draft editable but offers its queue instead of a second approval", async () => {
    state.drafts = [draft];
    state.jobs = [
      {
        id: "job",
        workspaceId: "workspace",
        threadId: "chat",
        draftId: draft.id,
        revision: draft.revision,
        accountId: "personal",
        adapterId: "DYNAMIC_X",
        snapshot: draft,
        target: draft.targets[0]!,
        state: "published",
        dueAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        grantId: null,
        evidence: {
          state: "published",
          postUrl: "https://example.com/posts/one",
          observedAt: new Date().toISOString(),
        },
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    mount();
    await expect
      .element(page.getByRole("button", { name: "Edit · Saved exact title" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Approve and publish" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Queue & history", exact: true }).click();
    await expect
      .element(page.getByRole("link", { name: "View post" }))
      .toHaveAttribute("href", "https://example.com/posts/one");
  });
  it("shows an uncertain native cancellation honestly and provides verification instead of retry", async () => {
    state.jobs = [
      {
        id: "job",
        workspaceId: "workspace",
        threadId: "chat",
        draftId: draft.id,
        revision: 1,
        accountId: "personal",
        adapterId: "DYNAMIC_X",
        snapshot: draft,
        target: draft.targets[0]!,
        state: "scheduled-on-platform",
        dueAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        grantId: null,
        evidence: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    api.command.mockImplementation(async () => {
      state.jobs[0]!.state = "uncertain";
      state.jobs[0]!.evidence = {
        state: "uncertain",
        message: "Platform cancellation is not confirmed.",
        observedAt: new Date().toISOString(),
      };
      return state.jobs[0];
    });
    mount();
    await page.getByRole("tab", { name: "Queue & history" }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(page.getByText("Platform cancellation is not confirmed.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Verify result" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Review and retry" }))
      .not.toBeInTheDocument();
    expect(api.command.mock.calls[0]?.[1]).toEqual({ action: "cancel-job", jobId: "job" });
  });
  it("revokes an existing workflow authorization through the UI and surfaces failures", async () => {
    state.workflows = [
      {
        id: "workflow",
        workspaceId: "workspace",
        name: "Limited campaign",
        revision: 4,
        kinds: ["dynamic"],
        accountIds: ["personal"],
      },
    ];
    state.grants = [
      {
        id: "grant",
        workspaceId: "workspace",
        workflowId: "workflow",
        workflowRevision: 4,
        accountIds: ["personal"],
        kinds: ["dynamic"],
        expiresAt: "2030-01-01T00:00:00Z",
        dailyLimit: 1,
        timezone: "America/Toronto",
        revokedAt: null,
        createdAt: new Date().toISOString(),
      },
    ];
    api.command.mockRejectedValueOnce(new Error("Local service unavailable"));
    mount();
    await page.getByRole("tab", { name: "Workflows & authorizations" }).click();
    await page.getByRole("button", { name: "Revoke authorization" }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Local service unavailable");
    expect(api.command.mock.calls[0]?.[1]).toEqual({ action: "revoke-grant", grantId: "grant" });
  });
});

it("opens the exact workflow authorization view requested by an agent while leaving authorization to the user", async () => {
  state.workflows = [
    {
      id: "workflow",
      workspaceId: "workspace",
      name: "Requested workflow",
      revision: 2,
      kinds: ["dynamic"],
      accountIds: ["personal"],
    },
  ];
  mount("authorizations", "workflow");
  await expect
    .element(page.getByRole("heading", { name: "Standing publishing authorization" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("combobox", { name: "Workflow", exact: true }))
    .toHaveValue("workflow");
  expect(api.command).not.toHaveBeenCalled();
});
