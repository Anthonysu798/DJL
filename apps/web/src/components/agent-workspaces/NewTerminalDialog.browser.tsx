import "../../index.css";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { NewTerminalDialog, type NewTerminalDialogProps } from "./NewTerminalDialog";
import { buildThemeCssVariables, DEFAULT_THEME_STATE, resolveThemePack } from "~/theme/theme.logic";

const originalStyle = document.documentElement.style.cssText;
const originalClass = document.documentElement.className;
afterEach(async () => {
  await cleanup();
  document.documentElement.style.cssText = originalStyle;
  document.documentElement.className = originalClass;
});
function Harness({
  onLaunch = () => {},
  onAddAccount = () => {},
}: Pick<NewTerminalDialogProps, "onLaunch" | "onAddAccount">) {
  const [open, setOpen] = useState(true);
  const [profileId, setProfileId] = useState("");
  const [count, setCount] = useState(1);
  return (
    <NewTerminalDialog
      open={open}
      onOpenChange={setOpen}
      profileId={profileId}
      onProfileChange={setProfileId}
      count={count}
      onCountChange={setCount}
      profiles={[
        { id: "personal", provider: "codex", name: "Personal" },
        { id: "work", provider: "claudeAgent", name: "Work account with a long name" },
      ]}
      onAddAccount={onAddAccount}
      onLaunch={onLaunch}
    />
  );
}
function applyTheme(mode: "dark" | "light") {
  document.documentElement.classList.toggle("dark", mode === "dark");
  const theme = buildThemeCssVariables(resolveThemePack(DEFAULT_THEME_STATE, mode), mode);
  for (const [key, value] of Object.entries(theme.variables))
    document.documentElement.style.setProperty(key, value);
}
function luminance(value: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
describe("New terminal dialog", () => {
  it("selects an account and terminal count without submitting until Launch", async () => {
    applyTheme("dark");
    const launch = vi.fn();
    await render(<Harness onLaunch={launch} onAddAccount={() => {}} />);
    await expect.element(page.getByRole("combobox", { name: "Account profile" })).toHaveFocus();
    await page.getByRole("combobox", { name: "Account profile" }).click();
    await page.getByRole("option", { name: "Codex · Personal" }).click();
    await expect.element(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Number of terminals" }).click();
    await page.getByRole("option", { name: "10 terminals", exact: true }).click();
    expect(launch).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Open 10 terminals", exact: true }).click();
    expect(launch).toHaveBeenCalledExactlyOnceWith("run");
  });
  it("keeps sign-in separate and lets Cancel close without launching", async () => {
    applyTheme("dark");
    const launch = vi.fn();
    await render(<Harness onLaunch={launch} onAddAccount={() => {}} />);
    await page.getByRole("combobox", { name: "Account profile" }).click();
    await page.getByRole("option", { name: "Codex · Personal" }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    expect(launch).toHaveBeenCalledExactlyOnceWith("login");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect
      .element(page.getByRole("dialog", { name: "New terminal" }))
      .not.toBeInTheDocument();
    expect(launch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { mode: "dark" as const, width: 1280 },
    { mode: "light" as const, width: 390 },
  ])("fits at $width px in $mode mode with legible controls", async ({ mode, width }) => {
    await page.viewport(width, 720);
    applyTheme(mode);
    await render(<Harness onLaunch={() => {}} onAddAccount={() => {}} />);
    await expect
      .element(page.getByRole("button", { name: "Open 1 terminal", exact: true }))
      .toBeVisible();
    await document.fonts.ready;
    await vi.waitFor(() => {
      const dialog = document.querySelector<HTMLElement>(".terminal-launch-dialog")!;
      const bounds = dialog.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
      const cta = dialog.querySelector<HTMLElement>(".terminal-launch-submit")!;
      const style = getComputedStyle(cta);
      const a = luminance(style.color),
        b = luminance(style.backgroundColor);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
      const trigger = dialog.querySelector<HTMLElement>(".terminal-launch-field")!;
      expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(80);
      expect(getComputedStyle(dialog.querySelector(".terminal-launch-footer")!).opacity).toBe("1");
    });
  });
});
