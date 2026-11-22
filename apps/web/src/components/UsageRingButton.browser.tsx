import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { serverQueryKeys } from "~/lib/serverReactQuery";
import { useStore } from "~/store";

import { UsageRingButton } from "./UsageRingButton";

const AT = "2099-04-08T18:00:00.000Z";

const api = vi.hoisted(() => ({
  cloud: { getStatus: vi.fn() },
  server: { listProviderUsage: vi.fn(), getConfig: vi.fn() },
}));
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => api }));

const signedOut = { signedIn: false, apiBaseUrl: "https://api.test", checkedAt: AT };
const signedIn = {
  signedIn: true,
  apiBaseUrl: "https://api.test",
  email: "me@test.invalid",
  credits: {
    orgId: "o1",
    balances: { trial: "0", plan: "2000000000", topup: "0" },
    total: "2000000000",
    display: { total: "2000.00", trial: "0.00", plan: "2000.00", topup: "0.00" },
  },
  usage: {
    planId: "starter",
    windows: {
      fiveHour: {
        kind: "five_hour",
        limit: "1000000",
        used: "250000",
        remaining: "750000",
        resetsAt: null,
      },
      week: {
        kind: "week",
        limit: "2000000",
        used: "1000000",
        remaining: "1000000",
        resetsAt: "2099-04-14T18:00:00.000Z",
      },
    },
    banks: { count: 0, nextExpiresAt: null },
  },
  checkedAt: AT,
};

function snapshot(provider: string, overrides: Record<string, unknown> = {}) {
  return {
    provider,
    updatedAt: AT,
    limits: [],
    usageLines: [],
    source: `${provider}-source`,
    ...overrides,
  };
}

const connected = [
  snapshot("codex", {
    planName: "Pro",
    limits: [
      { window: "5h", usedPercent: 40 },
      { window: "Weekly", usedPercent: 30 },
    ],
    usageLines: [{ label: "Credits", value: "12.50" }],
  }),
  snapshot("claudeAgent", {
    planName: "Max",
    limits: [
      { window: "5h", usedPercent: 10 },
      { window: "Weekly", usedPercent: 88 },
    ],
  }),
  snapshot("cursor", { status: "needs-auth" }),
  snapshot("gemini", { status: "error" }),
];

function providerStatus(provider: string) {
  return { provider, status: "ready", available: true, authStatus: "authenticated", checkedAt: AT };
}

function renderRing(onManageUsage = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <div style={{ padding: 200 }}>
        <UsageRingButton rail onManageUsage={onManageUsage} />
      </div>
    </QueryClientProvider>,
  );
  return { client, onManageUsage, ring: page.getByTestId("usage-ring-button") };
}

function setTurn(provider: string, orchestrationStatus: string) {
  useStore.setState({
    threadSessionById: { t1: { provider, orchestrationStatus } },
  } as never);
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  useStore.setState({ threadSessionById: {}, activityByThreadId: {} });
});

describe("UsageRingButton", () => {
  it("shows the lowest remaining limit and lists every subscription", async () => {
    api.cloud.getStatus.mockResolvedValue(signedIn);
    api.server.listProviderUsage.mockResolvedValue(connected);
    api.server.getConfig.mockResolvedValue({
      providers: [providerStatus("codex"), providerStatus("opencode")],
    });
    const { ring, onManageUsage } = renderRing();

    await expect.element(ring).toHaveAttribute("aria-label", "Claude · Weekly · 12% left");
    const svg = ring.element().querySelector("svg");
    expect(svg?.classList.contains("text-amber-500")).toBe(true);
    expect(svg?.querySelectorAll("circle")).toHaveLength(2);
    await ring.hover();
    await expect.element(page.getByText("Claude · Weekly · 12% left")).toBeVisible();

    await ring.click();
    const block = (name: string) => page.getByRole("region", { name, exact: true });
    await expect
      .element(block("DJL Cloud").getByRole("progressbar", { name: "5h: 75% left" }))
      .toBeVisible();
    await expect
      .element(block("DJL Cloud").getByRole("progressbar", { name: "Weekly: 50% left" }))
      .toBeVisible();
    await expect.element(block("DJL Cloud").getByText("starter")).toBeVisible();
    await expect.element(block("DJL Cloud").getByText("2000.00 credits available")).toBeVisible();
    await expect
      .element(block("Codex").getByRole("progressbar", { name: "Weekly: 70% left" }))
      .toBeVisible();
    await expect.element(block("Codex").getByText("Pro")).toBeVisible();
    await expect.element(block("Codex").getByText("12.50")).toBeVisible();
    await expect.element(block("Codex").getByText("Usage source: codex-source")).toBeVisible();
    await expect
      .element(block("Claude").getByRole("progressbar", { name: "Weekly: 12% left" }))
      .toHaveAttribute("aria-valuenow", "12");
    await expect.element(block("Cursor").getByText("Not signed in")).toBeVisible();
    await expect.element(block("Gemini").getByText("Unavailable")).toBeVisible();
    await expect.element(block("DJL").getByText("No limit data")).toBeVisible();
    expect(block("Cursor").getByRole("progressbar").elements()).toHaveLength(0);

    await page.getByRole("button", { name: "Manage usage" }).click();
    expect(onManageUsage).toHaveBeenCalledOnce();
    await expect
      .element(page.getByRole("button", { name: "Manage usage" }))
      .not.toBeInTheDocument();
  });

  it("shows limits an agent reported mid-turn when they are newer than the server's", async () => {
    api.cloud.getStatus.mockResolvedValue(signedOut);
    api.server.listProviderUsage.mockResolvedValue(connected);
    api.server.getConfig.mockResolvedValue({ providers: [] });
    const { ring } = renderRing();
    await expect.element(ring).toHaveAttribute("aria-label", "Claude · Weekly · 12% left");

    useStore.setState({
      activityByThreadId: {
        t1: {
          limits: {
            id: "limits",
            kind: "account.rate-limits.updated",
            tone: "info",
            summary: "Rate limits updated",
            turnId: null,
            createdAt: "2099-04-08T18:05:00.000Z",
            payload: {
              provider: "codex",
              rateLimits: {
                primary: { usedPercent: 97, windowDurationMins: 300, resetsAt: 4_102_444_800 },
                secondary: null,
              },
            },
          },
        },
      },
    } as never);

    await expect.element(ring).toHaveAttribute("aria-label", "Codex · 5h · 3% left");
  });

  it("keeps a muted track while usage is loading", async () => {
    api.cloud.getStatus.mockReturnValue(new Promise(() => undefined));
    api.server.listProviderUsage.mockReturnValue(new Promise(() => undefined));
    api.server.getConfig.mockReturnValue(new Promise(() => undefined));
    const { ring } = renderRing();

    await expect.element(ring).toHaveAttribute("aria-label", "Loading provider usage…");
    const svg = ring.element().querySelector("svg");
    expect(svg?.querySelectorAll("circle")).toHaveLength(1);
    expect(svg?.getAttribute("class")).not.toMatch(/text-(emerald|amber|red)-500/);
    await ring.click();
    await expect
      .element(page.getByRole("dialog").getByText("Loading provider usage…"))
      .toBeVisible();
  });

  it("stays muted with no limit data when nothing is connected and omits DJL Cloud when signed out", async () => {
    api.cloud.getStatus.mockResolvedValue(signedOut);
    api.server.listProviderUsage.mockResolvedValue([
      snapshot("codex", { status: "needs-auth", limits: [{ window: "Weekly", usedPercent: 99 }] }),
    ]);
    api.server.getConfig.mockResolvedValue({ providers: [] });
    const { ring } = renderRing();

    await expect.element(ring).toHaveAttribute("aria-label", "No limit data");
    expect(ring.element().querySelectorAll("circle")).toHaveLength(1);
    await ring.click();
    await expect
      .element(page.getByRole("region", { name: "Codex" }).getByText("Not signed in"))
      .toBeVisible();
    expect(page.getByRole("region", { name: "DJL Cloud" }).elements()).toHaveLength(0);
    expect(page.getByRole("progressbar").elements()).toHaveLength(0);
  });

  it("polls every five minutes when idle and refetches on open only when the data is over a minute old", async () => {
    api.cloud.getStatus.mockResolvedValue(signedOut);
    api.server.listProviderUsage.mockResolvedValue(connected);
    api.server.getConfig.mockResolvedValue({ providers: [] });
    const { client, ring } = renderRing();
    const key = serverQueryKeys.allProviderUsage();

    await expect.element(ring).toHaveAttribute("aria-label", "Claude · Weekly · 12% left");
    const pace = () =>
      client
        .getQueryCache()
        .find({ queryKey: key })
        ?.observers.map((observer) => [
          (observer.options.refetchInterval as () => number)(),
          observer.options.refetchIntervalInBackground,
        ]);
    expect(pace()).toEqual([[300_000, false]]);

    await ring.click();
    await expect.element(page.getByRole("button", { name: "Manage usage" })).toBeVisible();
    expect(api.server.listProviderUsage).toHaveBeenCalledTimes(1);
    await ring.click();
    await expect
      .element(page.getByRole("button", { name: "Manage usage" }))
      .not.toBeInTheDocument();

    client.setQueryData(key, connected, { updatedAt: Date.now() - 61_000 });
    await ring.click();
    await expect.element(page.getByRole("button", { name: "Manage usage" })).toBeVisible();
    await vi.waitFor(() => expect(api.server.listProviderUsage).toHaveBeenCalledTimes(2));
    expect(api.server.listProviderUsage.mock.calls).toEqual([[{}], [{}]]);
  });

  it("asks the vendor again the moment a chat's turn ends", async () => {
    const codex = (usedPercent: number) => [
      snapshot("codex", { limits: [{ window: "Weekly", usedPercent }] }),
    ];
    api.cloud.getStatus.mockResolvedValue(signedOut);
    api.server.getConfig.mockResolvedValue({ providers: [] });
    api.server.listProviderUsage.mockResolvedValue(codex(30));
    setTurn("codex", "running");
    const { ring } = renderRing();
    await expect.element(ring).toHaveAttribute("aria-label", "Codex · Weekly · 70% left");
    expect(api.server.listProviderUsage.mock.calls).toEqual([[{}]]);

    api.server.listProviderUsage.mockResolvedValue(codex(45));
    setTurn("codex", "ready");

    await expect.element(ring).toHaveAttribute("aria-label", "Codex · Weekly · 55% left");
    expect(api.server.listProviderUsage.mock.calls.slice(1)).toEqual([
      [{ forceRefresh: true, provider: "codex" }],
      [{}],
    ]);
    expect(api.cloud.getStatus).toHaveBeenCalledTimes(1);
  });

  it("re-reads the DJL Cloud balance when a DJL Cloud turn ends", async () => {
    api.cloud.getStatus.mockResolvedValue(signedIn);
    api.server.getConfig.mockResolvedValue({ providers: [] });
    api.server.listProviderUsage.mockResolvedValue([]);
    setTurn("djlCloud", "running");
    const { ring } = renderRing();
    await expect.element(ring).toHaveAttribute("aria-label", "DJL Cloud · Weekly · 50% left");

    const week = { ...signedIn.usage.windows.week, used: "1800000", remaining: "200000" };
    api.cloud.getStatus.mockResolvedValue({
      ...signedIn,
      usage: { ...signedIn.usage, windows: { ...signedIn.usage.windows, week } },
    });
    setTurn("djlCloud", "ready");

    await expect.element(ring).toHaveAttribute("aria-label", "DJL Cloud · Weekly · 10% left");
    expect(
      api.server.listProviderUsage.mock.calls.some(([input]) => input.forceRefresh === true),
    ).toBe(false);
  });

  it("polls every minute while a turn runs and for a short while after", async () => {
    api.cloud.getStatus.mockResolvedValue(signedOut);
    api.server.listProviderUsage.mockResolvedValue(connected);
    api.server.getConfig.mockResolvedValue({ providers: [] });
    setTurn("pi", "running");
    const { client, ring } = renderRing();
    const pace = () =>
      client
        .getQueryCache()
        .find({ queryKey: serverQueryKeys.allProviderUsage() })
        ?.observers.map((observer) => (observer.options.refetchInterval as () => number)());

    await expect.element(ring).toHaveAttribute("aria-label", "Claude · Weekly · 12% left");
    expect(pace()).toEqual([60_000]);
    setTurn("pi", "ready");
    await expect.poll(() => api.server.listProviderUsage.mock.calls.length).toBe(2);
    expect(pace()).toEqual([60_000]);
  });
});
