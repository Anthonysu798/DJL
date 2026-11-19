import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("@/components/react-bits/SpotlightCard", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/react-bits/FadeContent", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
import { PublicSocialReview } from "./PublicSocialReview";
const token = "a".repeat(43);
const review = {
  revision: 2,
  isCurrent: true,
  expiresAt: "2030-01-01T00:00:00Z",
  caption: "Synthetic caption",
  targets: [{ provider: "instagram", caption: "Synthetic caption" }],
  media: [],
  publicationMode: "now",
  scheduledAt: "2030-01-01T00:00:00Z",
  timezone: "UTC",
};
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});
it("keeps tokens out of request URLs and records only explicit reviewer feedback", async () => {
  window.history.replaceState({}, "", `/social/review#token=${token}`);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => review })
    .mockResolvedValueOnce({ ok: true });
  vi.stubGlobal("fetch", fetcher);
  render(<PublicSocialReview />);
  expect(await screen.findByText("Synthetic caption")).toBeVisible();
  expect(fetcher.mock.calls[0]![0]).not.toContain(token);
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    credentials: "omit",
    cache: "no-store",
    headers: { "x-review-token": token },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Synthetic reviewer" } });
  fireEvent.change(screen.getByLabelText("Review decision"), { target: { value: "approved" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Feedback saved for version 2");
  expect(fetcher.mock.calls[1]![0]).toMatch(/\/v1\/social\/review\/feedback$/);
  expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({
    reviewerName: "Synthetic reviewer",
    comment: "",
    decision: "approved",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("makes stale snapshots readable but disables further approval", async () => {
  window.history.replaceState({}, "", `/social/review#token=${token}`);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...review, isCurrent: false }) }),
  );
  render(<PublicSocialReview />);
  expect(await screen.findByText(/its approvals no longer apply/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Submit feedback" })).toBeNull();
});
it("does not fetch a malformed token or display private content for expired links", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<PublicSocialReview />);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable or expired"),
  );
  expect(fetcher).not.toHaveBeenCalled();
});
