import "../../index.css";
import type {
  ComputerActivityPage,
  ComputerActivityEvent,
  ComputerActivitySemanticSummary,
  ComputerUseHistorySettings,
  ComputerUseHistoryState,
  ComputerUseRequest,
  ComputerUseResponse,
  ComputerUseStatus,
  ThreadId,
} from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { loadLocaleCatalog, rendererI18n } from "../../i18n";
import {
  ComputerUseSettingsPanel,
  type ComputerUseSettingsPanelProps,
} from "./ComputerUseSettingsPanel";

const nativeStatus: ComputerUseStatus = {
  platform: "darwin",
  available: true,
  permissions: { accessibility: "denied", screenRecording: "not-determined" },
  capabilities: {
    observation: true,
    screenshots: true,
    backgroundActions: ["click", "type"],
    virtualCursor: true,
    passiveHistory: false,
  },
};
const event = {
  id: "event-1",
  source: "agent" as const,
  type: "action" as const,
  at: "2026-10-28T14:00:00Z",
  target: { bundleId: "com.djl.fixture", pid: 123, windowId: 42 },
  actionType: "type" as const,
  acknowledgement: "dispatched" as const,
  effect: "unverified" as const,
};
const passivePage: ComputerActivityPage = {
  snapshots: [
    {
      id: "snapshot-1",
      capturedAt: "2026-10-28T14:02:00.000Z",
      target: event.target,
      appName: "DJL Fixture",
      windowTitle: "Research notes",
      domain: "docs.example",
      webContext: true,
      labels: ["Project overview", "Privacy policy"],
    },
  ],
  summaries: [
    {
      id: "summary-1",
      periodSeconds: 600,
      startedAt: "2026-10-28T14:00:00.000Z",
      endedAt: "2026-10-28T14:10:00.000Z",
      snapshotCount: 3,
      contexts: [
        {
          bundleId: "com.djl.fixture",
          appName: "DJL Fixture",
          windowTitle: "Research notes",
          count: 3,
        },
      ],
    },
  ],
};
function mockRequest() {
  return vi.fn(async (request: ComputerUseRequest): Promise<ComputerUseResponse> => {
    switch (request.method) {
      case "status":
        return { method: request.method, result: nativeStatus };
      case "permissions.request":
        return { method: request.method, result: nativeStatus };
      case "apps.list":
        return {
          method: request.method,
          result: [{ bundleId: "com.djl.fixture", pid: 123, name: "DJL Fixture", windows: [] }],
        };
      case "history.settings":
        return {
          method: request.method,
          result: {
            enabled: false,
            paused: false,
            retentionDays: 30,
            intervalSeconds: 30,
            excludedBundleIds: [],
            excludedDomains: [],
          },
        };
      case "history.list":
        return {
          method: request.method,
          result: { events: request.source === "agent" ? [event] : [] },
        };
      case "history.clear":
        return { method: request.method, result: { deletedCount: 1 } };
      case "activity.clear":
        return { method: request.method, result: { deletedCount: 1 } };
      case "activity.list":
        return { method: request.method, result: { snapshots: [], summaries: [] } };
      case "stop":
        return { method: request.method, result: { stoppedSessionIds: [] } };
      default:
        return {
          method: request.method,
          error: { code: "unsupported", message: "Unavailable in fixture" },
        };
    }
  });
}
function passiveFixture(
  pageData: ComputerActivityPage = { snapshots: [], summaries: [] },
  initial: Partial<ComputerUseHistoryState> = {},
) {
  const request = mockRequest();
  const base = request.getMockImplementation()!;
  let saved: ComputerUseHistoryState = {
    enabled: false,
    paused: false,
    retentionDays: 30,
    intervalSeconds: 30,
    excludedBundleIds: [],
    excludedDomains: [],
    ...initial,
  };
  request.mockImplementation(async (input) => {
    if (input.method === "status")
      return {
        method: input.method,
        result: {
          ...nativeStatus,
          capabilities: { ...nativeStatus.capabilities, passiveHistory: true },
        },
      };
    if (input.method === "history.settings") return { method: input.method, result: saved };
    if (input.method === "history.configure") {
      saved = input.settings;
      return { method: input.method, result: saved };
    }
    if (input.method === "history.pause") {
      const { pauseResumeAt: _deadline, pauseResumeError: _error, ...policy } = saved;
      saved = {
        ...policy,
        paused: input.action !== "resume",
        ...(["30m", "1h", "tomorrow09"].includes(input.action)
          ? { pauseResumeAt: "2026-12-31T12:00:00.000Z" }
          : {}),
      };
      return { method: input.method, result: saved };
    }
    if (input.method === "activity.list") return { method: input.method, result: pageData };
    return base(input);
  });
  return {
    request,
    saved: () => saved,
    setSaved: (next: ComputerUseHistoryState) => {
      saved = next;
    },
  };
}
async function mount(
  request = mockRequest(),
  stopAll?: () => Promise<void>,
  subscribe?: (listener: () => void) => () => void,
  suggestionDraft?: ComputerUseSettingsPanelProps["suggestionDraft"],
) {
  const view = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <ComputerUseSettingsPanel
        request={request}
        {...(suggestionDraft ? { suggestionDraft } : {})}
        {...(stopAll ? { stopAll } : {})}
        {...(subscribe ? { subscribe } : {})}
      />
    </QueryClientProvider>,
  );
  await expect
    .element(
      page.getByRole("button", { name: rendererI18n.t("computerUse.refresh", { ns: "settings" }) }),
    )
    .toBeEnabled();
  return { request, view };
}
afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  await rendererI18n.changeLanguage("en");
  await page.viewport(1000, 1000);
});
describe("computer use settings", () => {
  it("reads permissions on mount and refresh without prompting", async () => {
    const { request } = await mount();
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect
      .poll(() => request.mock.calls.filter(([input]) => input.method === "status").length)
      .toBeGreaterThan(1);
    expect(request.mock.calls.some(([input]) => input.method === "permissions.request")).toBe(
      false,
    );
  });
  it("requests only the permission explicitly clicked by a human", async () => {
    const { request } = await mount();
    await page.getByRole("button", { name: "Request Accessibility access" }).click();
    await expect
      .poll(() => request.mock.calls.filter(([input]) => input.method === "permissions.request"))
      .toEqual([[{ method: "permissions.request", permission: "accessibility" }]]);
  });
  it("keeps rejected access and the dispatched effect honest", async () => {
    await mount();
    await expect.element(page.getByText("Denied", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Dispatched · Effect unverified", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("Agent · DJL Fixture · com.djl.fixture", { exact: true }))
      .toBeVisible();
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe(event.at);
  });
  it("does not present an enable toggle for unavailable passive recording", async () => {
    const { request } = await mount();
    await expect
      .element(page.getByText(/Passive recording is unavailable in this helper/))
      .toBeVisible();
    expect(document.querySelector('[role="switch"]')).toBeNull();
    expect(request.mock.calls.some(([input]) => input.method === "history.configure")).toBe(false);
    await page.getByRole("button", { name: "Passive computer history", exact: true }).click();
    await expect
      .element(page.getByText("AI summaries are unavailable from this host."))
      .toBeVisible();
    await expect
      .poll(() => request.mock.calls.some(([input]) => input.method === "activity.list"))
      .toBe(true);
  });
  it("requires a separate confirmation before deletion, and cancellation keeps history", async () => {
    const { request } = await mount();
    await page.getByRole("button", { name: "Clear selected history" }).click();
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    expect(request.mock.calls.some(([input]) => input.method === "history.clear")).toBe(false);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(request.mock.calls.some(([input]) => input.method === "history.clear")).toBe(false);
    await page.getByRole("button", { name: "Clear selected history" }).click();
    await page.getByRole("button", { name: "Delete history", exact: true }).click();
    await expect
      .poll(() => request.mock.calls.filter(([input]) => input.method === "history.clear"))
      .toEqual([[{ method: "history.clear", source: "agent" }]]);
    await expect
      .element(page.getByText("Selected history deleted.", { exact: true }))
      .toBeVisible();
  });
  it("shows transport failures and allows retry", async () => {
    const request = mockRequest();
    request.mockImplementationOnce(async () => {
      throw new Error("Native helper disconnected");
    });
    await mount(request);
    await expect.element(page.getByRole("alert")).toHaveTextContent("Native helper disconnected");
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect.element(page.getByText("Denied", { exact: true })).toBeVisible();
  });
  it("paginates sanitized history with the server cursor", async () => {
    const request = mockRequest();
    const base = request.getMockImplementation()!;
    request.mockImplementation(async (input) =>
      input.method === "history.list"
        ? {
            method: input.method,
            result: input.cursor
              ? { events: [{ ...event, id: "event-2", actionType: "click" }] }
              : { events: [event], nextCursor: "next-page" },
          }
        : base(input),
    );
    await mount(request);
    await page.getByRole("button", { name: "Load older events" }).click();
    await expect.element(page.getByText("Click", { exact: true })).toBeVisible();
    expect(
      request.mock.calls.some(
        ([input]) =>
          input.method === "history.list" &&
          input.cursor === "next-page" &&
          input.source === "agent",
      ),
    ).toBe(true);
  });
  it("configures recording only when the helper supports it", async () => {
    const request = mockRequest();
    const base = request.getMockImplementation()!;
    let saved: ComputerUseHistorySettings = {
      enabled: true,
      paused: false,
      retentionDays: 30,
      intervalSeconds: 30,
      excludedBundleIds: [] as string[],
      excludedDomains: [] as string[],
    };
    request.mockImplementation(async (input) => {
      if (input.method === "status")
        return {
          method: input.method,
          result: {
            ...nativeStatus,
            capabilities: { ...nativeStatus.capabilities, passiveHistory: true },
          },
        };
      if (input.method === "history.settings") return { method: input.method, result: saved };
      if (input.method === "history.pause") {
        saved = { ...saved, paused: input.action !== "resume" };
        return { method: input.method, result: saved };
      }
      if (input.method === "history.configure") {
        saved = {
          ...input.settings,
          excludedBundleIds: [...input.settings.excludedBundleIds],
          excludedDomains: [...input.settings.excludedDomains],
        };
        return { method: input.method, result: saved };
      }
      return base(input);
    });
    await mount(request);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("menuitem", { name: "Until I resume", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    await page
      .getByLabelText("Excluded app bundle IDs (one per line)")
      .fill("com.private.first\ncom.private.second");
    await page.getByLabelText("Excluded domains (one per line)").fill("private.example");
    await page.getByLabelText("Included app bundle IDs (one per line)").fill("com.djl.fixture");
    await page.getByLabelText("Included domains (one per line)").fill("docs.example");
    await page.getByRole("button", { name: "Save history settings" }).click();
    await expect
      .poll(() => saved.excludedBundleIds)
      .toEqual(["com.private.first", "com.private.second"]);
    expect(saved.excludedDomains).toEqual(["private.example"]);
    expect(saved.includedBundleIds).toEqual(["com.djl.fixture"]);
    expect(saved.includedDomains).toEqual(["docs.example"]);
    expect(saved.paused).toBe(true);
  });
  it("shows permission rejection without claiming access was granted", async () => {
    const request = mockRequest();
    const base = request.getMockImplementation()!;
    request.mockImplementation(async (input) =>
      input.method === "permissions.request"
        ? {
            method: input.method,
            error: { code: "permission-denied", message: "Access was declined" },
          }
        : base(input),
    );
    await mount(request);
    await page.getByRole("button", { name: "Request Accessibility access" }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Access was declined");
    await expect.element(page.getByText("Denied", { exact: true })).toBeVisible();
  });
  it("renders real passive observations and deterministic count summaries separately from agent actions", async () => {
    const request = mockRequest();
    const base = request.getMockImplementation()!;
    request.mockImplementation(async (input) =>
      input.method === "activity.list"
        ? { method: input.method, result: passivePage }
        : base(input),
    );
    await mount(request);
    expect(request.mock.calls.some(([input]) => input.method === "activity.list")).toBe(false);
    await page.getByRole("button", { name: "Passive computer history", exact: true }).click();
    await page.getByRole("button", { name: "Recorded context", exact: true }).click();
    const snapshot = page.getByRole("article", { name: "Recorded observation" });
    await expect.element(snapshot).toHaveTextContent("Research notes");
    await expect.element(snapshot).toHaveTextContent("docs.example");
    await expect
      .element(snapshot.getByRole("list", { name: "Static visible labels" }))
      .toHaveTextContent("Project overview");
    await page.getByRole("button", { name: "Observation counts", exact: true }).click();
    const summary = page.getByRole("article", { name: "Observation summary" });
    await expect.element(summary).toHaveTextContent("10-minute observation bucket");
    await expect.element(summary).toHaveTextContent("3 recorded observations");
    expect(document.querySelector('time[datetime="2026-10-28T14:10:00.000Z"]')).not.toBeNull();
    await expect
      .element(page.getByText("Dispatched · Effect unverified", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText(/Agent access requires the selected computer-history skill/))
      .toBeVisible();
    const container = document
      .querySelector('[data-slot="settings-row"]')
      ?.closest(".space-y-6") as HTMLElement;
    container.style.width = "320px";
    await expect.poll(() => container.scrollWidth).toBeLessThanOrEqual(320);
    await page.getByRole("button", { name: "Agent action log", exact: true }).click();
    await expect
      .element(page.getByText("Dispatched · Effect unverified", { exact: true }))
      .toBeVisible();
    await expect.element(snapshot).not.toBeInTheDocument();
    expect(
      request.mock.calls.some(
        ([input]) => input.method === "history.list" && input.source === "passive",
      ),
    ).toBe(false);
  });
  it("paginates and clears passive observations only through activity methods", async () => {
    const request = mockRequest();
    const base = request.getMockImplementation()!;
    request.mockImplementation(async (input) =>
      input.method === "activity.list"
        ? {
            method: input.method,
            result: input.cursor
              ? {
                  snapshots: [
                    {
                      ...passivePage.snapshots[0]!,
                      id: "snapshot-older",
                      windowTitle: "Earlier observation",
                    },
                  ],
                  summaries: passivePage.summaries,
                }
              : { ...passivePage, nextCursor: "passive-next" },
          }
        : base(input),
    );
    await mount(request);
    await page.getByRole("button", { name: "Passive computer history", exact: true }).click();
    await page.getByRole("button", { name: "Recorded context", exact: true }).click();
    await page.getByRole("button", { name: "Load older events" }).click();
    await expect.element(page.getByText("Earlier observation", { exact: true })).toBeVisible();
    expect(
      request.mock.calls.some(
        ([input]) => input.method === "activity.list" && input.cursor === "passive-next",
      ),
    ).toBe(true);
    expect(document.querySelectorAll('article[aria-label="Observation summary"]').length).toBe(0);
    await page.getByRole("button", { name: "Observation counts", exact: true }).click();
    expect(document.querySelectorAll('article[aria-label="Observation summary"]').length).toBe(1);
    await page.getByRole("button", { name: "Clear selected history" }).click();
    expect(request.mock.calls.some(([input]) => input.method === "activity.clear")).toBe(false);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(request.mock.calls.some(([input]) => input.method === "activity.clear")).toBe(false);
    await page.getByRole("button", { name: "Clear selected history" }).click();
    await page.getByRole("button", { name: "Delete history", exact: true }).click();
    await expect
      .poll(() => request.mock.calls.filter(([input]) => input.method === "activity.clear"))
      .toEqual([[{ method: "activity.clear" }]]);
    expect(request.mock.calls.some(([input]) => input.method === "history.clear")).toBe(false);
  });
  it("uses the privileged global Stop callback immediately", async () => {
    const stopAll = vi.fn(async () => {});
    const { request } = await mount(mockRequest(), stopAll);
    await page.getByRole("button", { name: "Stop all computer work" }).click();
    await expect.poll(() => stopAll.mock.calls.length).toBe(1);
    expect(request.mock.calls.some(([input]) => input.method === "stop")).toBe(false);
  });
  it("uses scoped Stop when no global bridge is supplied", async () => {
    const { request } = await mount();
    await page.getByRole("button", { name: "Stop this chat’s computer work" }).click();
    await expect
      .poll(() => request.mock.calls.filter(([input]) => input.method === "stop"))
      .toEqual([[{ method: "stop" }]]);
  });
  it("fits a narrow settings panel without horizontal overflow", async () => {
    await mount();
    const container = document.querySelector('[data-slot="settings-row"]')?.closest(".space-y-6");
    expect(container).toBeTruthy();
    (container as HTMLElement).style.width = "320px";
    await expect.poll(() => (container as HTMLElement).scrollWidth).toBeLessThanOrEqual(320);
  });
});

describe("history consent and host status", () => {
  it("keeps missing consents off when master recording is enabled", async () => {
    const fixture = passiveFixture();
    await mount(fixture.request);
    const capture = page.getByRole("switch", { name: "Capture interactions", exact: true });
    const semantic = page.getByRole("switch", { name: "AI history summaries", exact: true });
    await expect.element(capture).not.toBeChecked();
    await expect.element(semantic).not.toBeChecked();
    await page.getByRole("switch", { name: "Enable passive recording" }).click();
    await expect
      .element(page.getByRole("switch", { name: "Enable passive recording" }))
      .toBeChecked();
    await expect.element(capture).not.toBeChecked();
    await expect.element(semantic).not.toBeChecked();
    expect(fixture.saved().interactionCaptureEnabled).not.toBe(true);
    expect(fixture.saved().semanticSummariesEnabled).not.toBe(true);
  }, 5000);
  it("preserves unsaved form edits across independent consent changes and saves fresh controls", async () => {
    const fixture = passiveFixture();
    await mount(fixture.request);
    await page.getByLabelText("Excluded domains (one per line)").fill("private.example");
    await page.getByRole("switch", { name: "AI history summaries", exact: true }).click();
    await expect
      .element(page.getByRole("switch", { name: "AI history summaries", exact: true }))
      .toBeChecked();
    expect(fixture.saved().excludedDomains).toEqual([]);
    expect(fixture.saved().interactionCaptureEnabled).not.toBe(true);
    await expect
      .element(page.getByLabelText("Excluded domains (one per line)"))
      .toHaveValue("private.example");
    await expect.element(page.getByRole("button", { name: "Save history settings" })).toBeEnabled();
    await page.getByRole("switch", { name: "Capture interactions", exact: true }).click();
    await expect
      .element(page.getByRole("switch", { name: "Capture interactions", exact: true }))
      .toBeChecked();
    await page.getByRole("button", { name: "Save history settings" }).click();
    await expect.poll(() => fixture.saved().excludedDomains).toEqual(["private.example"]);
    expect(fixture.saved().semanticSummariesEnabled).toBe(true);
    expect(fixture.saved().interactionCaptureEnabled).toBe(true);
    await page.getByRole("switch", { name: "Enable passive recording" }).click();
    await expect
      .element(page.getByRole("switch", { name: "Enable passive recording" }))
      .toBeChecked();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("menuitem", { name: "Until I resume", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    expect(fixture.saved().semanticSummariesEnabled).toBe(true);
    expect(fixture.saved().interactionCaptureEnabled).toBe(true);
  }, 5000);
  it("disables duplicate changes while pending and shows rejected consent without optimistic success", async () => {
    const fixture = passiveFixture();
    const base = fixture.request.getMockImplementation()!;
    let reject!: (error: Error) => void;
    fixture.request.mockImplementation((input) =>
      input.method === "history.configure"
        ? new Promise((_, rejectRequest) => {
            reject = rejectRequest;
          })
        : base(input),
    );
    await mount(fixture.request);
    const capture = page.getByRole("switch", { name: "Capture interactions", exact: true });
    await capture.click();
    await expect.element(capture).toBeDisabled();
    await expect.element(capture).not.toBeChecked();
    await expect
      .element(page.getByRole("switch", { name: "AI history summaries", exact: true }))
      .toBeDisabled();
    reject(new Error("Synthetic consent write failed"));
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Synthetic consent write failed");
    await expect.element(capture).toBeEnabled();
    await expect.element(capture).not.toBeChecked();
  }, 5000);
  it("renders actual host failures and counts only after opening passive history", async () => {
    await page.viewport(1100, 900);
    const fixture = passiveFixture({
      snapshots: [],
      summaries: [],
      interactionStatus: {
        state: "unavailable",
        reason: "secure-state-unavailable",
        droppedRecords: 3,
      },
      semanticStatus: { enabled: true, pending: 2, running: false, lastFailure: "authentication" },
    });
    await mount(fixture.request);
    expect(fixture.request.mock.calls.some(([input]) => input.method === "activity.list")).toBe(
      false,
    );
    await page.getByRole("button", { name: "Passive computer history", exact: true }).click();
    await expect
      .element(page.getByText("Secure context could not be verified.", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("3 interaction records dropped", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("2 summaries pending", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Provider authentication failed.", { exact: true }))
      .toBeVisible();
    const container = document
      .querySelector('[data-slot="settings-row"]')
      ?.closest(".space-y-6") as HTMLElement;
    const consent = document
      .querySelector('[aria-label="Capture interactions"]')
      ?.closest("section") as HTMLElement;
    consent.scrollIntoView({ block: "start" });
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/preserved-controls-consent-desktop.png",
    });
    await page
      .getByRole("group", { name: "Interaction observer", exact: true })
      .element()
      .scrollIntoView({ block: "center" });
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/preserved-controls-status-desktop.png",
    });
    await page.viewport(320, 900);
    container.style.width = "320px";
    await expect.poll(() => container.scrollWidth).toBeLessThanOrEqual(320);
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/preserved-controls-consent-narrow.png",
    });
  }, 5000);
  it("keeps edits made while Save is pending for the next Save", async () => {
    const fixture = passiveFixture();
    const base = fixture.request.getMockImplementation()!;
    let release!: () => void;
    let first = true;
    fixture.request.mockImplementation(async (input) => {
      if (input.method === "history.configure" && first) {
        first = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return base(input);
    });
    await mount(fixture.request);
    await page.getByLabelText("Retention (days)").fill("40");
    await page.getByRole("button", { name: "Save history settings" }).click();
    await expect
      .element(page.getByRole("button", { name: "Save history settings" }))
      .toBeDisabled();
    await page.getByLabelText("Retention (days)").fill("50");
    release();
    await expect.element(page.getByRole("button", { name: "Save history settings" })).toBeEnabled();
    expect(fixture.saved().retentionDays).toBe(40);
    await expect.element(page.getByLabelText("Retention (days)")).toHaveValue(50);
    await page.getByRole("button", { name: "Save history settings" }).click();
    await expect.poll(() => fixture.saved().retentionDays).toBe(50);
    await expect
      .element(page.getByRole("button", { name: "Save history settings" }))
      .toBeDisabled();
  }, 5000);
  it.each([
    ["inactive", "Inactive", false, false, "Processing off"],
    ["starting", "Starting observer", true, false, "No summary currently running"],
    ["observing", "Observing eligible contexts", true, true, "Generating a summary"],
  ] as const)(
    "shows host %s state without inventing provider readiness",
    async (state, label, enabled, running, summaryLabel) => {
      const fixture = passiveFixture({
        snapshots: [],
        summaries: [],
        interactionStatus: { state, droppedRecords: 0 },
        semanticStatus: { enabled, pending: 0, running },
      });
      await mount(fixture.request);
      await page.getByRole("button", { name: "Passive computer history", exact: true }).click();
      await expect.element(page.getByText(label, { exact: true })).toBeVisible();
      await expect.element(page.getByText(summaryLabel, { exact: true })).toBeVisible();
      await expect.element(page.getByText("0 summaries pending", { exact: true })).toBeVisible();
    },
    5000,
  );
  it("fits translated consent and status copy at 320px without changing host consent", async () => {
    await page.viewport(320, 900);
    const catalog = await loadLocaleCatalog("fr");
    rendererI18n.addResourceBundle("fr", "settings", catalog.settings, true, true);
    await rendererI18n.changeLanguage("fr");
    const fixture = passiveFixture({
      snapshots: [],
      summaries: [],
      interactionStatus: { state: "observing", droppedRecords: 1 },
      semanticStatus: {
        enabled: false,
        pending: 1,
        running: false,
        lastFailure: "provider-unavailable",
      },
    });
    await mount(fixture.request);
    const t = (key: string) => rendererI18n.t(`computerUse.${key}`, { ns: "settings" });
    await expect
      .element(page.getByRole("switch", { name: t("captureInteractions"), exact: true }))
      .not.toBeChecked();
    const container = document
      .querySelector('[data-slot="settings-row"]')
      ?.closest(".space-y-6") as HTMLElement;
    await expect.poll(() => container.scrollWidth).toBeLessThanOrEqual(320);
    document
      .querySelector('[aria-label="' + t("captureInteractions") + '"]')
      ?.closest("section")
      ?.scrollIntoView({ block: "start" });
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/preserved-controls-consent-french-narrow.png",
    });
    await page.getByRole("button", { name: t("passiveHistory"), exact: true }).click();
    await expect.element(page.getByText("1 résumé en attente", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Fournisseur configuré indisponible.", { exact: true }))
      .toBeVisible();
    await expect.poll(() => container.scrollWidth).toBeLessThanOrEqual(320);
    expect(fixture.request.mock.calls.some(([input]) => input.method === "history.configure")).toBe(
      false,
    );
  }, 5000);
  it("reports absent legacy host statuses as unavailable", async () => {
    const fixture = passiveFixture();
    await mount(fixture.request);
    await page.getByRole("button", { name: "Passive computer history", exact: true }).click();
    await expect
      .element(page.getByText("Interaction status unavailable", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("AI summary status unavailable", { exact: true }))
      .toBeVisible();
  }, 5000);
});

describe("host pause readback compatibility", () => {
  it.each([
    { pauseResumeAt: "2026-12-31T12:00:00.000Z" },
    { pauseResumeError: "resume-failed" as const },
  ])(
    "strips host metadata from controls and form Save while preserving drafts: %j",
    async (metadata) => {
      const fixture = passiveFixture();
      const base = fixture.request.getMockImplementation()!;
      let saved: ComputerUseHistoryState = {
        ...fixture.saved(),
        enabled: true,
        paused: true,
        ...metadata,
      };
      fixture.request.mockImplementation(async (input) => {
        if (input.method === "history.settings") return { method: input.method, result: saved };
        if (input.method === "history.configure") {
          saved = { ...input.settings, ...metadata };
          return { method: input.method, result: saved };
        }
        return base(input);
      });
      await mount(fixture.request);
      await page.getByLabelText("Retention (days)").fill("45");
      await page.getByRole("switch", { name: "AI history summaries", exact: true }).click();
      await expect
        .element(page.getByRole("switch", { name: "AI history summaries", exact: true }))
        .toBeChecked();
      await expect.element(page.getByLabelText("Retention (days)")).toHaveValue(45);
      await page.getByRole("button", { name: "Save history settings" }).click();
      await expect.poll(() => saved.retentionDays).toBe(45);
      expect(saved.semanticSummariesEnabled).toBe(true);
      expect(saved.interactionCaptureEnabled).not.toBe(true);
      const configs = fixture.request.mock.calls.flatMap(([input]) =>
        input.method === "history.configure" ? [input.settings] : [],
      );
      expect(configs).toHaveLength(2);
      for (const settings of configs) {
        expect(settings).not.toHaveProperty("pauseResumeAt");
        expect(settings).not.toHaveProperty("pauseResumeError");
      }
    },
    5000,
  );
});

describe("timed history pause", () => {
  const deadline = "2026-12-31T12:00:00.000Z";
  const pauseCalls = (request: ReturnType<typeof mockRequest>) =>
    request.mock.calls.filter(([input]) => input.method === "history.pause");
  const choose = async (label: string, paused = false) => {
    await page
      .getByRole("button", { name: paused ? "Change pause duration" : "Pause", exact: true })
      .click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  };

  it.each([
    ["30m", "For 30 minutes"],
    ["1h", "For 1 hour"],
    ["tomorrow09", "Until tomorrow at 09:00"],
    ["indefinite", "Until I resume"],
  ] as const)(
    "sends only fixed pause actions: %s",
    async (action, label) => {
      const fixture = passiveFixture(undefined, { enabled: true });
      await mount(fixture.request);
      await page.getByLabelText("Retention (days)").fill("61");
      await choose(label);
      await expect.element(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
      expect(pauseCalls(fixture.request)).toEqual([[{ method: "history.pause", action }]]);
      expect(
        fixture.request.mock.calls.some(([input]) => input.method === "history.configure"),
      ).toBe(false);
      await expect.element(page.getByLabelText("Retention (days)")).toHaveValue(61);
      expect(fixture.saved().interactionCaptureEnabled).not.toBe(true);
      expect(fixture.saved().semanticSummariesEnabled).not.toBe(true);
      if (action === "indefinite") {
        await expect
          .element(page.getByText("Paused until you resume recording.", { exact: true }))
          .toBeVisible();
        expect(document.querySelector(`time[datetime="${deadline}"]`)).toBeNull();
      } else {
        const time = document.querySelector(`time[datetime="${deadline}"]`);
        expect(time?.textContent).toBe(new Date(deadline).toLocaleString(rendererI18n.language));
      }
    },
    5000,
  );

  it("replaces a paused duration and resumes with exact commands without saving any draft", async () => {
    const fixture = passiveFixture(undefined, { enabled: true, paused: true });
    await mount(fixture.request);
    await expect
      .element(page.getByText("Paused until you resume recording.", { exact: true }))
      .toBeVisible();
    await page.getByLabelText("Retention (days)").fill("45");
    await page.getByLabelText("Capture interval (seconds)").fill("60");
    await page.getByLabelText("Included app bundle IDs (one per line)").fill("com.djl.fixture");
    await page.getByLabelText("Included domains (one per line)").fill("docs.example");
    await page.getByLabelText("Excluded app bundle IDs (one per line)").fill("com.private.fixture");
    await page.getByLabelText("Excluded domains (one per line)").fill("private.example");
    await choose("For 1 hour", true);
    expect(fixture.saved().paused).toBe(true);
    await expect.element(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    expect(pauseCalls(fixture.request)).toEqual([
      [{ method: "history.pause", action: "1h" }],
      [{ method: "history.pause", action: "resume" }],
    ]);
    expect(fixture.request.mock.calls.some(([input]) => input.method === "history.configure")).toBe(
      false,
    );
    fixture.setSaved({
      ...fixture.saved(),
      interactionCaptureEnabled: true,
      semanticSummariesEnabled: true,
    });
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect
      .element(page.getByRole("switch", { name: "AI history summaries", exact: true }))
      .toBeChecked();
    await expect.element(page.getByLabelText("Retention (days)")).toHaveValue(45);
    await expect.element(page.getByLabelText("Capture interval (seconds)")).toHaveValue(60);
    await page.getByRole("button", { name: "Save history settings" }).click();
    await expect
      .poll(() => fixture.saved())
      .toEqual({
        enabled: true,
        paused: false,
        retentionDays: 45,
        intervalSeconds: 60,
        includedBundleIds: ["com.djl.fixture"],
        includedDomains: ["docs.example"],
        excludedBundleIds: ["com.private.fixture"],
        excludedDomains: ["private.example"],
        interactionCaptureEnabled: true,
        semanticSummariesEnabled: true,
      });
    const configs = fixture.request.mock.calls.filter(
      ([input]) => input.method === "history.configure",
    );
    expect(configs).toHaveLength(1);
  }, 5000);

  it("puts returned deadline into settings cache before a held refresh completes", async () => {
    const fixture = passiveFixture(undefined, { enabled: true });
    const base = fixture.request.getMockImplementation()!;
    let hold = false;
    let release!: () => void;
    fixture.request.mockImplementation(async (input) => {
      if (input.method === "history.settings" && hold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      const response = await base(input);
      if (input.method === "history.pause") hold = true;
      return response;
    });
    await mount(fixture.request);
    try {
      await choose("For 30 minutes");
      await expect.element(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
      expect(document.querySelector(`time[datetime="${deadline}"]`)).not.toBeNull();
      expect(release).toBeTypeOf("function");
    } finally {
      release?.();
    }
  }, 5000);

  it.each([false, true])(
    "disables pause commands pending and keeps rejected host state: paused=%s",
    async (paused) => {
      const fixture = passiveFixture(undefined, {
        enabled: true,
        paused,
        ...(paused ? { pauseResumeAt: deadline } : {}),
      });
      const base = fixture.request.getMockImplementation()!;
      let reject!: (error: Error) => void;
      fixture.request.mockImplementation((input) =>
        input.method === "history.pause"
          ? new Promise((_, rejectRequest) => {
              reject = rejectRequest;
            })
          : base(input),
      );
      await mount(fixture.request);
      if (paused) await page.getByRole("button", { name: "Resume", exact: true }).click();
      else await choose("For 30 minutes");
      await expect
        .element(
          page.getByRole("button", {
            name: paused ? "Change pause duration" : "Pause",
            exact: true,
          }),
        )
        .toBeDisabled();
      if (paused)
        await expect
          .element(page.getByRole("button", { name: "Resume", exact: true }))
          .toBeDisabled();
      else
        await expect
          .element(page.getByRole("button", { name: "Resume", exact: true }))
          .not.toBeInTheDocument();
      reject(new Error("Synthetic pause write failed"));
      await expect
        .element(page.getByRole("alert"))
        .toHaveTextContent("Synthetic pause write failed");
      await expect
        .element(
          page.getByRole("button", {
            name: paused ? "Change pause duration" : "Pause",
            exact: true,
          }),
        )
        .toBeEnabled();
      expect(fixture.saved().paused).toBe(paused);
      expect(pauseCalls(fixture.request)).toHaveLength(1);
    },
    5000,
  );

  it.each([undefined, deadline])(
    "shows generic host pause failure without advertising a timer: %s",
    async (pauseResumeAt) => {
      const fixture = passiveFixture(undefined, {
        enabled: true,
        paused: true,
        pauseResumeError: "resume-failed",
        ...(pauseResumeAt ? { pauseResumeAt } : {}),
      });
      await mount(fixture.request);
      await expect
        .element(
          page.getByText(
            "Recording remains paused because a recording change could not be applied. Try resuming manually.",
            { exact: true },
          ),
        )
        .toBeVisible();
      expect(document.querySelector(`time[datetime="${deadline}"]`)).toBeNull();
      await expect
        .element(page.getByText("Automatic resume scheduled for", { exact: true }))
        .not.toBeInTheDocument();
      await expect.element(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    },
    5000,
  );

  it("keeps an already expired local deadline paused until the host changes it", async () => {
    const expired = "2000-01-01T00:00:00.000Z";
    const fixture = passiveFixture(undefined, {
      enabled: true,
      paused: true,
      pauseResumeAt: expired,
    });
    await mount(fixture.request);
    await expect.element(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    expect(document.querySelector(`time[datetime="${expired}"]`)).not.toBeNull();
    expect(pauseCalls(fixture.request)).toEqual([]);
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect.element(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    expect(pauseCalls(fixture.request)).toEqual([]);
  }, 5000);

  it("opens and cancels the keyboard menu without a command", async () => {
    const fixture = passiveFixture(undefined, { enabled: true });
    await mount(fixture.request);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "For 30 minutes", exact: true }))
      .toBeVisible();
    expect(pauseCalls(fixture.request)).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    expect(pauseCalls(fixture.request)).toEqual([]);
    expect(fixture.request.mock.calls.some(([input]) => input.method === "history.configure")).toBe(
      false,
    );
  }, 5000);

  it.each([false, true])(
    "disables pause actions when master recording is off: paused=%s",
    async (paused) => {
      const fixture = passiveFixture(undefined, { enabled: false, paused });
      await mount(fixture.request);
      await expect
        .element(
          page.getByRole("button", {
            name: paused ? "Change pause duration" : "Pause",
            exact: true,
          }),
        )
        .toBeDisabled();
      if (paused)
        await expect
          .element(page.getByRole("button", { name: "Resume", exact: true }))
          .toBeDisabled();
      expect(pauseCalls(fixture.request)).toEqual([]);
    },
    5000,
  );

  it("renders timed pause and translated choices on desktop and narrow French", async () => {
    await page.viewport(1100, 900);
    const fixture = passiveFixture(undefined, {
      enabled: true,
      paused: true,
      pauseResumeAt: deadline,
    });
    await mount(fixture.request);
    const container = document
      .querySelector('[data-slot="settings-row"]')
      ?.closest(".space-y-6") as HTMLElement;
    document
      .querySelector('time[datetime="' + deadline + '"]')
      ?.closest("section")
      ?.scrollIntoView({ block: "start" });
    await page.getByRole("button", { name: "Change pause duration", exact: true }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "Until tomorrow at 09:00", exact: true }))
      .toBeVisible();
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/preserved-controls-menu-desktop.png",
    });
    await userEvent.keyboard("{Escape}");
    const catalog = await loadLocaleCatalog("fr");
    rendererI18n.addResourceBundle("fr", "settings", catalog.settings, true, true);
    await rendererI18n.changeLanguage("fr");
    await page.viewport(320, 900);
    const t = (key: string) => rendererI18n.t(`computerUse.${key}`, { ns: "settings" });
    await page.getByRole("button", { name: t("changePauseDuration"), exact: true }).click();
    await expect
      .element(page.getByRole("menuitem", { name: t("pauseTomorrow"), exact: true }))
      .toBeVisible();
    await expect.poll(() => container.scrollWidth).toBeLessThanOrEqual(320);
    await expect.poll(() => document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/preserved-controls-menu-french-narrow.png",
    });
    expect(pauseCalls(fixture.request)).toEqual([]);
  }, 5000);
});

const semanticSummary: ComputerActivitySemanticSummary = {
  id: "semantic-1",
  periodSeconds: 600,
  startedAt: "2026-10-28T14:00:00.000Z",
  endedAt: "2026-10-28T14:10:00.000Z",
  generatedAt: "2026-10-28T14:11:00.000Z",
  sourceIds: ["record-1"],
  sourceFingerprint: "a".repeat(64),
  provider: "fixture-provider",
  model: "fixture-model",
  content: {
    title: "Reviewed the history proposal",
    description: "Compared recorded context with the proposal.",
    applications: ["com.djl.fixture"],
    memory: "Remember the review constraints.",
    recording: "Recorded proposal review context.",
    citations: ["record-1"],
    suggestion: { type: "skill", name: "Review checklist", description: "A suggested checklist." },
  },
};
const recordedEvent: ComputerActivityEvent = {
  id: "record-1",
  capturedAt: "2026-10-28T14:03:00.000Z",
  target: event.target,
  appName: "DJL Fixture",
  windowTitle: "Context window",
  domain: "docs.example",
  kind: "selection-changed",
  text: "Recorded edit text",
  keyEquivalent: "K",
  modifiers: ["command", "shift"],
  mouse: {
    button: "left",
    clickCount: 1,
    origin: { x: 0, y: 2 },
    destination: { x: 3, y: 0 },
    deltaX: 0,
    deltaY: 0,
  },
  selection: { text: "Selected evidence", location: 0, length: 0 },
  ax: { mode: "diff", text: "AX changed evidence\nSecond context line" },
};
async function openPassiveView(name?: "AI summaries" | "Recorded context" | "Observation counts") {
  await page.getByRole("button", { name: "Passive computer history", exact: true }).click();
  if (name) await page.getByRole("button", { name, exact: true }).click();
}
describe("passive history timeline", () => {
  it("defaults to semantic summaries with inert content and complete provenance", async () => {
    const errors = vi.spyOn(console, "error");
    const warnings = vi.spyOn(console, "warn");
    const injection =
      '<img src=x onerror="window.__historyInjected=true"> [run](javascript:alert(1))';
    const summary = {
      ...semanticSummary,
      provider: "p".repeat(64),
      model: "m".repeat(256),
      content: {
        ...semanticSummary.content,
        title: injection,
        description: "D".repeat(2048),
        memory: injection + "\n" + "M".repeat(700),
        recording: "R".repeat(1800),
      },
    };
    const fixture = passiveFixture({ ...passivePage, semanticSummaries: [summary] });
    await mount(fixture.request);
    await openPassiveView();
    await expect
      .element(page.getByRole("button", { name: "AI summaries", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    const article = page.getByRole("article", { name: "AI history summary", exact: true });
    await expect.element(article).toHaveTextContent(injection);
    await expect.element(article).toHaveTextContent("10-minute summary");
    await expect.element(article).toHaveTextContent("com.djl.fixture");
    await expect.element(article).toHaveTextContent(summary.model);
    expect(
      article.element().querySelector('time[datetime="2026-10-28T14:11:00.000Z"]'),
    ).not.toBeNull();
    await article.getByText("Source details", { exact: true }).click();
    await expect.element(article).toHaveTextContent("record-1");
    await expect.element(article).toHaveTextContent("a".repeat(64));
    await article.getByText("Memory", { exact: true }).click();
    await article.getByText("Recording", { exact: true }).click();
    await expect
      .element(article.getByText(summary.content.recording, { exact: true }))
      .toBeVisible();
    expect(article.element().querySelectorAll("a,img,script").length).toBe(0);
    expect((window as unknown as Record<string, unknown>).__historyInjected).toBeUndefined();
    const container = article.element().closest(".space-y-6") as HTMLElement;
    await page.viewport(1100, 900);
    article.element().closest("section")!.scrollIntoView({ block: "start" });
    await expect
      .element(page.getByRole("heading", { name: "Activity history", exact: true }))
      .toBeVisible();
    expect(document.querySelector("vite-error-overlay")).toBeNull();
    console.info(
      "TIMELINE_QA_IDENTITY",
      JSON.stringify({
        url: location.href,
        title: document.title,
        viewport: [innerWidth, innerHeight],
        host: "synthetic mocked host",
        overlay: false,
      }),
    );
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/timeline-controls-desktop.png",
    });
    article.element().scrollIntoView({ block: "start" });
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/semantic-desktop.png",
    });
    await page.viewport(320, 900);
    container.style.width = "320px";
    await expect.poll(() => container.scrollWidth).toBeLessThanOrEqual(320);
    await expect.poll(() => document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/semantic-320.png",
    });
    article
      .getByText("Source details", { exact: true })
      .element()
      .scrollIntoView({ block: "center" });
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/semantic-provenance-320.png",
    });
    article.getByText("Recording", { exact: true }).element().scrollIntoView({ block: "start" });
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/semantic-recording-320.png",
    });
    expect(errors.mock.calls).toEqual([]);
    expect(warnings.mock.calls).toEqual([]);
  }, 5000);
  it("keeps raw and semantic cursors independent despite repeated irrelevant data", async () => {
    const fixture = passiveFixture();
    const base = fixture.request.getMockImplementation()!;
    fixture.request.mockImplementation(async (input) => {
      if (input.method !== "activity.list") return base(input);
      const nextSemantic = {
        ...semanticSummary,
        id: "semantic-2",
        periodSeconds: 21600 as const,
        startedAt: "2026-10-28T08:00:00.000Z",
        endedAt: "2026-10-28T14:00:00.000Z",
        content: { ...semanticSummary.content, title: "Six hour review" },
      };
      return {
        method: input.method,
        result: {
          ...passivePage,
          snapshots: input.cursor
            ? [
                passivePage.snapshots[0]!,
                {
                  ...passivePage.snapshots[0]!,
                  id: "snapshot-older",
                  capturedAt: "2026-10-28T13:00:00.000Z",
                  windowTitle: "Older context",
                },
              ]
            : passivePage.snapshots,
          events: [recordedEvent],
          semanticSummaries: input.semanticCursor ? [nextSemantic] : [semanticSummary],
          ...(!input.cursor ? { nextCursor: "raw-next" } : {}),
          ...(!input.semanticCursor ? { nextSemanticCursor: "semantic-next" } : {}),
        },
      };
    });
    await mount(fixture.request);
    await openPassiveView();
    await page.getByRole("button", { name: "Load older summaries", exact: true }).click();
    await expect.element(page.getByText("Six hour review", { exact: true })).toBeVisible();
    await expect.element(page.getByText("6-hour summary", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Load older summaries", exact: true }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Recorded context", exact: true }).click();
    await page.getByRole("button", { name: "Load older events", exact: true }).click();
    await expect.element(page.getByText("Older context", { exact: true })).toBeVisible();
    const records = [...document.querySelectorAll("[data-history-record]")];
    expect(records.map((node) => node.getAttribute("data-history-record"))).toEqual([
      "event:record-1",
      "snapshot:snapshot-1",
      "snapshot:snapshot-older",
    ]);
    await expect
      .element(page.getByRole("button", { name: "Load older events", exact: true }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "AI summaries", exact: true }).click();
    expect(document.querySelectorAll('article[aria-label="AI history summary"]').length).toBe(2);
    const calls = fixture.request.mock.calls.flatMap(([input]) =>
      input.method === "activity.list" ? [input] : [],
    );
    expect(calls).toEqual([
      { method: "activity.list", limit: 50 },
      { method: "activity.list", limit: 50, semanticCursor: "semantic-next" },
      { method: "activity.list", limit: 50 },
      { method: "activity.list", limit: 50, cursor: "raw-next" },
    ]);
    await page.getByRole("button", { name: "Refresh status", exact: true }).click();
    await expect
      .poll(
        () =>
          fixture.request.mock.calls.filter(([input]) => input.method === "activity.list").length,
      )
      .toBeGreaterThan(calls.length);
  }, 5000);
  it("renders recorded fields and zero values, with deterministic ties and no invented context", async () => {
    const minimal = {
      id: "a-event",
      capturedAt: recordedEvent.capturedAt,
      target: event.target,
      appName: "Minimal app",
      windowTitle: "Minimal window",
      kind: "click" as const,
    };
    const fixture = passiveFixture({
      ...passivePage,
      events: [recordedEvent, minimal, { ...minimal, id: "A-event" }, recordedEvent],
    });
    await mount(fixture.request);
    await openPassiveView("Recorded context");
    const article = page
      .getByRole("article", { name: "Recorded interaction", exact: true })
      .filter({ hasText: "Recorded edit text" });
    await expect.element(article).toHaveTextContent("Selection changed");
    for (const value of [
      "Selected evidence",
      "Selection location: 0",
      "Selection length: 0",
      "Horizontal delta: 0",
      "Vertical delta: 0",
      "Origin: 0, 2",
      "Destination: 3, 0",
      "Key: K",
      "Command",
      "Shift",
      "Mouse button: Left",
      "Click count: 1",
    ])
      await expect.element(article).toHaveTextContent(value);
    await article.getByText("Accessibility context: changes", { exact: true }).click();
    await expect.element(article.getByText(recordedEvent.ax!.text, { exact: true })).toBeVisible();
    expect(
      [...document.querySelectorAll("[data-history-record]")].map((n) =>
        n.getAttribute("data-history-record"),
      ),
    ).toEqual(["event:A-event", "event:a-event", "event:record-1", "snapshot:snapshot-1"]);
    const minimalArticle = document.querySelector('[data-history-record="event:a-event"]')!;
    expect(minimalArticle.querySelector("details")).toBeNull();
    expect(minimalArticle.textContent).not.toContain("Selection location");
    await page.viewport(320, 900);
    article.element().scrollIntoView({ block: "start" });
    await expect.poll(() => document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    await page.screenshot({
      path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/recorded-320.png",
    });
  }, 5000);
  it("separates bounded count cards and truncation from raw continuation and AI results", async () => {
    const fixture = passiveFixture({
      ...passivePage,
      nextCursor: "raw-next",
      countsTruncated: true,
      semanticSummaries: [],
    });
    await mount(fixture.request);
    await openPassiveView("Observation counts");
    await expect
      .element(page.getByRole("article", { name: "Observation summary", exact: true }))
      .toHaveTextContent("3 recorded observations");
    await expect
      .element(
        page.getByText("Counts cover a bounded set of observations and may be incomplete.", {
          exact: true,
        }),
      )
      .toBeVisible();
    await expect
      .element(page.getByText(/Counts do not measure time spent or infer intent/))
      .toBeVisible();
    expect(
      document.querySelectorAll(
        'article[aria-label="Recorded observation"],article[aria-label="AI history summary"]',
      ).length,
    ).toBe(0);
    await expect
      .element(page.getByRole("button", { name: "Load older events", exact: true }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Recorded context", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Load older events", exact: true }))
      .toBeVisible();
  }, 5000);
  it("distinguishes unavailable semantic support from an empty generated-summary list", async () => {
    const fixture = passiveFixture(passivePage);
    await mount(fixture.request);
    await openPassiveView();
    await expect
      .element(page.getByText("AI summaries are unavailable from this host.", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("No AI summaries in this history.", { exact: true }))
      .not.toBeInTheDocument();
    await cleanup();
    await mount(passiveFixture({ ...passivePage, semanticSummaries: [] }).request);
    await openPassiveView();
    await expect
      .element(page.getByText("No AI summaries in this history.", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("AI summaries are unavailable from this host.", { exact: true }))
      .not.toBeInTheDocument();
  }, 5000);
  it("shows only the selected stream loading and errors and clears via existing confirmation", async () => {
    const fixture = passiveFixture();
    const base = fixture.request.getMockImplementation()!;
    let release!: () => void;
    let activityCalls = 0;
    fixture.request.mockImplementation(async (input) => {
      if (input.method !== "activity.list") return base(input);
      activityCalls += 1;
      if (activityCalls === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          method: input.method,
          result: { snapshots: [], summaries: [], semanticSummaries: [] },
        };
      }
      return {
        method: input.method,
        error: { code: "unsupported", message: "Raw fixture unavailable" },
      };
    });
    await mount(fixture.request);
    await openPassiveView();
    await expect.element(page.getByText("Loading…", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Recorded context", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Raw fixture unavailable");
    await expect.element(page.getByText("Loading…", { exact: true })).not.toBeInTheDocument();
    await page.getByRole("button", { name: "AI summaries", exact: true }).click();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    release();
    await expect
      .element(page.getByText("No AI summaries in this history.", { exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "Clear selected history", exact: true }).click();
    expect(fixture.request.mock.calls.some(([input]) => input.method === "activity.clear")).toBe(
      false,
    );
    await page.getByRole("button", { name: "Delete history", exact: true }).click();
    await expect
      .poll(() => fixture.request.mock.calls.filter(([input]) => input.method === "activity.clear"))
      .toEqual([[{ method: "activity.clear" }]]);
  }, 5000);
  it("refreshes both independent caches on host events and confirmed clear", async () => {
    const fixture = passiveFixture();
    const base = fixture.request.getMockImplementation()!;
    let revision = 0;
    let changed!: () => void;
    const subscribe = (listener: () => void) => {
      changed = listener;
      return () => {};
    };
    fixture.request.mockImplementation(async (input) => {
      if (input.method === "activity.clear") revision = 2;
      if (input.method === "activity.list")
        return {
          method: input.method,
          result: {
            ...passivePage,
            snapshots: [
              { ...passivePage.snapshots[0]!, windowTitle: `Context revision ${revision}` },
            ],
            semanticSummaries: [
              {
                ...semanticSummary,
                content: { ...semanticSummary.content, title: `Summary revision ${revision}` },
              },
            ],
          },
        };
      return base(input);
    });
    await mount(fixture.request, undefined, subscribe);
    await openPassiveView();
    await expect.element(page.getByText("Summary revision 0", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Recorded context", exact: true }).click();
    await expect.element(page.getByText("Context revision 0", { exact: true })).toBeVisible();
    revision = 1;
    changed();
    await expect.element(page.getByText("Context revision 1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "AI summaries", exact: true }).click();
    await expect.element(page.getByText("Summary revision 1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear selected history", exact: true }).click();
    expect(revision).toBe(1);
    await page.getByRole("button", { name: "Delete history", exact: true }).click();
    await expect.element(page.getByText("Summary revision 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Recorded context", exact: true }).click();
    await expect.element(page.getByText("Context revision 2", { exact: true })).toBeVisible();
    expect(fixture.request.mock.calls.some(([input]) => input.method === "history.configure")).toBe(
      false,
    );
  }, 5000);
  it("keeps full AX context inert, keyboard expandable, and readable in the dark theme", async () => {
    const wasDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.add("dark");
    try {
      const injection =
        "<script>window.__historyAXInjected=true</script> https://example.invalid/run";
      const fixture = passiveFixture({
        ...passivePage,
        events: [
          {
            ...recordedEvent,
            id: "snapshot-1",
            appName: injection,
            ax: { mode: "full", text: injection + "\n" + "X".repeat(1600) },
          },
        ],
      });
      await mount(fixture.request);
      await openPassiveView("Recorded context");
      const article = page.getByRole("article", { name: "Recorded interaction", exact: true });
      const disclosure = article.getByText("Accessibility context: full", { exact: true });
      disclosure.element().focus();
      await userEvent.keyboard("{Enter}");
      expect(disclosure.element().closest("details")!.open).toBe(true);
      expect(article.element().querySelectorAll("a,img,script,button").length).toBe(0);
      expect((window as unknown as Record<string, unknown>).__historyAXInjected).toBeUndefined();
      expect(
        document.querySelectorAll(
          '[data-history-record="event:snapshot-1"], [data-history-record="snapshot:snapshot-1"]',
        ).length,
      ).toBe(2);
      await page.viewport(320, 900);
      await expect.poll(() => document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
      disclosure.element().scrollIntoView({ block: "start" });
      await page.screenshot({
        path: "/private/tmp/djl-history-timeline-ui/20261029T013653Z/ax-full-dark-320.png",
      });
    } finally {
      document.documentElement.classList.toggle("dark", wasDark);
    }
  }, 5000);
});

describe("history suggestion review draft", () => {
  it("disables all suggestion actions while pending and announces retained same-chat recovery", async () => {
    const review = vi.fn(async () => ({ status: "failed" as const }));
    const recover = vi.fn(async () => ({ status: "failed" as const }));
    const fixture = passiveFixture({
      ...passivePage,
      semanticSummaries: [semanticSummary, { ...semanticSummary, id: "another-summary" }],
    });
    await mount(fixture.request, undefined, undefined, {
      pending: true,
      result: null,
      review,
      recover,
    });
    await openPassiveView();
    const actions = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => button.textContent === "Review in new draft",
    );
    expect(actions).toHaveLength(2);
    expect(
      actions.every((button) => button.disabled && button.getAttribute("aria-busy") === "true"),
    ).toBe(true);
    await expect
      .element(page.getByRole("status").filter({ hasText: "Preparing unsent review draft" }))
      .toBeVisible();
    actions[0]!.click();
    expect(review).not.toHaveBeenCalled();
    await cleanup();
    await mount(fixture.request, undefined, undefined, {
      pending: false,
      result: { status: "retained", threadId: "retained-chat" as ThreadId },
      review,
      recover,
    });
    const recovery = page.getByRole("button", { name: "Open review draft", exact: true });
    await expect.element(recovery).toBeVisible();
    expect(document.activeElement).toBe(recovery.element());
    await userEvent.keyboard("{Enter}");
    expect(recover).toHaveBeenCalledTimes(1);
    await expect
      .element(page.getByText(/Draft retained. Creation or navigation could not be confirmed/))
      .toBeVisible();
  }, 5000);
  it("hides the action for absent or malformed decoded host suggestions", async () => {
    const { suggestion: _suggestion, ...content } = semanticSummary.content;
    const fixture = passiveFixture({
      ...passivePage,
      semanticSummaries: [{ ...semanticSummary, content }],
    });
    await mount(fixture.request);
    await openPassiveView();
    await expect
      .element(page.getByText(semanticSummary.content.title, { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Review in new draft", exact: true }))
      .not.toBeInTheDocument();
    await cleanup();
    const malformed = {
      ...semanticSummary,
      content: {
        ...semanticSummary.content,
        suggestion: { type: "execute", name: "invalid", description: "invalid" },
      },
    };
    await mount(
      passiveFixture({
        ...passivePage,
        semanticSummaries: [malformed as unknown as ComputerActivitySemanticSummary],
      }).request,
    );
    await openPassiveView();
    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Review in new draft", exact: true }))
      .not.toBeInTheDocument();
  }, 5000);
  it("offers an explicit unsent draft action for the decoded displayed suggestion", async () => {
    const review = vi.fn(async () => ({ status: "failed" as const }));
    await mount(
      passiveFixture({ ...passivePage, semanticSummaries: [semanticSummary] }).request,
      undefined,
      undefined,
      {
        pending: false,
        result: null,
        review,
        recover: review,
      },
    );
    await openPassiveView();
    await expect.element(page.getByText("Review checklist", { exact: false })).toBeVisible();
    const action = page.getByRole("button", { name: "Review in new draft", exact: true });
    await expect.element(action).toBeEnabled();
    expect(review).not.toHaveBeenCalled();
    action.element().focus();
    await userEvent.keyboard("{Enter}");
    expect(review).toHaveBeenCalledExactlyOnceWith(semanticSummary);
    expect(document.activeElement).toBe(action.element());
  }, 5000);
});

describe("scoped passive history deletion", () => {
  it("confirms a frozen last-ten-minute app scope and keeps the agent log", async () => {
    const fixture = passiveFixture();
    await mount(fixture.request);
    await openPassiveView();
    await page.getByRole("button", { name: "Clear selected history", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("combobox", { name: "Time range", exact: true }).selectOptions("10m");
    await dialog
      .getByLabelText("App bundle ID (optional)", { exact: true })
      .fill(" com.djl.fixture ");
    expect(fixture.request.mock.calls.some(([input]) => input.method === "activity.clear")).toBe(
      false,
    );
    const cutoff = dialog.getByTestId("history-clear-cutoff").element().getAttribute("datetime");
    await dialog.getByRole("button", { name: "Delete history", exact: true }).click();
    await expect
      .poll(
        () =>
          fixture.request.mock.calls.filter(([input]) => input.method === "activity.clear").length,
      )
      .toBe(1);
    const request = fixture.request.mock.calls.find(
      ([input]) => input.method === "activity.clear",
    )![0];
    expect(request).toMatchObject({
      method: "activity.clear",
      bundleId: "com.djl.fixture",
      until: cutoff,
    });
    expect(
      request.method === "activity.clear" &&
        Date.parse(request.until!) - Date.parse(request.since!),
    ).toBe(600000);
    expect(fixture.request.mock.calls.some(([input]) => input.method === "history.clear")).toBe(
      false,
    );
  }, 5000);

  it("rejects reversed custom dates and lets cancellation preserve the records", async () => {
    const fixture = passiveFixture();
    await mount(fixture.request);
    await openPassiveView();
    await page.getByRole("button", { name: "Clear selected history", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("combobox", { name: "Time range", exact: true }).selectOptions("custom");
    await dialog.getByLabelText("From (local time)", { exact: true }).fill("2026-10-29T15:00");
    await dialog.getByLabelText("Until (local time)", { exact: true }).fill("2026-10-29T14:00");
    await expect
      .element(dialog.getByRole("button", { name: "Delete history", exact: true }))
      .toBeDisabled();
    await expect.element(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(fixture.request.mock.calls.some(([input]) => input.method === "activity.clear")).toBe(
      false,
    );
  }, 5000);

  it("keeps an exact failed scope for retry and explains the failure inside the dialog", async () => {
    const fixture = passiveFixture();
    const base = fixture.request.getMockImplementation()!;
    let attempts = 0;
    fixture.request.mockImplementation(async (input) =>
      input.method === "activity.clear" && attempts++ === 0
        ? {
            method: input.method,
            error: { code: "internal", message: "Deletion requires recovery" },
          }
        : base(input),
    );
    await mount(fixture.request);
    await openPassiveView();
    await page.getByRole("button", { name: "Clear selected history", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("combobox", { name: "Time range", exact: true }).selectOptions("1h");
    await dialog.getByRole("button", { name: "Delete history", exact: true }).click();
    await expect.element(dialog.getByRole("alert")).toHaveTextContent("Deletion requires recovery");
    await expect
      .element(page.getByText("Selected history deleted.", { exact: true }))
      .not.toBeInTheDocument();
    await dialog.getByRole("button", { name: "Delete history", exact: true }).click();
    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    const calls = fixture.request.mock.calls.filter(([input]) => input.method === "activity.clear");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
  }, 5000);
});

it("removes deleted raw and semantic cache pages even when the refresh fails", async () => {
  const fixture = passiveFixture({ ...passivePage, semanticSummaries: [semanticSummary] });
  const base = fixture.request.getMockImplementation()!;
  let deleted = false;
  fixture.request.mockImplementation(async (input) => {
    if (input.method === "activity.clear") deleted = true;
    if (input.method === "activity.list" && deleted)
      return {
        method: input.method,
        error: { code: "internal", message: "Refresh unavailable after deletion" },
      };
    return base(input);
  });
  await mount(fixture.request);
  await openPassiveView();
  await expect
    .element(page.getByText("Reviewed the history proposal", { exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Recorded context", exact: true }).click();
  await expect.element(page.getByText("Research notes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear selected history", exact: true }).click();
  await page.getByRole("button", { name: "Delete history", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Refresh unavailable after deletion");
  await expect.element(page.getByText("Research notes", { exact: true })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "AI summaries", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Refresh unavailable after deletion");
  await expect
    .element(page.getByText("Reviewed the history proposal", { exact: true }))
    .not.toBeInTheDocument();
}, 5000);

it("does not reveal stale cached history when a partial deletion needs recovery", async () => {
  const fixture = passiveFixture({ ...passivePage, semanticSummaries: [semanticSummary] });
  const base = fixture.request.getMockImplementation()!;
  let failed = false;
  fixture.request.mockImplementation(async (input) => {
    if (input.method === "activity.clear") {
      failed = true;
      return {
        method: input.method,
        error: { code: "internal", message: "Deletion requires recovery" },
      };
    }
    if (input.method === "activity.list" && failed)
      return {
        method: input.method,
        error: { code: "internal", message: "History held for recovery" },
      };
    return base(input);
  });
  await mount(fixture.request);
  await openPassiveView();
  await expect
    .element(page.getByText("Reviewed the history proposal", { exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Clear selected history", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Delete history", exact: true }).click();
  await expect.element(dialog.getByRole("alert")).toHaveTextContent("Deletion requires recovery");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.element(page.getByText("History held for recovery", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("Reviewed the history proposal", { exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByText("Selected history deleted.", { exact: true }))
    .not.toBeInTheDocument();
}, 5000);

it("keeps scoped deletion review and pending feedback usable on narrow French", async () => {
  const fixture = passiveFixture();
  const base = fixture.request.getMockImplementation()!;
  let finish!: () => void;
  fixture.request.mockImplementation((input) =>
    input.method === "activity.clear"
      ? new Promise<ComputerUseResponse>((resolve) => {
          finish = () => resolve({ method: input.method, result: { deletedCount: 1 } });
        })
      : base(input),
  );
  const catalog = await loadLocaleCatalog("fr");
  rendererI18n.addResourceBundle("fr", "settings", catalog.settings, true, true);
  await rendererI18n.changeLanguage("fr");
  const t = (key: string) => rendererI18n.t(`computerUse.${key}`, { ns: "settings" });
  await page.viewport(320, 740);
  const wasDark = document.documentElement.classList.contains("dark");
  document.documentElement.classList.add("dark");
  try {
    await mount(fixture.request);
    await page.getByRole("button", { name: t("passiveHistory"), exact: true }).click();
    await page.getByRole("button", { name: t("clear"), exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog
      .getByRole("combobox", { name: t("clearScope.range"), exact: true })
      .selectOptions("custom");
    await dialog.getByLabelText(t("clearScope.from"), { exact: true }).fill("2026-10-29T10:00");
    await dialog.getByLabelText(t("clearScope.until"), { exact: true }).fill("2026-10-29T11:30");
    await dialog.getByLabelText(t("clearScope.app"), { exact: true }).fill("com.djl.fixture");
    await expect.poll(() => document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    expect(dialog.element().getBoundingClientRect().width).toBeLessThanOrEqual(320);
    expect(getComputedStyle(dialog.element()).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    await expect.poll(() => getComputedStyle(dialog.element()).opacity).toBe("1");
    expect(document.querySelector("vite-error-overlay")).toBeNull();
    await page.screenshot({
      path: "/private/tmp/djl-history-scoped-clear-ui/custom-french-320.png",
    });
    await dialog.getByRole("button", { name: t("confirmClear"), exact: true }).click();
    await expect.element(dialog.getByText(t("clearScope.pending"), { exact: true })).toBeVisible();
    await expect
      .element(dialog.getByRole("button", { name: t("cancel"), exact: true }))
      .toBeDisabled();
    await expect
      .element(dialog.getByRole("combobox", { name: t("clearScope.range"), exact: true }))
      .toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).toBeVisible();
    await page.screenshot({
      path: "/private/tmp/djl-history-scoped-clear-ui/pending-french-320.png",
    });
    finish();
    await expect.element(page.getByText(t("cleared"), { exact: true })).toBeVisible();
    await expect.element(dialog).not.toBeInTheDocument();
  } finally {
    if (!wasDark) document.documentElement.classList.remove("dark");
  }
}, 10000);
