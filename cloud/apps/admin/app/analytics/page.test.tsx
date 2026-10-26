import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AnalyticsPage from "./page";
import { admin } from "@/lib/api";

vi.mock("@/components/Shell", () => ({
  Shell: ({
    children,
    title,
    subtitle,
  }: {
    children: React.ReactNode;
    title: string;
    subtitle: string;
  }) => (
    <>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </>
  ),
}));
vi.mock("@/lib/api", () => ({ admin: vi.fn() }));
afterEach(() => cleanup());

it("distinguishes reporting activity from disconnected distribution sources", async () => {
  vi.mocked(admin).mockResolvedValue({
    environment: "test",
    downloadHistory: [],
    range: "week",
    since: "2026-10-07T00:00:00Z",
    asOf: "2026-10-13T12:00:00Z",
    platform: null,
    includeTest: false,
    accounts: { registered: 12, organizations: 12, paidOrganizations: 1 },
    activity: {
      activeAccounts: 1,
      activeInstallations: 2,
      recentlyActiveInstallations: 1,
      reportingInstallations: 2,
      reportingStartedAt: "2026-10-10T00:00:00Z",
    },
    cloud: {
      requests: 8,
      successful: 7,
      failed: 1,
      pending: 0,
      inputTokens: "100",
      outputTokens: "50",
      creditsMicro: "1250000",
      revenueUsdCents: "0",
      unattributedRequests: 8,
    },
    history: [],
    platforms: [],
    versions: [],
    features: [],
    cohorts: [],
    downloads: [],
    sources: [
      {
        id: "stats-worker",
        status: "disconnected",
        lastObservedAt: null,
        coverageStartedAt: null,
        lastAttemptAt: null,
        visibility: null,
      },
      {
        id: "github",
        status: "disconnected",
        lastObservedAt: null,
        coverageStartedAt: null,
        lastAttemptAt: null,
        visibility: null,
      },
      {
        id: "app-store",
        status: "disconnected",
        lastObservedAt: null,
        coverageStartedAt: null,
        lastAttemptAt: null,
        visibility: null,
      },
    ],
  });
  render(<AnalyticsPage />);
  await screen.findByText("Registered accounts");
  expect(screen.getAllByText("Disconnected").length).toBeGreaterThanOrEqual(3);
  expect(screen.getByText(/Downloads are not unique users/)).toBeTruthy();
  expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
});
