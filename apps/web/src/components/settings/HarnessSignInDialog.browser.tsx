// Set VITE_SIGNIN_SCREENSHOT_DIR to an absolute directory to also save one PNG per
// state for a visual pass (never commit them).

import "../../index.css";

import type { HarnessLoginResult } from "@djl/contracts";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { buildThemeCssVariables, DEFAULT_THEME_STATE, resolveThemePack } from "~/theme/theme.logic";

import { HarnessSignInDialog } from "./HarnessSignInDialog";

type TerminalEvent = { threadId: string; terminalId: string; type: string } & Record<
  string,
  unknown
>;
const terminal = vi.hoisted(() => ({
  listeners: new Set<(event: never) => void>(),
}));
const api = vi.hoisted(() => ({
  shell: { openExternal: vi.fn(async () => undefined) },
}));
vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    ...api,
    terminal: {
      onEvent: (listener: (event: never) => void) => {
        terminal.listeners.add(listener);
        return () => terminal.listeners.delete(listener);
      },
    },
  }),
}));
vi.mock("../terminal/terminalRuntimeRegistry", () => ({
  terminalRuntimeRegistry: { attach: vi.fn(), dispose: vi.fn() },
  buildTerminalRuntimeKey: (threadId: string) => threadId,
}));

const SCREENSHOT_DIR: string | undefined = import.meta.env.VITE_SIGNIN_SCREENSHOT_DIR;
const session = (harness: HarnessLoginResult["harness"]): HarnessLoginResult => ({
  harness,
  threadId: "login-1",
  terminalId: "default",
  cwd: "/tmp",
});
const LINK = "https://cursor.com/loginDeepControl?challenge=abc&mode=login";

function emit(event: Omit<TerminalEvent, "threadId" | "terminalId">) {
  for (const listener of terminal.listeners) {
    listener({ threadId: "login-1", terminalId: "default", ...event } as never);
  }
}

function applyAppearance(variant: "light" | "dark") {
  const html = document.documentElement;
  html.classList.toggle("dark", variant === "dark");
  const theme = buildThemeCssVariables(resolveThemePack(DEFAULT_THEME_STATE, variant), variant);
  for (const [key, value] of Object.entries(theme.variables)) html.style.setProperty(key, value);
  html.setAttribute("data-glass", "blur");
}

async function shot(name: string) {
  if (!SCREENSHOT_DIR) return;
  await page.viewport(1100, 820);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

async function mount(overrides: Partial<ComponentProps<typeof HarnessSignInDialog>> = {}) {
  const handlers = {
    onCheck: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
    onUseForNewChats: vi.fn(),
  };
  const props = {
    harness: "cursor",
    label: "Cursor",
    session: session("cursor"),
    startError: null,
    statusAtOpen: "required",
    status: "required",
    checking: false,
    closing: false,
    isDefault: false,
    ...handlers,
    ...overrides,
  } satisfies ComponentProps<typeof HarnessSignInDialog>;
  const screen = await render(<HarnessSignInDialog {...props} />);
  return {
    props: handlers,
    rerender: (next: Partial<ComponentProps<typeof HarnessSignInDialog>>) =>
      screen.rerender(<HarnessSignInDialog {...props} {...next} />),
  };
}

const step = (name: string) => page.getByRole("listitem").filter({ hasText: name });

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
  terminal.listeners.clear();
});

describe("HarnessSignInDialog", () => {
  it("guides a browser sign-in from the first step to connected", async () => {
    applyAppearance("dark");
    const { props, rerender } = await mount({ session: null });
    await expect.element(page.getByRole("heading", { name: "Sign in to Cursor" })).toBeVisible();
    await expect.element(step("Open the sign-in page")).toHaveAttribute("data-state", "loading");
    await expect.element(page.getByText("Starting Cursor’s sign-in…")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Check connection" })).toBeDisabled();
    expect(page.getByRole("button", { name: "Show sign-in window" }).elements()).toHaveLength(0);

    await rerender({ session: session("cursor") });
    await expect.element(step("Open the sign-in page")).toHaveAttribute("data-state", "done");
    await expect.element(step("Approve in your browser")).toHaveAttribute("data-state", "loading");
    // The agent's own screen stays folded away for a browser sign-in.
    await expect
      .element(page.getByRole("button", { name: "Show sign-in window" }))
      .toHaveAttribute("aria-expanded", "false");
    expect(page.getByRole("button", { name: "Open sign-in page" }).elements()).toHaveLength(0);

    emit({ type: "output", data: `If your browser didn't open, use this link:\r\n${LINK}\r\n` });
    await page.getByRole("button", { name: "Open sign-in page" }).click();
    expect(api.shell.openExternal).toHaveBeenCalledWith(LINK);
    await shot("waiting-dark");

    emit({ type: "exited", exitCode: 0, exitSignal: null });
    await expect.poll(() => props.onCheck.mock.calls.length).toBe(1);
    await rerender({ session: session("cursor"), status: "ready" });
    await expect.element(page.getByRole("heading", { name: "Cursor is connected" })).toBeVisible();
    await expect.element(step("Connected")).toHaveAttribute("data-state", "success");
    await expect.element(page.getByText("Cursor is ready for new chats.")).toBeVisible();
    await shot("connected-dark");

    await page.getByRole("button", { name: "Use for new chats" }).click();
    expect(props.onUseForNewChats).toHaveBeenCalledTimes(1);
    await page.getByRole("button", { name: "Done" }).click();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("checks the account again when the user comes back from the browser", async () => {
    const { props } = await mount();
    await expect.element(step("Approve in your browser")).toHaveAttribute("data-state", "loading");
    window.dispatchEvent(new Event("focus"));
    expect(props.onCheck).toHaveBeenCalledTimes(1);
    await page.getByRole("button", { name: "Check connection" }).click();
    expect(props.onCheck).toHaveBeenCalledTimes(2);
  });

  it("shows the agent's own screen and what to do there when it asks first", async () => {
    applyAppearance("light");
    await mount({ harness: "pi", label: "Pi", session: session("pi") });
    await expect.element(step("Start the sign-in")).toHaveAttribute("data-state", "active");
    await expect
      .element(page.getByText("Type /login in the window below, then press Enter."))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Hide sign-in window" }))
      .toHaveAttribute("aria-expanded", "true");
    await expect
      .element(page.getByRole("region", { name: "Provider sign-in terminal" }))
      .toBeVisible();
    await shot("asks-first-light");

    emit({ type: "output", data: "Open https://example.com/oauth/authorize?code=1 \r\n" });
    await expect.element(step("Start the sign-in")).toHaveAttribute("data-state", "done");
    await expect.element(step("Approve in your browser")).toHaveAttribute("data-state", "loading");
  });

  it("says so and offers another try when the sign-in ends without connecting", async () => {
    applyAppearance("light");
    const { props } = await mount();
    emit({ type: "exited", exitCode: 1, exitSignal: null });
    await expect
      .element(page.getByRole("heading", { name: "Sign-in did not finish" }))
      .toBeVisible();
    await expect.element(step("Approve in your browser")).toHaveAttribute("data-state", "error");
    await expect
      .element(page.getByRole("button", { name: "Hide sign-in window" }))
      .toHaveAttribute("aria-expanded", "true");
    await shot("failed-light");
    await page.getByRole("button", { name: "Try again" }).click();
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows why a sign-in could not start", async () => {
    await mount({ session: null, startError: "Install the official harness tool first." });
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Install the official harness tool first.");
    await expect.element(step("Open the sign-in page")).toHaveAttribute("data-state", "error");
    await expect.element(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("installs the agent first, then moves on to its sign-in", async () => {
    applyAppearance("light");
    const { rerender } = await mount({
      session: null,
      statusAtOpen: "missing",
      status: "missing",
      install: { state: "running", error: null },
    });
    await expect.element(page.getByRole("heading", { name: "Sign in to Cursor" })).toBeVisible();
    await expect.element(step("Install Cursor")).toHaveAttribute("data-state", "loading");
    await expect.element(page.getByText("This can take a few minutes.")).toBeVisible();
    await expect.element(step("Open the sign-in page")).toHaveAttribute("data-state", "pending");
    expect(page.getByRole("button", { name: "Try again" }).elements()).toHaveLength(0);
    await shot("installing-light");

    await rerender({ session: null, status: "required", install: { state: "done", error: null } });
    await expect.element(step("Install Cursor")).toHaveAttribute("data-state", "done");
    await expect.element(step("Open the sign-in page")).toHaveAttribute("data-state", "loading");
    await rerender({
      session: session("cursor"),
      status: "required",
      install: { state: "done", error: null },
    });
    await expect.element(step("Approve in your browser")).toHaveAttribute("data-state", "loading");
  });

  it("says what stopped the install and installs again on request", async () => {
    const { props } = await mount({
      session: null,
      statusAtOpen: "missing",
      status: "missing",
      install: { state: "failed", error: "Installation failed. Check network access." },
    });
    await expect
      .element(page.getByRole("heading", { name: "Installation did not finish" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Installation failed. Check network access.");
    await expect.element(step("Install Cursor")).toHaveAttribute("data-state", "error");
    await expect.element(step("Open the sign-in page")).toHaveAttribute("data-state", "pending");
    await page.getByRole("button", { name: "Try again" }).click();
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not call a connected account connected again until this sign-in finishes", async () => {
    await mount({ statusAtOpen: "ready", status: "ready", isDefault: true });
    await expect.element(step("Approve in your browser")).toHaveAttribute("data-state", "loading");
    emit({ type: "exited", exitCode: 0, exitSignal: null });
    await expect.element(page.getByRole("heading", { name: "Cursor is connected" })).toBeVisible();
    expect(page.getByRole("button", { name: "Use for new chats" }).elements()).toHaveLength(0);
  });
});
