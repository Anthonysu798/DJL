type Callback = (visible: boolean) => void;
type Group = {
  observer: IntersectionObserver;
  callbacks: Map<Element, Callback>;
  visible: Set<Element>;
};
const groups = new Map<Element | null, Group>();
let listening = false;
function onDocumentVisibility() {
  for (const group of groups.values())
    for (const [element, callback] of group.callbacks)
      callback(document.visibilityState !== "hidden" && group.visible.has(element));
}

// One observer per scroll viewport and one document listener, regardless of pane count.
export function observeWorkspaceTerminalVisibility(
  element: Element,
  callback: Callback,
): () => void {
  const root = element.closest("[data-terminal-scroll-viewport]");
  let group = groups.get(root);
  if (!group) {
    const callbacks = new Map<Element, Callback>();
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
          callbacks.get(entry.target)?.(
            entry.isIntersecting && document.visibilityState !== "hidden",
          );
        }
      },
      { root, rootMargin: "400px 0px" },
    );
    group = { observer, callbacks, visible };
    groups.set(root, group);
  }
  if (!listening) {
    document.addEventListener("visibilitychange", onDocumentVisibility);
    listening = true;
  }
  group.callbacks.set(element, callback);
  group.observer.observe(element);
  return () => {
    group!.observer.unobserve(element);
    group!.callbacks.delete(element);
    group!.visible.delete(element);
    if (group!.callbacks.size === 0) {
      group!.observer.disconnect();
      groups.delete(root);
    }
    if (groups.size === 0 && listening) {
      document.removeEventListener("visibilitychange", onDocumentVisibility);
      listening = false;
    }
  };
}

// Match the observer's overscan when reattaching an already parsed screen before paint.
export function isWorkspaceTerminalVisible(element: Element): boolean {
  if (document.visibilityState === "hidden") return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const root = element.closest("[data-terminal-scroll-viewport]")?.getBoundingClientRect();
  return (
    rect.bottom >= (root?.top ?? 0) - 400 && rect.top <= (root?.bottom ?? window.innerHeight) + 400
  );
}
