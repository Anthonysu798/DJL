import "../../index.css";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkflowPanel, SocialInboxPanel, PerformanceCoachPanel } from "./SocialWorkflowPanels";

const actions = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("./agentClient", () => ({ agentCommand: actions.command }));

const workflow = {
  value: {
    id: "owner:workflow",
    name: "Weekly posts",
    ownerKey: "owner",
    archived: false,
    updatedAt: "2026-10-26T12:00:00Z",
    steps: [{ id: "step-1", tool: "djl_inspect_social_media", label: "Inspect media", args: {} }],
  },
  version: 2,
};
const run = {
  value: {
    id: "owner:run",
    workflowId: workflow.value.id,
    workflowVersion: 2,
    threadId: "chat",
    ownerKey: "owner",
    name: "Weekly posts",
    sources: {},
    steps: [{ ...workflow.value.steps[0], status: "pending", reason: null, result: null }],
    currentStep: 0,
    status: "ready",
    requiresReview: true,
    createdAt: "2026-10-26T12:00:00Z",
    updatedAt: "2026-10-26T12:00:00Z",
  },
  version: 1,
};
const draft = {
  id: "draft",
  threadId: "original-chat",
  userId: "user",
  orgId: "org",
  revision: 3,
  confirmedAt: "2026-10-26T12:00:00Z",
  updatedAt: "2026-10-26T12:00:00Z",
  content: {
    accountIds: ["ig"],
    captions: { ig: "Actual caption" },
    caption: "Actual caption",
    mediaFileIds: ["image"],
    scheduledAt: "2030-10-27T12:00:00Z",
    timezone: "UTC",
  },
  tasks: [
    {
      id: "task",
      revision: 3,
      accountId: "ig",
      state: "failed",
      dueAt: "2030-10-27T12:00:00Z",
      errorCode: "provider_unavailable",
    },
  ],
};
function mount(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>,
  );
}
describe("social workflow panels", () => {
  it("saves missing run sources before resuming the actual next preparation step", async () => {
    const prompt = vi.fn();
    const blocked = {
      ...run,
      value: {
        ...run.value,
        status: "blocked",
        steps: [
          {
            ...run.value.steps[0],
            tool: "djl_prepare_marketing",
            label: "Prepare draft",
            args: { brief: "$source:brief" },
            status: "blocked",
            reason: "Missing sources: brief",
            result: null,
          },
        ],
      },
    };
    const unblocked = {
      ...blocked,
      version: 2,
      value: {
        ...blocked.value,
        status: "ready",
        sources: { brief: "Verified campaign facts" },
        steps: [
          {
            ...blocked.value.steps[0],
            args: { brief: "Verified campaign facts" },
            status: "pending",
            reason: null,
          },
        ],
      },
    };
    actions.command.mockImplementation(async (_thread, _tool, args) =>
      args.action === "progress"
        ? { run: unblocked, requiresReview: true }
        : { workflows: [], runs: [blocked], requiresReview: true },
    );
    const screen = await mount(<WorkflowPanel threadId="chat" onPrompt={prompt} />);
    await screen
      .getByLabelText("Campaign brief for saved run Weekly posts", { exact: true })
      .fill("Verified campaign facts");
    await screen.getByRole("button", { name: "Resume in Agent Chat", exact: true }).click();
    expect(actions.command).toHaveBeenCalledWith("chat", "djl_social_workflows", {
      action: "progress",
      runId: "owner:run",
      version: 1,
      stepId: "step-1",
      status: "pending",
      sources: { brief: "Verified campaign facts" },
    });
    await expect.poll(() => prompt.mock.calls.length).toBe(1);
    expect(prompt.mock.calls[0]?.[0]).toContain("last observed run version: 2");
    await screen.unmount();
  });
  beforeEach(() => {
    actions.command.mockReset();
  });
  it("creates a durable run and asks the agent to execute its current preparation step", async () => {
    const prompt = vi.fn();
    actions.command.mockImplementation(async (_thread, _tool, args) =>
      args.action === "run"
        ? { run, requiresReview: true }
        : { workflows: [workflow], runs: [], requiresReview: true },
    );
    const screen = await mount(<WorkflowPanel threadId="chat" onPrompt={prompt} />);
    await screen.getByRole("button", { name: "Run preparation" }).click();
    expect(actions.command).toHaveBeenCalledWith("chat", "djl_social_workflows", {
      action: "run",
      workflowId: "owner:workflow",
      version: 2,
      sources: {},
    });
    await expect.poll(() => prompt.mock.calls.length).toBe(1);
    expect(prompt.mock.calls[0]?.[0]).toContain("owner:run");
    expect(prompt.mock.calls[0]?.[0]).toContain("step-1");
    expect(prompt.mock.calls[0]?.[0]).toContain("djl_social_workflows");
    expect(prompt.mock.calls[0]?.[0]).toContain("Never approve, confirm or publish");
    await screen.unmount();
  });
  it("retries the exact owned task and revision without confirmation", async () => {
    actions.command.mockImplementation(async (_thread, _tool, args) =>
      args.action === "list"
        ? {
            items: [
              {
                campaignId: "campaign",
                threadId: "original-chat",
                name: "Weekly",
                version: 7,
                drafts: [draft],
                accounts: [{ id: "ig", provider: "instagram" }],
                issues: [],
                nextScheduledAt: null,
              },
            ],
            retrievedAt: "2026-10-26T12:00:00Z",
            limitations: [],
          }
        : { task: {} },
    );
    const screen = await mount(<SocialInboxPanel threadId="chat" />);
    await screen.getByRole("button", { name: "Retry instagram task" }).click();
    expect(actions.command).toHaveBeenCalledWith("chat", "djl_social_inbox", {
      action: "retry",
      campaignId: "campaign",
      threadId: "original-chat",
      version: 7,
      draftId: "draft",
      taskId: "task",
      revision: 3,
    });
    expect(actions.command.mock.calls.every((call) => call[2].action !== "confirm")).toBe(true);
    await expect
      .element(screen.getByRole("link", { name: "Open original chat" }))
      .toHaveAttribute("href", "#/original-chat");
    await screen.unmount();
  });
  it("edits and archives saved templates with their observed versions", async () => {
    actions.command.mockResolvedValue({ workflows: [workflow], runs: [], requiresReview: true });
    const screen = await mount(<WorkflowPanel threadId="chat" />);
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    await screen.getByLabelText("Workflow name", { exact: true }).fill("Updated routine");
    await screen.getByRole("button", { name: "Save workflow", exact: true }).click();
    expect(actions.command).toHaveBeenCalledWith("chat", "djl_social_workflows", {
      action: "save",
      workflowId: "owner:workflow",
      version: 2,
      name: "Updated routine",
      steps: [{ tool: "djl_inspect_social_media", label: "Inspect media", args: {} }],
    });
    await screen.getByRole("button", { name: "Archive Weekly posts" }).click();
    expect(actions.command).toHaveBeenCalledWith("chat", "djl_social_workflows", {
      action: "archive",
      workflowId: "owner:workflow",
      version: 2,
    });
    await screen.unmount();
  });
  it("retains the saved timezone and exact fold instant in the inbox schedule editor", async () => {
    const folded = {
      ...draft,
      content: {
        ...draft.content,
        publicationMode: "scheduled",
        scheduledAt: "2030-11-03T06:30:00.000Z",
        timezone: "America/Toronto",
      },
    };
    actions.command.mockImplementation(async (_thread, _tool, args) =>
      args.action === "list"
        ? {
            items: [
              {
                campaignId: "campaign",
                threadId: "original-chat",
                name: "Weekly",
                version: 7,
                drafts: [folded],
                accounts: [{ id: "ig", provider: "instagram" }],
                issues: [],
                nextScheduledAt: null,
              },
            ],
            retrievedAt: "2026-10-26T12:00:00Z",
            limitations: [],
          }
        : { draft: { ...folded, revision: 4, confirmedAt: null, tasks: [] }, requiresReview: true },
    );
    const screen = await mount(<SocialInboxPanel threadId="chat" />);
    await screen.getByRole("button", { name: "Change schedule", exact: true }).click();
    await expect
      .element(screen.getByLabelText("Publishing timezone", { exact: true }))
      .toHaveValue("America/Toronto");
    await expect
      .element(screen.getByLabelText("New publishing time for Weekly", { exact: true }))
      .toHaveValue("2030-11-03T01:30");
    await screen.getByRole("button", { name: "Prepare new schedule", exact: true }).click();
    expect(actions.command).toHaveBeenCalledWith(
      "chat",
      "djl_social_inbox",
      expect.objectContaining({
        action: "reschedule",
        scheduledAt: "2030-11-03T06:30:00.000Z",
        timezone: "America/Toronto",
      }),
    );
    await screen.unmount();
  });
  it("prepares a revision-bound unconfirmed reschedule and requires original-chat review", async () => {
    actions.command.mockImplementation(async (_thread, _tool, args) =>
      args.action === "list"
        ? {
            items: [
              {
                campaignId: "campaign",
                threadId: "original-chat",
                name: "Weekly",
                version: 7,
                drafts: [draft],
                accounts: [{ id: "ig", provider: "instagram" }],
                issues: [],
                nextScheduledAt: null,
              },
            ],
            retrievedAt: "2026-10-26T12:00:00Z",
            limitations: [],
          }
        : { draft: { ...draft, revision: 4, confirmedAt: null, tasks: [] }, requiresReview: true },
    );
    const screen = await mount(<SocialInboxPanel threadId="chat" />);
    await screen.getByRole("button", { name: "Change schedule", exact: true }).click();
    await screen
      .getByLabelText("New publishing time for Weekly", { exact: true })
      .fill("2030-11-01T12:30");
    await screen.getByLabelText("Publishing timezone", { exact: true }).fill("America/Toronto");
    await screen.getByRole("button", { name: "Prepare new schedule", exact: true }).click();
    expect(actions.command).toHaveBeenCalledWith("chat", "djl_social_inbox", {
      action: "reschedule",
      campaignId: "campaign",
      threadId: "original-chat",
      version: 7,
      draftId: "draft",
      taskId: "task",
      revision: 3,
      scheduledAt: "2030-11-01T16:30:00.000Z",
      timezone: "America/Toronto",
    });
    await expect
      .element(
        screen.getByText(
          "New schedule prepared as an unconfirmed preview. Open the original chat to review and explicitly confirm it.",
        ),
      )
      .toBeVisible();
    expect(actions.command.mock.calls.every((call) => call[2].action !== "confirm")).toBe(true);
    await screen.unmount();
  });
  it("shows unavailable official metrics and supplies the actual report to experiment coaching", async () => {
    const prompt = vi.fn();
    actions.command.mockResolvedValue({
      days: 30,
      periodStart: "2026-09-26T12:00:00Z",
      retrievedAt: "2026-10-26T12:00:00Z",
      posts: [
        {
          campaignId: "campaign",
          threadId: "original-chat",
          draftId: "draft",
          taskId: "published-task",
          provider: "instagram",
          accountId: "ig",
          publishedAt: "2026-10-25T12:00:00Z",
          publishedAtBasis: "task_updated_at",
          retrievedAt: "2026-10-26T12:00:00Z",
          postUrl: "https://www.instagram.com/p/real/",
          metrics: { views: null, likes: 5, comments: 0, shares: null },
          unavailableReason: null,
        },
      ],
      providers: [
        {
          provider: "instagram",
          publishedPosts: 1,
          averages: { views: null, likes: 5, comments: 0, shares: null },
          availableSamples: { views: 0, likes: 1, comments: 1, shares: 0 },
        },
      ],
      limitations: ["Insufficient published-post samples."],
    });
    const screen = await mount(<PerformanceCoachPanel threadId="chat" onPrompt={prompt} />);
    await expect.element(screen.getByText("Views: unavailable", { exact: false })).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "View official post" }))
      .toHaveAttribute("href", "https://www.instagram.com/p/real/");
    await screen.getByRole("button", { name: "Suggest next experiment" }).click();
    expect(prompt.mock.calls[0]?.[0]).toContain("published-task");
    expect(prompt.mock.calls[0]?.[0]).toContain('"views":null');
    expect(prompt.mock.calls[0]?.[0]).toContain("causal");
    await screen.unmount();
  });
});
