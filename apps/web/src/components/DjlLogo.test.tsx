// FILE: DjlLogo.test.tsx
// Purpose: Covers accessible and decorative rendering of the DJL brand mark.
// Layer: web UI tests

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DjlLogo } from "./DjlLogo";

describe("DjlLogo", () => {
  it("exposes an explicitly supplied accessible name", () => {
    const markup = renderToStaticMarkup(<DjlLogo aria-label="DJL logo" />);

    expect(markup).toContain('aria-label="DJL logo"');
    expect(markup).toContain('alt="DJL logo"');
    expect(markup).toContain('src="/djl-logo.png"');
    expect(markup).not.toContain("<svg");
    expect(markup).not.toContain('aria-hidden="true"');
  });

  it("is hidden from assistive technology when decorative", () => {
    const markup = renderToStaticMarkup(<DjlLogo />);

    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
  });
});
