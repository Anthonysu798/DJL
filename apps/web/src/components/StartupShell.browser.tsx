import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { mountStartupShell } from "../startup/shell";
import { getStartupCopy } from "../startup/copy";
import { StartupSession } from "../startup/session";
import { StartupStorage } from "../startup/storage";
import { remainingSplashDuration } from "../startup/timing";
import type { StartupDraft, StartupShellHandle, StartupShellOptions } from "../startup/types";

vi.mock("../startup/timing", () => ({ remainingSplashDuration: vi.fn(() => 0) }));

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
  const options: StartupShellOptions = {
    draft: { ...initial },
    snapshot: null,
    locale: "en",
    editable: true,
    onEdit: vi.fn(),
    onSend: vi.fn(),
    onCancelSend: vi.fn(),
    onNavigate: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  shell = mountStartupShell(options);
  return options;
}
afterEach(() => {
  shell?.destroy();
  shell = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.mocked(remainingSplashDuration).mockReturnValue(0);
});

it("shows branded artwork and loading status without an input or navigation", async () => {
  const options = mount({ draft: { ...initial, text: "Saved draft" } });
  await expect.element(page.getByRole("heading", { name: "DJL", exact: true })).toBeVisible();
  await expect.element(page.getByRole("status")).toHaveTextContent(getStartupCopy("en").loading);
  expect(document.querySelector("#app-startup img")).toBeNull();
  const canvas = document.querySelector<HTMLCanvasElement>(".startup-particles")!;
  await expect.poll(() => canvas.width > 0 && canvas.height > 0).toBe(true);
  await expect
    .poll(() =>
      canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((value, index) => index % 4 === 3 && value > 0),
    )
    .toBe(true);
  expect(document.querySelector("textarea, input, nav")).toBeNull();
  expect(shell!.isFocused()).toBe(false);
  expect(shell!.isComposing()).toBe(false);
  expect(shell!.selection()).toEqual({ start: 11, end: 11 });
  expect(options.onSend).not.toHaveBeenCalled();
});

it("keeps the app hidden until readiness, then reveals it and removes the splash", async () => {
  const root = document.createElement("div");
  root.id = "root";
  root.inert = true;
  document.body.append(root);
  const session = new StartupSession(
    new StartupStorage("splash-ready", localStorage),
    "home",
    null,
  );
  try {
    mount();
    session.attachShell(shell!);
    expect(getComputedStyle(root).visibility).toBe("hidden");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(session.previewActive).toBe(true);
    expect(root.inert).toBe(true);
    session.finishPreview();
    expect(session.previewActive).toBe(false);
    expect(root.inert).toBe(false);
    expect(getComputedStyle(root).visibility).toBe("visible");
    await expect.poll(() => document.getElementById("app-startup")).toBeNull();
  } finally {
    root.remove();
  }
});

it("shows localized failure recovery and tears down retry listeners", async () => {
  const options = mount({ locale: "fr" });
  shell!.update(initial, "runtime-error");
  await expect.element(page.getByRole("status")).toHaveTextContent(getStartupCopy("fr").sendFailed);
  const retry = page.getByRole("button", { name: "Réessayer" });
  await retry.click();
  expect(options.onRetry).toHaveBeenCalledTimes(1);
  const button = document.querySelector<HTMLButtonElement>(".startup-retry")!;
  shell!.destroy();
  button.click();
  expect(options.onRetry).toHaveBeenCalledTimes(1);
  expect(document.getElementById("app-startup")).toBeNull();
});

it("preserves saved drafts without exposing their contents on the splash", async () => {
  mount();
  shell!.update(
    { ...initial, text: "Private saved draft", sendState: "uncertain" },
    "storage-error",
  );
  expect(document.getElementById("app-startup")!.textContent).not.toContain("Private saved draft");
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent(getStartupCopy("en").storageError);
  expect(shell!.selection()).toEqual({ start: 19, end: 19 });
});

it("keeps the illustration and recovery action inside a compact window", async () => {
  await page.viewport(360, 480);
  try {
    mount();
    shell!.update(initial, "runtime-error");
    const art = document.querySelector<HTMLElement>(".startup-art")!.getBoundingClientRect();
    const retry = document.querySelector<HTMLElement>(".startup-retry")!.getBoundingClientRect();
    expect(art.left).toBeGreaterThanOrEqual(0);
    expect(art.right).toBeLessThanOrEqual(360);
    expect(retry.bottom).toBeLessThanOrEqual(480);
    await expect.element(page.getByRole("button", { name: "Retry" })).toBeVisible();
  } finally {
    await page.viewport(1000, 1000);
  }
});

it("keeps reduced-motion particles static and reveals the app immediately", async () => {
  const nativeMatchMedia = window.matchMedia.bind(window);
  vi.stubGlobal("matchMedia", (query: string) => {
    const media = nativeMatchMedia(query);
    Object.defineProperty(media, "matches", { value: query.includes("prefers-reduced-motion") });
    return media;
  });
  mount();
  const canvas = document.querySelector<HTMLCanvasElement>(".startup-particles")!;
  await expect
    .poll(
      () =>
        canvas.width === Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1, 2)) &&
        canvas.clientWidth > 0,
    )
    .toBe(true);
  const pixels = () =>
    canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  const before = pixels();
  canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 500, clientY: 500 }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(pixels()).toEqual(before);
  shell!.reveal!();
  expect(document.getElementById("app-startup")).toBeNull();
});

it("stops drawing when the splash is destroyed", async () => {
  mount();
  const canvas = document.querySelector<HTMLCanvasElement>(".startup-particles")!;
  const clear = vi.spyOn(canvas.getContext("2d")!, "clearRect");
  try {
    await expect.poll(() => clear.mock.calls.length).toBeGreaterThan(0);
    shell!.destroy();
    const calls = clear.mock.calls.length;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(clear).toHaveBeenCalledTimes(calls);
  } finally {
    clear.mockRestore();
  }
});

it("holds a ready app for seven seconds without letting duplicate readiness skip the intro", () => {
  vi.mocked(remainingSplashDuration).mockReturnValue(7_000);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const root = document.createElement("div");
  root.id = "root";
  root.inert = true;
  document.body.append(root);
  const session = new StartupSession(
    new StartupStorage("splash-duration", localStorage),
    "home",
    null,
  );
  try {
    mount();
    session.attachShell(shell!);
    session.finishPreview();
    session.finishPreview();
    vi.advanceTimersByTime(6_999);
    expect(root.inert).toBe(true);
    expect(getComputedStyle(root).visibility).toBe("hidden");
    vi.advanceTimersByTime(1);
    expect(root.inert).toBe(false);
    expect(getComputedStyle(root).visibility).toBe("visible");
    vi.advanceTimersByTime(280);
    expect(document.getElementById("app-startup")).toBeNull();
  } finally {
    root.remove();
  }
});

it("waits for actual readiness when loading takes longer than the intro", () => {
  vi.mocked(remainingSplashDuration).mockReturnValue(7_000);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  mount();
  vi.advanceTimersByTime(10_000);
  vi.mocked(remainingSplashDuration).mockReturnValue(0);
  expect(document.getElementById("app-startup")?.dataset.state).toBe("loading");
  const ready = vi.fn();
  shell!.reveal!(ready);
  expect(ready).toHaveBeenCalledTimes(1);
});

it("cancels a pending reveal when the splash is destroyed", () => {
  vi.mocked(remainingSplashDuration).mockReturnValue(7_000);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  mount();
  const ready = vi.fn();
  shell!.reveal!(ready);
  shell!.destroy();
  vi.advanceTimersByTime(10_000);
  expect(ready).not.toHaveBeenCalled();
});
