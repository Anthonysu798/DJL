import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function DesktopHeaderPortal({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) {
      setTarget(null);
      return;
    }
    const attach = () => {
      const toolbar = document.getElementById("djl-desktop-toolbar");
      if (!toolbar) return false;
      setTarget(toolbar);
      return true;
    };
    if (attach()) return;
    // The shell portal can commit after the chat header's first effect.
    const observer = new MutationObserver(() => {
      if (attach()) observer.disconnect();
    });
    observer.observe(document.getElementById("djl-desktop-chrome") ?? document.body, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [enabled]);
  return enabled && target ? createPortal(children, target) : children;
}
