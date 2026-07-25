// FILE: -workRoutes.test.ts
// Purpose: Verifies the public Work route and the compatibility redirect from Studio.

import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { Route as LegacyStudioRoute } from "./_chat.studio.index";
import { Route as WorkRoute } from "./_chat.work.index";

describe("DJL Work routes", () => {
  it("registers a rendered Work task landing at /work", () => {
    expect(WorkRoute.options.component).toEqual(expect.any(Function));
  });

  it("redirects the legacy /studio route to /work", () => {
    try {
      LegacyStudioRoute.options.beforeLoad?.({} as never);
      throw new Error("Expected the legacy route to redirect");
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      expect(error).toMatchObject({ options: { to: "/work", replace: true } });
    }
  });
});
