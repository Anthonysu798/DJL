import "../../index.css";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { TerminalCloseDialog } from "./TerminalCloseDialog";

afterEach(async () => {
  await cleanup();
});

function Harness({ onConfirm = () => {} }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(true);

  return (
    <TerminalCloseDialog
      open={open}
      closing={false}
      title="Close terminal"
      description="This stops the selected terminal processes. Account profiles and their saved sign-ins are kept."
      cancelLabel="Cancel"
      confirmLabel="Close"
      closingLabel="Closing"
      onOpenChange={setOpen}
      onCancel={() => setOpen(false)}
      onConfirm={onConfirm}
    />
  );
}

describe("Terminal close dialog", () => {
  it("presents the consequence with distinct cancel and destructive actions", async () => {
    const confirm = vi.fn();
    await render(<Harness onConfirm={confirm} />);

    const dialog = page.getByRole("dialog", { name: "Close terminal" });
    await expect.element(dialog).toBeVisible();
    await expect
      .element(
        page.getByText(
          "This stops the selected terminal processes. Account profiles and their saved sign-ins are kept.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByTestId("terminal-close-warning-icon")).toBeVisible();

    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    const close = page.getByRole("button", { name: "Close", exact: true });
    await expect.element(cancel).toHaveAttribute("data-variant", "secondary-outline");
    await expect.element(close).toHaveAttribute("data-variant", "destructive");

    await close.click();
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("stays compact and closes from the cancel action", async () => {
    await page.viewport(900, 700);
    await render(<Harness />);

    const popup = document.querySelector<HTMLElement>(".terminal-close-dialog")!;
    expect(popup.getBoundingClientRect().width).toBeLessThanOrEqual(440);

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect
      .element(page.getByRole("dialog", { name: "Close terminal" }))
      .not.toBeInTheDocument();
  });
});
