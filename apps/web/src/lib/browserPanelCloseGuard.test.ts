import { describe, expect, it, vi } from "vitest";

import {
  replaceBrowserPanelWithGuard,
  toggleBrowserPanelWithGuard,
} from "./browserPanelCloseGuard";

describe("toggleBrowserPanelWithGuard", () => {
  it.each(["single-view Panels menu", "split-view Panels menu", "desktop shortcut"])(
    "routes an open Browser through its registered close request for %s",
    () => {
      const requestClose = vi.fn();
      const toggle = vi.fn();
      toggleBrowserPanelWithGuard({ browserOpen: true, requestClose, toggle });
      expect(requestClose).toHaveBeenCalledOnce();
      expect(toggle).not.toHaveBeenCalled();
    },
  );

  it("opens Browser directly when no Browser panel is currently open", () => {
    const toggle = vi.fn();
    toggleBrowserPanelWithGuard({ browserOpen: false, requestClose: undefined, toggle });
    expect(toggle).toHaveBeenCalledOnce();
  });

  it.each(["split Diff toggle", "split turn Diff", "single Diff toggle"])(
    "defers %s until the registered Browser close request confirms",
    () => {
      const replace = vi.fn();
      const requestClose = vi.fn<(onClosed?: () => void) => void>();
      replaceBrowserPanelWithGuard({ browserOpen: true, requestClose, replace });
      expect(replace).not.toHaveBeenCalled();
      requestClose.mock.calls[0]?.[0]?.();
      expect(replace).toHaveBeenCalledOnce();
    },
  );
});
