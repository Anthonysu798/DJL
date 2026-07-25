import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { initializeI18nInstance, rendererI18n } from "../i18n";
import { RuntimeUsageControls } from "./BranchToolbar";

describe("RuntimeUsageControls", () => {
  it("renders the automatic-review profile as Approve for me", async () => {
    await initializeI18nInstance({
      preference: "en",
      instance: rendererI18n,
      documentElement: null,
    });

    const markup = renderToStaticMarkup(
      <RuntimeUsageControls
        runtimeMode={"auto-approval" as never}
        provider="opencode"
        onRuntimeModeChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Approve for me");
    expect(markup).toContain("Only ask for actions detected as potentially unsafe");
  });

  it("renders unrestricted mode as Full access", async () => {
    await initializeI18nInstance({
      preference: "en",
      instance: rendererI18n,
      documentElement: null,
    });

    const markup = renderToStaticMarkup(
      <RuntimeUsageControls
        runtimeMode="full-access"
        provider="opencode"
        onRuntimeModeChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Full access");
    expect(markup).toContain("Unrestricted access to the internet and any file on your computer");
  });
});
