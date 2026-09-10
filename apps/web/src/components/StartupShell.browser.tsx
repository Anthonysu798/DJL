import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { mountStartupShell } from "../startup/shell";
import { getStartupCopy } from "../startup/copy";
import type { StartupDraft, StartupShellHandle, StartupShellOptions } from "../startup/types";

let shell: StartupShellHandle | undefined;
const initial: StartupDraft = {
  id: "draft",
  surface: "home",
  text: "",
  threadId: null,
  model: { provider: "codex", model: "gpt-5" },
  sendState: "editing",
  revision: 0,
  updatedAt: 1,
};
function mount(overrides: Partial<StartupShellOptions> = {}) {
  let draft = { ...initial };
  const options: StartupShellOptions = {
    draft,
    snapshot: null,
    locale: "en",
    editable: true,
    onEdit: vi.fn((text: string) => {
      draft = { ...draft, text, revision: draft.revision + 1 };
      shell?.update(draft);
    }),
    onSend: vi.fn(),
    onCancelSend: vi.fn(),
    onNavigate: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  shell = mountStartupShell(options);
  return options;
}
function textarea() {
  return document.querySelector<HTMLTextAreaElement>(".startup-textarea")!;
}
afterEach(() => {
  shell?.destroy();
  shell = undefined;
  vi.unstubAllGlobals();
});

it("accepts multibyte input before any native API and keeps selection on status changes", async () => {
  vi.stubGlobal("desktopBridge", undefined);
  const options = mount();
  await userEvent.fill(page.getByRole("textbox"), "你好 👋 café");
  expect(options.onEdit).toHaveBeenCalledWith("你好 👋 café");
  textarea().setSelectionRange(2, 4);
  shell!.update({ ...initial, text: textarea().value }, "storage-error");
  expect(shell!.selection()).toEqual({ start: 2, end: 4 });
  expect(shell!.isFocused()).toBe(true);
  await expect.element(page.getByRole("status")).toHaveTextContent("Draft is only in memory");
});
it("guards duplicate Send, freezes pending text, and supports Cancel", async () => {
  const options = mount({ draft: { ...initial, text: "A task" } });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect(options.onSend).toHaveBeenCalledTimes(1);
  expect(textarea().readOnly).toBe(true);
  textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(options.onSend).toHaveBeenCalledTimes(1);
  shell!.update({ ...initial, text: "A task", sendState: "pending" });
  await page.getByRole("button", { name: "Cancel send" }).click();
  expect(options.onCancelSend).toHaveBeenCalledTimes(1);
  shell!.update({ ...initial, text: "A task" });
  expect(textarea().readOnly).toBe(false);
});
it("ignores composition Enter and Shift Enter, and accepts command Enter", () => {
  const options = mount({ draft: { ...initial, text: "日本語" } });
  const input = textarea();
  input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  expect(shell!.isComposing()).toBe(true);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(options.onSend).not.toHaveBeenCalled();
  input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  expect(shell!.isComposing()).toBe(false);
  const newline = new KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(newline);
  expect(newline.defaultPrevented).toBe(false);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  expect(options.onSend).toHaveBeenCalledTimes(1);
});
it("requires model and nonblank text before Send", async () => {
  mount({ draft: { ...initial, text: "hello", model: null } });
  await expect.element(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect.element(page.getByText(getStartupCopy("en").modelRequired)).toBeVisible();
  shell!.update({ ...initial, text: "   " });
  await expect.element(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
});
it("renders snapshot titles literally and uses keyboard-accessible navigation", async () => {
  const title = '<img src=x onerror="alert(1)">';
  const options = mount({
    snapshot: {
      version: 1,
      savedAt: 1,
      locale: "en",
      theme: "dark",
      sidebarWidth: 260,
      projects: [{ id: "p/1", title }],
      threads: [{ id: "t1", title: "Earlier task" }],
      model: null,
    },
  });
  expect(document.querySelector("#app-startup img")).toBeNull();
  await page.getByRole("button", { name: title, exact: true }).click();
  expect(options.onNavigate).toHaveBeenCalledWith("/workspaces/p%2F1");
  const work = document.querySelector<HTMLButtonElement>(".startup-surfaces button")!;
  work.focus();
  await userEvent.keyboard("{Enter}");
  expect(options.onNavigate).toHaveBeenCalledWith("/work");
  await expect
    .element(page.getByRole("button", { name: "Projects", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  expect(options.onNavigate).toHaveBeenLastCalledWith("/");
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  expect(options.onNavigate).toHaveBeenLastCalledWith("/workspaces");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  expect(options.onNavigate).toHaveBeenLastCalledWith("/");
  shell!.update({ ...initial, surface: "work" });
  await expect
    .element(page.getByRole("button", { name: "Work", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  expect(options.onNavigate).toHaveBeenLastCalledWith("/work");
  await page.getByRole("button", { name: "Earlier task" }).click();
  expect(options.onNavigate).toHaveBeenCalledWith("/t1");
});
it("shows recovery and retry, localizes copy, and tears down listeners", async () => {
  const options = mount({
    locale: "fr",
    draft: { ...initial, text: "Bonjour", sendState: "uncertain" },
  });
  await expect.element(page.getByRole("status")).toHaveTextContent(getStartupCopy("fr").recovered);
  shell!.update({ ...initial, text: "Bonjour" }, "runtime-error");
  await page.getByRole("button", { name: "Réessayer" }).click();
  expect(options.onRetry).toHaveBeenCalledTimes(1);
  const input = textarea();
  shell!.destroy();
  expect(document.getElementById("app-startup")).toBeNull();
  input.dispatchEvent(new Event("input"));
  expect(options.onEdit).not.toHaveBeenCalled();
});
it("does not autofocus or allow Send on a noneditable route", async () => {
  mount({ editable: false, draft: { ...initial, text: "text" } });
  expect(shell!.isFocused()).toBe(false);
  expect(textarea().readOnly).toBe(true);
  await expect.element(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
});
