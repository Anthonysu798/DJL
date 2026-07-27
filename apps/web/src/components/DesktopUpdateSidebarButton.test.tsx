import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DesktopUpdateSidebarButton } from "./DesktopUpdateSidebarButton";

describe("DesktopUpdateSidebarButton", () => {
  it("renders an enabled circular blue download icon when an update is ready", () => {
    const markup = renderToStaticMarkup(
      <DesktopUpdateSidebarButton
        label="Update 1.1.0 is ready. Click to restart and install."
        disabled={false}
        busy={false}
        onClick={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="desktop-update-button"');
    expect(markup).toContain(
      'aria-label="Update 1.1.0 is ready. Click to restart and install."',
    );
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("bg-[var(--info)]");
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("disabled");
    expect(markup).not.toContain('aria-busy="true"');
  });

  it("is disabled and exposes busy state while the update downloads", () => {
    const markup = renderToStaticMarkup(
      <DesktopUpdateSidebarButton
        label="Preparing update (42%)"
        disabled
        busy
        onClick={vi.fn()}
      />,
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("animate-pulse");
  });
});
