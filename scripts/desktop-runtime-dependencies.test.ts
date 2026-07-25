import { describe, expect, it } from "vitest";

import {
  omitBundledWorkspaceDependencies,
  resolveDesktopRuntimeDependencies,
} from "./lib/desktop-runtime-dependencies.ts";

describe("resolveDesktopRuntimeDependencies", () => {
  it("excludes Electron and bundled workspace packages from the isolated release stage", () => {
    expect(
      resolveDesktopRuntimeDependencies(
        {
          "@synara/remote-gateway": "workspace:*",
          effect: "catalog:",
          electron: "40.6.0",
          ws: "^8.21.0",
        },
        { effect: "^3.19.0" },
      ),
    ).toEqual({
      effect: "^3.19.0",
      ws: "^8.21.0",
    });
  });

  it("removes bundled workspace packages from server staging dependencies", () => {
    expect(
      omitBundledWorkspaceDependencies({
        "@synara/shared": "workspace:*",
        effect: "catalog:",
      }),
    ).toEqual({ effect: "catalog:" });
  });
});
