import { getStartupCopy } from "./copy";
import type { StartupDraft, StartupShellHandle, StartupShellOptions, StartupStatus } from "./types";
import "./shell.css";

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** A local, dependency-free editor that can mount before the application graph loads. */
export function mountStartupShell(options: StartupShellOptions): StartupShellHandle {
  const copy = getStartupCopy(options.locale);
  const events = new AbortController();
  let draft = options.draft;
  let status: StartupStatus = "loading";
  let composing = false;
  let destroyed = false;
  let sendRequested = false;
  const root = node("div", "djl-startup");
  root.id = "app-startup";
  root.lang = options.locale;
  if (window.desktopBridge && /Mac/i.test(navigator.platform)) root.dataset.nativeMac = "true";
  root.dataset.theme =
    options.snapshot?.theme ??
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  root.style.setProperty(
    "--startup-sidebar-width",
    `${Math.min(400, Math.max(200, options.snapshot?.sidebarWidth ?? 260))}px`,
  );
  const button = (label: string, action: () => void, className = "startup-nav") => {
    const element = node("button", className, label);
    element.type = "button";
    element.addEventListener("click", action, { signal: events.signal });
    return element;
  };
  const chrome = node("header", "startup-chrome");
  const sidebar = node("aside", "startup-sidebar");
  const nav = node("nav", "startup-navigation");
  nav.setAttribute("aria-label", "DJL");
  const surfaces = node("div", "startup-surfaces");
  const work = button(copy.work, () => options.onNavigate("/work"), "startup-surface");
  const projects = button(copy.projects, () => options.onNavigate("/"), "startup-surface");
  surfaces.append(work, projects);
  nav.append(
    surfaces,
    button(copy.home, () => options.onNavigate(draft.surface === "work" ? "/work" : "/")),
    button(copy.workspaces, () => options.onNavigate("/workspaces")),
  );
  sidebar.append(nav);
  for (const [label, items, prefix] of [
    [copy.projects, options.snapshot?.projects ?? [], "/workspaces/"],
    [copy.recent, options.snapshot?.threads ?? [], "/"],
  ] as const) {
    if (!items.length) continue;
    sidebar.append(node("h2", "startup-section-label", label));
    for (const item of items)
      sidebar.append(
        button(item.title, () => options.onNavigate(`${prefix}${encodeURIComponent(item.id)}`)),
      );
  }
  const main = node("main", "startup-main");
  const content = node("div", "startup-content");
  const heading = node("h1", "startup-heading", copy.heading);
  const composer = node("div", "startup-composer");
  const textarea = node("textarea", "startup-textarea");
  textarea.dataset.startupDraft = "true";
  textarea.placeholder = copy.placeholder;
  textarea.setAttribute("aria-label", copy.placeholder);
  textarea.maxLength = 65536;
  textarea.value = draft.text;
  const footer = node("div", "startup-composer-footer");
  const model = node("span", "startup-model");
  const send = button(copy.send, () => submit(), "startup-send");
  const cancel = button(copy.cancel, () => options.onCancelSend(), "startup-cancel");
  footer.append(model, cancel, send);
  composer.append(textarea, footer);
  const notice = node("p", "startup-notice");
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const retry = button(copy.retry, options.onRetry, "startup-retry");
  content.append(heading, composer, notice, retry);
  main.append(content);
  root.append(chrome, sidebar, main);

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

  function frozen() {
    return sendRequested || draft.sendState === "pending" || draft.sendState === "claimed";
  }
  function render() {
    work.setAttribute("aria-pressed", String(draft.surface === "work"));
    projects.setAttribute("aria-pressed", String(draft.surface === "home"));
    const locked = frozen();
    textarea.readOnly = !options.editable || locked;
    send.disabled = !options.editable || locked || !draft.model || !textarea.value.trim();
    cancel.hidden = !locked || draft.sendState === "claimed";
    model.textContent = draft.model?.model ?? copy.modelRequired;
    notice.textContent =
      status === "storage-error"
        ? copy.storageError
        : status === "runtime-error"
          ? copy.sendFailed
          : locked
            ? copy.sending
            : draft.sendState === "uncertain"
              ? copy.recovered
              : copy.loading;
    retry.hidden = status !== "runtime-error";
  }
  function submit() {
    if (composing || send.disabled) return;
    sendRequested = true;
    render();
    options.onSend();
  }
  textarea.addEventListener(
    "input",
    () => {
      if (textarea.readOnly) return;
      options.onEdit(textarea.value);
      render();
    },
    { signal: events.signal },
  );
  textarea.addEventListener(
    "compositionstart",
    () => {
      composing = true;
    },
    { signal: events.signal },
  );
  textarea.addEventListener(
    "compositionend",
    () => {
      composing = false;
    },
    { signal: events.signal },
  );
  textarea.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key !== "Enter" ||
        event.isComposing ||
        composing ||
        event.keyCode === 229 ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      submit();
    },
    { signal: events.signal },
  );
  render();
  document.body.append(root);
  if (options.editable && !frozen()) textarea.focus({ preventScroll: true });
  return {
    update(nextDraft: StartupDraft, nextStatus?: StartupStatus) {
      if (destroyed) return;
      draft = nextDraft;
      sendRequested = false;
      if (nextStatus) status = nextStatus;
      if (textarea.value !== draft.text && !composing) {
        const { selectionStart, selectionEnd, selectionDirection } = textarea;
        textarea.value = draft.text;
        textarea.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
      }
      render();
    },
    selection: () => ({ start: textarea.selectionStart, end: textarea.selectionEnd }),
    isFocused: () => document.activeElement === textarea,
    isComposing: () => composing,
    destroy() {
      destroyed = true;
      events.abort();
      unsubscribe?.();
      root.remove();
    },
  };
}
