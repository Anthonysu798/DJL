import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProductAnalyticsPreference, ProductAnalyticsTracker } from "./ProductAnalytics";

vi.mock("@/lib/auth-client", () => ({ authClient: { useSession: () => ({ data: null }) } }));
vi.mock("@/lib/locale-context", () => ({
  useLocale: () => ({
    d: { productAnalytics: "Product analytics", productAnalyticsDescription: "Optional reporting" },
  }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("shows the restored consent after the tracker finishes loading local state", async () => {
  localStorage.setItem(
    "djl_cloud_product_analytics",
    JSON.stringify({
      enabled: true,
      installationId: "10000000-0000-4000-8000-000000000001",
      credential: null,
      apiBaseUrl: null,
      appVersion: "0.1.0",
      scopeHash: null,
      firstOpenReported: false,
      events: [],
    }),
  );
  render(
    <>
      <ProductAnalyticsTracker />
      <ProductAnalyticsPreference />
    </>,
  );
  await vi.waitFor(() =>
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true),
  );
});
