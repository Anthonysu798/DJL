import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithChat } from "./test-utils";
import { UsageExhaustedPanel } from "./Usage";

describe("UsageExhaustedPanel", () => {
  it("offers a banked reset with confirmation and clears once redeemed", async () => {
    const user = userEvent.setup();
    const { mock } = renderWithChat(<UsageExhaustedPanel />, "exhausted");

    expect(await screen.findByText("You've reached your 5-hour limit")).toBeInTheDocument();
    expect(screen.getByText(/^2 left · next expires/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute("href", "/billing");

    await user.click(screen.getByRole("button", { name: "Use a banked reset" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("You'll have 1 left.");
    expect(mock.requests.some((r) => r.path.endsWith("/redeem"))).toBe(false); // nothing until confirmed

    await user.click(within(dialog).getByRole("button", { name: "Use reset" }));
    await waitFor(() => expect(screen.queryByText("You've reached your 5-hour limit")).toBeNull());
    expect(await screen.findByText("Reset applied. You're good to go.")).toBeInTheDocument();
    expect(mock.db.usage.banks).toHaveLength(1);
  });

  it("stays hidden while usage is available", async () => {
    const { mock } = renderWithChat(<UsageExhaustedPanel />);
    await waitFor(() =>
      expect(mock.requests.some((r) => r.path === "/v1/usage/status")).toBe(true),
    );
    expect(screen.queryByRole("region")).toBeNull();
  });
});
