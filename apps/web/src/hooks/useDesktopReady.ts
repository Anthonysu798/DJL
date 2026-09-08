import { useEffect } from "react";

// Signal after a committed frame, rather than DOMContentLoaded (which precedes
// lazy route loading). StrictMode and later navigation may repeat this safely.
export function useDesktopReady() {
  useEffect(() => {
    if (!window.desktopBridge?.notifyReady) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => window.desktopBridge?.notifyReady?.());
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}
