import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const iosRoot = join(import.meta.dirname, "..", "apps", "ios");
const projectPath = join(iosRoot, "DJL.xcodeproj", "project.pbxproj");

const readProject = (): string => readFileSync(projectPath, "utf8");

describe("DJL iOS project identity", () => {
  it("uses the DJL project and target names", () => {
    expect(existsSync(projectPath)).toBe(true);

    const project = readProject();
    expect(project).toContain('PBXNativeTarget "DJL"');
    expect(project).toContain('PBXNativeTarget "DJLTests"');
    expect(project).toContain('PBXNativeTarget "DJLUITests"');
    expect(project).toContain('PBXNativeTarget "DJLWidget"');
  });

  it("uses the production identifiers and approved signing team", () => {
    const project = readProject();

    expect(project).toContain("PRODUCT_BUNDLE_IDENTIFIER = app.djl.ios;");
    expect(project).toContain("PRODUCT_BUNDLE_IDENTIFIER = app.djl.ios.widgets;");
    expect(project).toContain("DEVELOPMENT_TEAM = U76N9JSK4M;");
    expect(project).toContain("IPHONEOS_DEPLOYMENT_TARGET = 18.6;");
  });

  it("does not ship the imported standalone Mac menu-bar app", () => {
    const project = readProject();

    expect(project).not.toContain("RemodexMenuBar");
    expect(existsSync(join(iosRoot, "RemodexMenuBar"))).toBe(false);
    expect(
      existsSync(
        join(iosRoot, "DJL.xcodeproj", "xcshareddata", "xcschemes", "RemodexMenuBar.xcscheme"),
      ),
    ).toBe(false);
  });

  it("uses the DJL app group in both app extension entitlements", () => {
    const appEntitlements = readFileSync(join(iosRoot, "DJL", "DJL.entitlements"), "utf8");
    const widgetEntitlements = readFileSync(
      join(iosRoot, "DJLWidget", "DJLWidget.entitlements"),
      "utf8",
    );

    expect(appEntitlements).toContain("group.app.djl.ios");
    expect(widgetEntitlements).toContain("group.app.djl.ios");
  });

  it("ships every remote-control capability without subscription gating", () => {
    const project = readProject();

    expect(project).not.toContain("RevenueCat");
    expect(existsSync(join(iosRoot, "DJL", "Services", "Payments"))).toBe(false);
    expect(existsSync(join(iosRoot, "DJL", "Views", "Payments"))).toBe(false);
    expect(
      existsSync(join(iosRoot, "DJL", "Views", "Settings", "SettingsSubscriptionCard.swift")),
    ).toBe(false);
  });
});
