import { getStartupCopy } from "./copy";
import { mountStartupParticles } from "./particles";
import { mountStartupBackground } from "./background";
import { remainingSplashDuration } from "./timing";
import type { StartupDraft, StartupShellHandle, StartupShellOptions, StartupStatus } from "./types";
import "./shell.css";

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** Lightweight splash that paints before the application graph loads. */
export function mountStartupShell(options: StartupShellOptions): StartupShellHandle {
  const mountedAt = performance.now();
  const copy = getStartupCopy(options.locale);
  const events = new AbortController();
  let draft = options.draft;
  let status: StartupStatus = "loading";
  let destroyed = false;
  let revealRequested = false;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let removalTimer: ReturnType<typeof setTimeout> | undefined;
  const root = node("div", "djl-startup");
  root.id = "app-startup";
  root.lang = options.locale;
  root.dataset.state = "loading";
  root.dataset.theme =
    options.snapshot?.theme ??
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const button = (label: string, action: () => void, className: string) => {
    const element = node("button", className, label);
    element.type = "button";
    element.addEventListener("click", action, { signal: events.signal });
    return element;
  };
  const chrome = node("header", "startup-chrome");
  const main = node("main", "startup-main");
  const content = node("div", "startup-content");
  const art = node("div", "startup-art");
  art.setAttribute("aria-hidden", "true");
  const aura = node("div", "startup-aura");
  const canvas = node("canvas", "startup-particles");
  art.append(aura, canvas);
  const particles = mountStartupParticles(canvas, root.dataset.theme === "dark");
  const heading = node("h1", "startup-heading", "DJL");
  const notice = node("p", "startup-notice");
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const activity = node("div", "startup-activity");
  activity.setAttribute("aria-hidden", "true");
  activity.append(node("span", "startup-activity-light"));
  const retry = button(copy.retry, options.onRetry, "startup-retry");
  content.append(art, heading, notice, activity, retry);
  main.append(content);
  const backdrop = node("div", "startup-background");
  backdrop.setAttribute("aria-hidden", "true");
  root.append(backdrop, chrome, main);
  const background = mountStartupBackground(backdrop, root.dataset.theme === "dark");

  const controls = window.desktopBridge?.windowControls;
  let unsubscribe: (() => void) | undefined;
  if (/Win/i.test(navigator.platform) && controls) {
    const captions = node("div", "startup-caption-controls");
    const minimize = button(
      "−",
      () => {
        void controls.minimize();
      },
      "startup-caption",
    );
    minimize.setAttribute("aria-label", copy.minimize);
    const maximize = button(
      "□",
      () => {
        void controls.toggleMaximize().then(setWindowState);
      },
      "startup-caption",
    );
    const close = button(
      "×",
      () => {
        void controls.close();
      },
      "startup-caption startup-close",
    );
    close.setAttribute("aria-label", copy.close);
    function setWindowState(state: { isMaximized: boolean }) {
      if (destroyed) return;
      maximize.textContent = state.isMaximized ? "▣" : "□";
      maximize.setAttribute("aria-label", state.isMaximized ? copy.restore : copy.maximize);
    }
    maximize.setAttribute("aria-label", copy.maximize);
    void controls
      .getState()
      .then(setWindowState)
      .catch(() => {});
    unsubscribe = controls.onState(setWindowState);
    captions.append(minimize, maximize, close);
    chrome.append(captions);
  }

  function render() {
    root.dataset.state = status === "runtime-error" ? "error" : "loading";
    notice.textContent =
      status === "runtime-error"
        ? copy.sendFailed
        : status === "storage-error"
          ? copy.storageError
          : copy.loading;
    particles.pause(status === "runtime-error");
    background.pause(status === "runtime-error");
    activity.hidden = status === "runtime-error";
    retry.hidden = status !== "runtime-error";
  }
  function destroy() {
    destroyed = true;
    clearTimeout(revealTimer);
    clearTimeout(removalTimer);
    events.abort();
    particles.destroy();
    background.destroy();
    unsubscribe?.();
    root.remove();
  }
  render();
  document.body.append(root);
  return {
    update(nextDraft: StartupDraft, nextStatus?: StartupStatus) {
      if (destroyed || root.dataset.state === "leaving") return;
      draft = nextDraft;
      if (nextStatus) status = nextStatus;
      render();
    },
    // Retain saved-draft handoff without exposing an editor during startup.
    selection: () => ({ start: draft.text.length, end: draft.text.length }),
    isFocused: () => false,
    isComposing: () => false,
    reveal(onReveal = () => {}) {
      if (destroyed || revealRequested) return;
      revealRequested = true;
      const transition = () => {
        if (destroyed) return;
        onReveal();
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
          destroy();
          return;
        }
        particles.reveal();
        background.pause(true);
        root.dataset.state = "leaving";
        root.inert = true;
        root.setAttribute("aria-hidden", "true");
        removalTimer = setTimeout(destroy, 280);
      };
      const remaining = remainingSplashDuration(mountedAt);
      if (remaining > 0) revealTimer = setTimeout(transition, remaining);
      else transition();
    },
    destroy,
  };
}
