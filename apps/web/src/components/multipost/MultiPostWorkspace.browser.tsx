import "../../index.css";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  MultiPostAccount,
  MultiPostDraft,
  MultiPostJob,
  MultiPostState,
} from "@synara/contracts";
import type { MultiPostView } from "./shared";
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
const api = vi.hoisted(() => ({
  state: vi.fn(),
  command: vi.fn(),
  upload: vi.fn(),
  check: vi.fn(),
}));
vi.mock("./client", () => ({
  multiPostState: api.state,
  // The quiet sign-in check on opening is not something the person did, so it is counted apart.
  multiPostCommand: (thread: string, input: { action: string }) =>
    input.action === "check-accounts"
      ? Promise.resolve(api.check(input))
      : api.command(thread, input),
  uploadMultiPostMedia: api.upload,
  mediaPreviewUrl: (_thread: string, url: string) => url,
}));
let state: MultiPostState;
const prompt = vi.fn(async (_text: string) => true);
const now = new Date().toISOString();
const account = (id: string, label: string, extra: Partial<MultiPostAccount> = {}) =>
  ({
    id,
    workspaceId: "workspace",
    platformKey: "x",
    label,
    status: "connected",
    identity: { provider: "x", accountId: id, username: id, verifiedAt: now },
    createdAt: now,
    ...extra,
  }) satisfies MultiPostAccount;
const draft: MultiPostDraft = {
  id: "draft",
  workspaceId: "workspace",
  threadId: "chat",
  revision: 1,
  kind: "dynamic",
  data: { title: "", content: "Saved exact copy" },
  targets: [{ accountId: "personal", adapterId: "DYNAMIC_X" }],
  approvedRevision: null,
  publicationMode: "now",
  scheduledAt: null,
  timezone: "America/Toronto",
  createdAt: now,
  updatedAt: now,
};
const job = (extra: Partial<MultiPostJob> = {}): MultiPostJob => ({
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
  dueAt: now,
  submittedAt: now,
  grantId: null,
  evidence: null,
  error: null,
  createdAt: now,
  updatedAt: now,
  ...extra,
});
function mount(initialView?: MultiPostView, resources?: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MultiPostWorkspace
        threadId="chat"
        onBack={() => {}}
        onPrompt={prompt}
        {...(initialView ? { initialView } : {})}
        {...(resources ? { resources } : {})}
      />
    </QueryClientProvider>,
  );
}
const commands = () => api.command.mock.calls.map((call) => call[1]);
beforeEach(() => {
  state = {
    accounts: [account("personal", "Personal"), account("brand", "Brand")],
    drafts: [],
    jobs: [],
    workflows: [],
    grants: [],
    capabilities: adapters,
    runtimeAvailable: true,
  };
  api.state.mockReset().mockImplementation(async () => structuredClone(state));
  api.command.mockReset().mockResolvedValue({ drafts: [], jobs: [], skipped: [], posted: true });
  api.upload.mockReset();
  api.check.mockReset();
  prompt.mockClear();
  localStorage.clear();
});

describe("posting in one step", () => {
  it("posts what was written to every signed-in account with one press", async () => {
    mount();
    const post = page.getByRole("button", { name: "Post now" });
    await expect.element(post).toBeDisabled();
    await page.getByRole("textbox", { name: "Your post" }).fill("Exact local caption");
    await post.click();
    await expect.poll(commands).toEqual([
      {
        action: "quick-post",
        post: {
          text: "Exact local caption",
          media: [],
          accountIds: ["personal", "brand"],
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    ]);
    await expect.element(page.getByRole("heading", { name: "On its way!" })).toBeVisible();
    await page.getByRole("button", { name: "See progress" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Activity" }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("keeps what was written while the person visits another tab", async () => {
    mount();
    await page.getByRole("textbox", { name: "Your post" }).fill("Half-written thought");
    await page.getByRole("tab", { name: "Accounts" }).click();
    await expect
      .element(page.getByRole("switch", { name: "Autopilot for Personal" }))
      .toBeVisible();
    await page.getByRole("tab", { name: "Create" }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Your post" }))
      .toHaveValue("Half-written thought");
  });

  it("leaves out an account the person switched off", async () => {
    mount();
    await page.getByRole("textbox", { name: "Your post" }).fill("Only one");
    await page.getByRole("checkbox", { name: "Brand" }).click();
    await page.getByRole("button", { name: "Post now" }).click();
    await expect.poll(() => commands()[0]?.post.accountIds).toEqual(["personal"]);
  });

  it("uploads an added photo and sends it with the post", async () => {
    const photo = { name: "a.png", url: "Media/a", type: "image/png", size: 1 };
    api.upload.mockResolvedValue(photo);
    mount();
    await userEvent.upload(
      page.getByLabelText("Add photos or a video"),
      new File(["x"], "a.png", { type: "image/png" }),
    );
    await expect.element(page.getByRole("button", { name: "Remove a.png" })).toBeVisible();
    await page.getByRole("button", { name: "Post now" }).click();
    await expect.poll(() => commands()[0]?.post.media).toEqual([photo]);
  });

  it("schedules for a picked time with an explicit offset", async () => {
    mount();
    await page.getByRole("textbox", { name: "Your post" }).fill("Later post");
    await page.getByRole("radio", { name: "Pick a time" }).click();
    await page.getByLabelText("Date and time").fill("2031-03-04T09:30");
    await page.getByRole("button", { name: "Schedule post" }).click();
    await expect
      .poll(() => commands()[0]?.post.scheduledAt)
      .toMatch(/^2031-03-04T.*(Z|[+-]\d\d:\d\d)$/);
    await expect.element(page.getByRole("heading", { name: "Scheduled!" })).toBeVisible();
  });

  it("says in plain words why a post did not go out, and keeps the text", async () => {
    api.command.mockRejectedValueOnce(new Error("Connect an account first"));
    mount();
    await page.getByRole("textbox", { name: "Your post" }).fill("Keep me");
    await page.getByRole("button", { name: "Post now" }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Connect an account first");
    await expect.element(page.getByRole("textbox", { name: "Your post" })).toHaveValue("Keep me");
  });

  it("names an account that was skipped and why", async () => {
    api.command.mockResolvedValueOnce({
      drafts: [],
      jobs: [],
      posted: true,
      skipped: [{ accountId: "brand", label: "Brand", reason: "needs-video" }],
    });
    mount();
    await page.getByRole("textbox", { name: "Your post" }).fill("Words only");
    await page.getByRole("button", { name: "Post now" }).click();
    await expect.element(page.getByText("Brand was skipped: it needs a video.")).toBeVisible();
  });

  it("hands a plain request to the agent", async () => {
    mount();
    await page
      .getByRole("textbox", { name: "Tell the agent what to post" })
      .fill("Make a sale image and post it");
    await page.getByRole("button", { name: "Ask the agent" }).click();
    await expect.poll(() => prompt.mock.calls[0]?.[0]).toContain("Make a sale image and post it");
    expect(prompt.mock.calls[0]?.[0]).toContain("$multipost-publish");
  });

  it("shows a post the agent prepared and posts it on one press", async () => {
    state.drafts = [draft];
    mount();
    await expect.element(page.getByRole("heading", { name: "Waiting for your OK" })).toBeVisible();
    await expect.element(page.getByText("Saved exact copy")).toBeVisible();
    await page.getByRole("button", { name: "Post now" }).last().click();
    await expect
      .poll(() => commands().map((command) => command.action))
      .toEqual(["approve-draft", "submit-draft"]);
  });

  it("does not ask twice about a post that is already on its way", async () => {
    state.drafts = [draft];
    state.jobs = [job()];
    mount();
    await expect.element(page.getByRole("textbox", { name: "Your post" })).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Waiting for your OK" }))
      .not.toBeInTheDocument();
  });
});

describe("first-time setup", () => {
  it("walks a new person to connecting an account before anything else", async () => {
    state.accounts = [];
    api.command.mockImplementation(async (_thread, input) =>
      input.action === "create-account" ? account("new", "X", { status: "disconnected" }) : {},
    );
    mount();
    await expect.element(page.getByRole("textbox", { name: "Your post" })).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Connect an account" }).click();
    await page.getByRole("button", { name: "X", exact: true }).click();
    await expect.poll(commands).toEqual([
      { action: "create-account", platformKey: "x", label: "X" },
      { action: "connect-account", accountId: "new" },
    ]);
  });

  it("confirms the sign-in and switches Autopilot on for a new account", async () => {
    state.accounts = [account("personal", "Personal", { status: "needs-login", identity: null })];
    api.command.mockImplementation(async (_thread, input) =>
      input.action === "verify-account" ? account("personal", "Personal") : {},
    );
    mount("accounts");
    await page.getByRole("button", { name: "I'm signed in" }).click();
    await expect.poll(commands).toEqual([
      { action: "verify-account", accountId: "personal" },
      { action: "set-autopilot", accountId: "personal", enabled: true },
    ]);
  });

  it("explains what to do when the sign-in is not finished yet", async () => {
    state.accounts = [account("personal", "Personal", { status: "needs-login", identity: null })];
    api.command.mockImplementation(async (_thread, input) => {
      if (input.action === "verify-account")
        throw new Error("Platform identity could not be verified");
      return {};
    });
    mount("accounts");
    await page.getByRole("button", { name: "I'm signed in" }).click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("We couldn't see your account yet");
    expect(commands()).toHaveLength(1);
  });
});

describe("Autopilot", () => {
  it("switches off with one tap", async () => {
    state.accounts = [
      account("personal", "Personal", {
        autopilot: { dailyLimit: 5, expiresAt: "2031-01-01T00:00:00Z", timezone: "UTC" },
      }),
    ];
    mount("accounts");
    await expect.element(page.getByText("The agent posts here without asking")).toBeVisible();
    await page.getByRole("switch", { name: "Autopilot for Personal" }).click();
    await expect
      .poll(commands)
      .toEqual([{ action: "set-autopilot", accountId: "personal", enabled: false }]);
  });

  it("switches on with the chosen number of posts a day", async () => {
    state.accounts = [account("personal", "Personal")];
    mount("accounts");
    await expect.element(page.getByText("The agent asks you before posting")).toBeVisible();
    await page.getByRole("switch", { name: "Autopilot for Personal" }).click();
    await expect
      .poll(commands)
      .toEqual([{ action: "set-autopilot", accountId: "personal", enabled: true }]);
  });

  it("treats an expired Autopilot as off", async () => {
    state.accounts = [
      account("personal", "Personal", {
        autopilot: { dailyLimit: 5, expiresAt: "2020-01-01T00:00:00Z", timezone: "UTC" },
      }),
    ];
    mount("accounts");
    await expect
      .element(page.getByRole("switch", { name: "Autopilot for Personal" }))
      .toHaveAttribute("aria-checked", "false");
  });

  it("opens where an agent's permission link points and still lets old permissions be revoked", async () => {
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
        createdAt: now,
      },
    ];
    api.command.mockRejectedValueOnce(new Error("Local service unavailable"));
    mount("authorizations");
    await expect
      .element(page.getByRole("tab", { name: "Accounts" }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Revoke authorization" }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Local service unavailable");
    expect(commands()[0]).toEqual({ action: "revoke-grant", grantId: "grant" });
  });
});

describe("activity", () => {
  it("shows a finished post with its real link", async () => {
    state.jobs = [
      job({
        evidence: {
          state: "published",
          postUrl: "https://example.com/posts/one",
          observedAt: now,
        },
      }),
    ];
    mount("queue");
    await expect.element(page.getByText("Posted", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "View post" }))
      .toHaveAttribute("href", "https://example.com/posts/one");
  });

  it("offers a check, never a blind retry, when it is unclear whether a post went out", async () => {
    state.jobs = [job({ state: "scheduled-on-platform" })];
    api.command.mockImplementation(async () => {
      state.jobs[0]!.state = "uncertain";
      state.jobs[0]!.evidence = {
        state: "uncertain",
        message: "Platform cancellation is not confirmed.",
        observedAt: now,
      };
      return state.jobs[0];
    });
    mount("queue");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(page.getByText("Not sure it posted")).toBeVisible();
    await expect.element(page.getByText("Platform cancellation is not confirmed.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Check if it posted" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(commands()[0]).toEqual({ action: "cancel-job", jobId: "job" });
  });

  it("lets a missed post go out with one press", async () => {
    state.jobs = [job({ state: "missed", submittedAt: null })];
    mount("queue");
    await expect.element(page.getByText("Your computer was off or asleep")).toBeVisible();
    await page.getByRole("button", { name: "Post it now" }).click();
    await expect.poll(commands).toEqual([{ action: "retry-job", jobId: "job" }]);
  });

  it("tells a person to press the final button when a platform needs it", async () => {
    state.jobs = [
      job({
        state: "prepared",
        submittedAt: null,
        evidence: { state: "prepared", requiresManual: true, observedAt: now },
      }),
    ];
    mount("queue");
    await expect.element(page.getByText("One step left")).toBeVisible();
    await page.getByRole("button", { name: "Open the window" }).click();
    await expect.poll(commands).toEqual([{ action: "open-job", jobId: "job" }]);
  });

  it("invites a first post when nothing has happened yet", async () => {
    mount("queue");
    await page.getByRole("button", { name: "Create a post" }).click();
    await expect.element(page.getByRole("textbox", { name: "Your post" })).toBeVisible();
  });
});

describe("advanced editor", () => {
  it("keeps articles, videos and podcasts one click away", async () => {
    mount();
    await page.getByRole("button", { name: "Advanced editor" }).click();
    await page.getByRole("button", { name: "Article", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Markdown", exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "Video", exact: true }).click();
    await expect.element(page.getByLabelText("Vertical cover", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Podcast", exact: true }).click();
    await expect.element(page.getByLabelText("Audio file", { exact: true })).toBeVisible();
    expect(api.command).not.toHaveBeenCalled();
  });

  it("saves the exact copy and both account targets without posting", async () => {
    api.command.mockImplementation(async (_thread, input) =>
      input.action === "save-draft" ? { ...draft, ...input.draft } : {},
    );
    mount();
    await page.getByRole("button", { name: "Advanced editor" }).click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Two account campaign");
    await page.getByRole("textbox", { name: "Caption", exact: true }).fill("Exact local caption");
    await page.getByRole("checkbox", { name: "Personal" }).click();
    await page.getByRole("checkbox", { name: "Brand" }).click();
    await page.getByRole("button", { name: "Save for review" }).click();
    await expect.poll(() => api.command.mock.calls.length).toBe(1);
    expect(commands()[0]).toMatchObject({
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
});

describe("one-click actions", () => {
  const sent = () => prompt.mock.calls[0]?.[0] ?? "";
  // Someone who has already answered the one-time question about their business.
  beforeEach(() => localStorage.setItem("djl:multipost:style", JSON.stringify({ asked: true })));

  it("asks about the business once, before the very first post, then never again", async () => {
    localStorage.clear();
    const screen = await mount("resources");
    await page.getByRole("button", { name: "Plan my week" }).click();
    await expect.element(page.getByRole("form", { name: "One quick thing first" })).toBeVisible();
    expect(prompt).not.toHaveBeenCalled();
    await page.getByRole("textbox", { name: "Business name" }).first().fill("Sunrise Bakery");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect.poll(sent).toContain("My business is called Sunrise Bakery.");
    await screen.unmount();
    prompt.mockClear();
    mount("resources");
    await page.getByRole("button", { name: "Plan my week" }).click();
    await expect.poll(sent).toContain("Sunrise Bakery");
    await expect
      .element(page.getByRole("form", { name: "One quick thing first" }))
      .not.toBeInTheDocument();
  });

  it("lets the person skip the question and still post", async () => {
    localStorage.clear();
    mount("resources");
    await page.getByRole("button", { name: "Plan my week" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect.poll(sent).toContain("Plan 7 posts");
  });

  it("adds the hashtags the person always uses", async () => {
    mount("resources");
    await page.getByRole("textbox", { name: "Hashtags you always use" }).fill("#SunriseBakery");
    await page.getByRole("button", { name: "Plan my week" }).click();
    await expect.poll(sent).toContain("Always include these hashtags: #SunriseBakery.");
  });

  it("plans a whole week from a single press", async () => {
    mount("resources");
    await page.getByRole("button", { name: "Plan my week" }).click();
    await expect.poll(() => prompt.mock.calls.length).toBe(1);
    expect(sent()).toContain("$multipost-publish");
    expect(sent()).toContain("7 posts");
    expect(sent()).toContain("Tone: friendly");
  });

  it("asks for nothing but the idea", async () => {
    mount("resources");
    await page.getByRole("button", { name: "Post from an idea" }).click();
    const go = page.getByRole("button", { name: "Create and post" });
    await expect.element(go).toBeDisabled();
    await page.getByRole("textbox", { name: "Your idea" }).fill("Our new oat latte");
    await go.click();
    await expect.poll(sent).toContain("Our new oat latte");
    expect(sent()).toContain("djl_multipost_post");
  });

  it("writes about a pasted link", async () => {
    mount("resources");
    await page.getByRole("button", { name: "Post about a link" }).click();
    await page.getByRole("textbox", { name: "Link" }).fill("https://example.com/shoes");
    await page.getByRole("button", { name: "Create and post" }).click();
    await expect.poll(sent).toContain("https://example.com/shoes");
  });

  it("posts a picked photo without any typing", async () => {
    api.upload.mockResolvedValue({ name: "a.png", url: "Media/a", type: "image/png", size: 1 });
    mount("resources");
    await userEvent.upload(
      page.getByLabelText("Choose a photo or video"),
      new File(["x"], "a.png", { type: "image/png" }),
    );
    await expect.poll(sent).toContain("Media/a");
  });

  it("uses and remembers the style the person picked", async () => {
    const screen = await mount("resources");
    await page.getByRole("radio", { name: "Playful" }).click();
    await page.getByRole("checkbox", { name: "Hashtags" }).click();
    await page.getByRole("textbox", { name: "About your business" }).fill("A bakery in Toronto");
    await page.getByRole("button", { name: "Plan my week" }).click();
    await expect.poll(sent).toContain("Tone: playful");
    expect(sent()).toContain("No hashtags");
    expect(sent()).toContain("A bakery in Toronto");
    await screen.unmount();
    mount("resources");
    await expect
      .element(page.getByRole("radio", { name: "Playful" }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .element(page.getByRole("textbox", { name: "About your business" }))
      .toHaveValue("A bakery in Toronto");
  });

  it("says whether posts will go out without asking", async () => {
    state.accounts = [
      account("personal", "Personal", {
        autopilot: { dailyLimit: 5, expiresAt: "2031-01-01T00:00:00Z", timezone: "UTC" },
      }),
      account("brand", "Brand"),
    ];
    mount("resources");
    await expect.element(page.getByText("Autopilot is on for 1 of 2 accounts")).toBeVisible();
  });

  it("offers to switch Autopilot on when it is off everywhere", async () => {
    mount("resources");
    await expect.element(page.getByText("Autopilot is off")).toBeVisible();
    await page.getByRole("button", { name: "Turn on Autopilot" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Accounts" }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("asks a new person to connect an account before anything can be posted", async () => {
    state.accounts = [];
    mount("resources");
    await expect.element(page.getByRole("button", { name: "Plan my week" })).toBeDisabled();
    await page.getByRole("button", { name: "Connect an account" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Accounts" }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("keeps the full toolbox out of the way until someone asks for it, and remembers that", async () => {
    const screen = await mount("resources", <p>Every detailed tool</p>);
    await expect.element(page.getByText("Every detailed tool")).not.toBeInTheDocument();
    await page.getByRole("switch", { name: "Advanced tools" }).click();
    await expect.element(page.getByText("Every detailed tool")).toBeVisible();
    await screen.unmount();
    mount("resources", <p>Every detailed tool</p>);
    await expect.element(page.getByText("Every detailed tool")).toBeVisible();
  });
});

const pad = (n: number) => String(n).padStart(2, "0");
const local = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** Monday and Wednesday of next week at 3 pm, in this computer's own time. */
const nextWeek = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7) + offset);
  date.setHours(15, 0, 0, 0);
  return date;
};
describe("made for people who are not technical", () => {
  it("checks quietly that accounts are still signed in when the workspace opens", async () => {
    mount();
    await expect.poll(() => api.check.mock.calls.length).toBe(1);
  });

  it("says which account was signed out and takes the person straight to fixing it", async () => {
    state.accounts = [account("personal", "@sam", { status: "needs-login" })];
    mount();
    await expect
      .element(page.getByText("@sam signed you out. Sign in again so your posts keep going out."))
      .toBeVisible();
    await page.getByRole("button", { name: "Sign in again" }).click();
    await expect.element(page.getByText("Signed out", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText(/X signed you out, so posts here are on hold/))
      .toBeVisible();
  });

  it("removes a signed-out account for good", async () => {
    state.accounts = [
      account("personal", "@sam"),
      account("old", "X 2", { status: "disconnected", identity: null }),
    ];
    mount("accounts");
    await page.getByText("Signed out (1)").click();
    await page.getByRole("button", { name: "Remove X 2" }).click();
    await expect.poll(commands).toEqual([{ action: "remove-account", accountId: "old" }]);
  });

  it("explains a failed post in plain words and tucks the technical reason away", async () => {
    state.jobs = [job({ state: "failed", error: "fetch failed", submittedAt: null })];
    mount("queue");
    await expect
      .element(
        page.getByText(
          "DJL lost its connection while posting. Check your internet, then try again.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByText("fetch failed", { exact: true })).not.toBeVisible();
    await page.getByText("Technical details").click();
    await expect.element(page.getByText("fetch failed", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("sends the person to Accounts when the daily limit stopped a post", async () => {
    state.jobs = [
      job({
        state: "failed",
        error: "Autopilot reached its daily limit for this account",
        submittedAt: null,
      }),
    ];
    mount("queue");
    await page.getByRole("button", { name: "Go to Accounts" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Accounts" }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("shows how the post will look and warns before a platform would cut it off", async () => {
    mount();
    await expect
      .element(page.getByRole("region", { name: "How it will look" }))
      .not.toBeInTheDocument();
    await page.getByRole("textbox", { name: "Your post" }).fill("a".repeat(300));
    const preview = page.getByRole("region", { name: "How it will look" });
    await expect.element(preview).toBeVisible();
    await expect.element(preview.getByText("Personal")).toBeVisible();
    await expect
      .element(page.getByText("Too long for X by 20 characters. Shorten it, or X may cut it off."))
      .toBeVisible();
  });

  describe("week calendar", () => {
    const scheduled = () => {
      const at = nextWeek(0).toISOString();
      return job({
        state: "queued",
        dueAt: at,
        submittedAt: null,
        snapshot: { ...draft, scheduledAt: at, publicationMode: "scheduled" },
      });
    };

    it("moves a scheduled post to another day by dragging it there", async () => {
      state.jobs = [scheduled()];
      mount("queue");
      await page.getByRole("button", { name: "Next week" }).click();
      const wednesday = nextWeek(2);
      await userEvent.dragAndDrop(
        page.getByRole("button", { name: /Saved exact copy/ }),
        document.querySelector(`[data-day="${local(wednesday)}"]`)!,
      );
      await expect
        .poll(commands)
        .toEqual([
          { action: "reschedule-job", jobId: "job", scheduledAt: wednesday.toISOString() },
        ]);
    });

    it("moves a scheduled post by picking a new time, with no dragging needed", async () => {
      state.jobs = [scheduled()];
      mount("queue");
      await page.getByRole("button", { name: "Next week" }).click();
      await page.getByRole("button", { name: /Saved exact copy/ }).click();
      const tuesday = nextWeek(1);
      tuesday.setHours(9, 30);
      await page.getByLabelText("New date and time").fill(`${local(tuesday)}T09:30`);
      await page.getByRole("button", { name: "Move", exact: true }).click();
      await expect
        .poll(commands)
        .toEqual([{ action: "reschedule-job", jobId: "job", scheduledAt: tuesday.toISOString() }]);
    });

    it("does not offer to move a post that already went out", async () => {
      state.jobs = [job({ dueAt: nextWeek(0).toISOString() })];
      mount("queue");
      await page.getByText("Publishing calendar").click();
      await page.getByRole("button", { name: "Next week" }).click();
      await page.getByRole("button", { name: /Saved exact copy/ }).click();
      await expect.element(page.getByLabelText("New date and time")).not.toBeInTheDocument();
    });
  });
});
