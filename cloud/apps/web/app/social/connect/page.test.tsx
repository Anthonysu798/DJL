import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StrictMode, type ReactNode } from "react";
const state = vi.hoisted(() => ({
  signedIn: false,
  params: new URLSearchParams({ provider: "instagram", continuation: "a".repeat(43) }),
  api: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("@/components/AuthGate", () => ({
  AuthGate: ({ children, signedOut }: { children: ReactNode; signedOut: ReactNode }) =>
    state.signedIn ? children : signedOut,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "fixture-user", email: "fixture@example.invalid" } },
    }),
  },
}));
vi.mock("@/lib/api", () => ({ api: state.api }));
vi.mock("@/components/ConnectionShell", () => ({
  ConnectionShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
  OpenDjl: () => <a href="djl://open">Open DJL</a>,
}));
import Page from "./page";
afterEach(() => {
  cleanup();
  state.signedIn = false;
  state.api.mockReset();
});
it("can retry a failed continuation without authorizing publication", async () => {
  state.signedIn = true;
  state.api
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ status: "connected" });
  render(<Page />);
  expect(await screen.findByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("status")).toHaveTextContent("No post has been published");
  expect(state.api).toHaveBeenCalledTimes(2);
  expect(
    state.api.mock.calls.every(([path]) => path === "/v1/social/oauth/instagram/continue"),
  ).toBe(true);
});
it("offers safe sign-in continuation without a provider code", () => {
  render(<Page />);
  expect(screen.getByRole("heading").textContent).toContain("Sign in to DJL");
  const href = screen.getByRole("link", { name: "Sign in to DJL" }).getAttribute("href")!;
  const next = new URL(href, "https://app.example.invalid").searchParams.get("next")!;
  expect(next).toBe(`/social/connect?provider=instagram&continuation=${"a".repeat(43)}`);
  expect(next).not.toContain("code=");
  expect(state.api).not.toHaveBeenCalled();
});
it("automatically finishes in StrictMode and safely remounts without user confirmation", async () => {
  state.signedIn = true;
  state.api.mockResolvedValue({ status: "connected" });
  const first = render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith("/v1/social/oauth/instagram/continue", {
      method: "POST",
      json: { continuation: "a".repeat(43) },
    }),
  );
  expect((await screen.findByRole("status")).textContent).toContain("No post has been published");
  expect(state.api).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Finish connection" })).toBeNull();
  first.unmount();
  render(<Page />);
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(2));
  expect((await screen.findByRole("status")).textContent).toContain("No post has been published");
});
