import "../../index.css";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ComposerAccountRow } from "./ComposerAccountRow";

afterEach(async () => {
  await cleanup();
});

describe("composer account row", () => {
  it("picks an account for the chat, shows usage left and the default, and offers to make it the default", async () => {
    const onSelect = vi.fn();
    const onMakeDefault = vi.fn();
    const screen = await render(
      <ComposerAccountRow
        accounts={[
          { id: "default", name: "Main", email: "me@example.com", signedIn: true, leftPercent: 8 },
          { id: "codex-w", name: "Work", email: null, signedIn: true, leftPercent: 72 },
          { id: "codex-x", name: "Old", email: null, signedIn: false, leftPercent: null },
        ]}
        selectedId="default"
        defaultId="default"
        onSelect={onSelect}
        onMakeDefault={onMakeDefault}
      />,
    );
    await expect.element(page.getByRole("radio", { name: /Main/ })).toBeChecked();
    await expect.element(page.getByLabelText("72% left")).toBeVisible();
    await expect.element(page.getByLabelText("8% left")).toHaveAttribute("data-level", "low");
    await expect.element(page.getByText("Default", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("radio", { name: /Old/ })).toBeDisabled();
    await expect.element(page.getByRole("radio", { name: /Old/ })).toHaveTextContent(/Signed out/);
    expect(page.getByRole("button", { name: "Use for new chats" }).elements()).toHaveLength(0);
    await page.getByRole("radio", { name: /Work/ }).click();
    expect(onSelect).toHaveBeenCalledWith("codex-w");

    await screen.rerender(
      <ComposerAccountRow
        accounts={[
          { id: "default", name: "Main", email: null, signedIn: true, leftPercent: 8 },
          { id: "codex-w", name: "Work", email: null, signedIn: true, leftPercent: 72 },
        ]}
        selectedId="codex-w"
        defaultId="default"
        onSelect={onSelect}
        onMakeDefault={onMakeDefault}
      />,
    );
    await page.getByRole("button", { name: "Use for new chats" }).click();
    expect(onMakeDefault).toHaveBeenCalledWith("codex-w");
  });
});
