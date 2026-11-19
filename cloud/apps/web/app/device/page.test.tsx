import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ user_code: "TEST1234" }),
}));
vi.mock("@/components/AuthGate", () => ({
  AuthGate: ({ children }: { children: ReactNode }) => children,
}));
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

afterEach(() => vi.unstubAllGlobals());

it("waits for an explicit approval and disables duplicate clicks while pending", async () => {
  let complete!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ok: true })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<Page />);
  const approve = await screen.findByRole("button", { name: "Approve sign-in" });
  await waitFor(() => expect(approve).toBeEnabled());
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(approve);
  expect(approve).toBeDisabled();
  fireEvent.click(approve);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[0]).toMatch(/\/device\/approve$/);
  complete({ ok: true } as Response);
  expect(await screen.findByRole("status")).toHaveTextContent("You can return to DJL");
});

it("shows a retry after a rejected claim without enabling approval", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
  vi.stubGlobal("fetch", fetcher);
  render(<Page />);
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t verify");
  expect(screen.getByRole("button", { name: "Approve sign-in" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Approve sign-in" })).toBeEnabled(),
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("keeps a failed approval recoverable and never displays success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error("offline")),
  );
  render(<Page />);
  const approve = screen.getByRole("button", { name: "Approve sign-in" });
  await waitFor(() => expect(approve).toBeEnabled());
  fireEvent.click(approve);
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t complete");
  expect(screen.queryByText("Device connected")).toBeNull();
});
