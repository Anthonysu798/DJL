import { assert, describe, it } from "@effect/vitest";

import {
  AI_DETECTOR_ASAR_UNPACK_GLOBS,
  createDesktopPlatformBuildConfig,
  MAC_ENTITLEMENTS_PATH,
  MAC_INHERITED_ENTITLEMENTS_PATH,
  MICROPHONE_USAGE_DESCRIPTION,
  NODE_PTY_ASAR_UNPACK_GLOBS,
  validateDesktopNativeBuildHost,
  WINDOWS_INSTALLER_GUID,
} from "./lib/desktop-platform-build-config.ts";
import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

describe("createDesktopPlatformBuildConfig", () => {
  it("adds explicit microphone entitlements to macOS builds", () => {
    const config = createDesktopPlatformBuildConfig({
      platform: "mac",
      target: "dmg",
      macIdentity: "-",
      signed: false,
    });
    const mac = config.mac as Record<string, unknown>;
    const extendInfo = mac.extendInfo as Record<string, unknown>;

    assert.deepStrictEqual(mac.target, ["dmg", "zip"]);
    assert.equal(mac.icon, "icon.icns");
    assert.equal(mac.identity, "-");
    assert.equal(mac.notarize, false);
    assert.deepStrictEqual(config.asarUnpack, [
      "node_modules/node-pty/**",
      ...AI_DETECTOR_ASAR_UNPACK_GLOBS,
    ]);
    assert.equal(mac.hardenedRuntime, true);
    assert.equal(mac.entitlements, MAC_ENTITLEMENTS_PATH);
    assert.equal(mac.entitlementsInherit, MAC_INHERITED_ENTITLEMENTS_PATH);
    assert.equal(extendInfo.NSMicrophoneUsageDescription, MICROPHONE_USAGE_DESCRIPTION);
  });

  it("routes signed macOS builds through the repository-owned afterSign hook", () => {
    const config = createDesktopPlatformBuildConfig({
      platform: "mac",
      target: "dmg",
      macAfterSignHook: "/repo/scripts/notarize-macos-after-sign.cjs",
      signed: true,
    });
    const mac = config.mac as Record<string, unknown>;

    assert.equal(mac.identity, undefined);
    assert.equal(mac.notarize, false);
    assert.equal(config.afterSign, "/repo/scripts/notarize-macos-after-sign.cjs");
    assert.deepStrictEqual(config.dmg, { sign: true });
    assert.equal(mac.hardenedRuntime, true);
  });

  it("never configures Electron Builder to submit notarization itself", () => {
    const config = createDesktopPlatformBuildConfig({
      platform: "mac",
      target: "dmg",
    });
    const mac = config.mac as Record<string, unknown>;

    assert.equal(mac.notarize, false);
    assert.equal(config.afterSign, undefined);
  });

  it("fails closed when a signed macOS build omits the repository hook", () => {
    assert.throws(
      () =>
        createDesktopPlatformBuildConfig({
          platform: "mac",
          target: "dmg",
          signed: true,
        }),
      /signed macOS builds require the repository-owned notarization hook/i,
    );
  });

  it("leaves non-macOS platform configs unchanged", () => {
    const linux = createDesktopPlatformBuildConfig({
      platform: "linux",
      target: "AppImage",
    });
    const win = createDesktopPlatformBuildConfig({
      platform: "win",
      target: "nsis",
      windowsAzureSignOptions: { publisherName: "Synara" },
    });

    assert.equal(linux.mac, undefined);
    assert.deepStrictEqual(linux.asarUnpack, [
      "node_modules/node-pty/**",
      ...AI_DETECTOR_ASAR_UNPACK_GLOBS,
    ]);
    assert.deepStrictEqual(linux.linux, {
      target: ["AppImage"],
      executableName: "synara",
      icon: "icon.png",
      category: "Development",
      desktop: {
        entry: {
          StartupWMClass: "synara",
        },
      },
    });

    assert.equal(win.mac, undefined);
    assert.deepStrictEqual(win.asarUnpack, [
      "node_modules/node-pty/**",
      ...AI_DETECTOR_ASAR_UNPACK_GLOBS,
    ]);
    assert.equal(WINDOWS_INSTALLER_GUID, "368107a8-afe6-5db5-ab3b-d4f331684868");
    assert.deepStrictEqual(win.nsis, {
      guid: WINDOWS_INSTALLER_GUID,
      deleteAppDataOnUninstall: false,
    });
    assert.deepStrictEqual(win.win, {
      target: ["nsis"],
      icon: "icon.ico",
      azureSignOptions: { publisherName: "Synara" },
    });
  });

  it("keeps Windows signing optional", () => {
    const config = createDesktopPlatformBuildConfig({
      platform: "win",
      target: "nsis",
    });

    assert.deepStrictEqual(config.win, {
      target: ["nsis"],
      icon: "icon.ico",
    });
  });

  it("keeps node-pty unpacked from ASAR in generated build config", () => {
    const config = createDesktopPlatformBuildConfig({
      platform: "linux",
      target: "AppImage",
    });

    assert.deepStrictEqual([...NODE_PTY_ASAR_UNPACK_GLOBS], ["node_modules/node-pty/**"]);
    assert.deepStrictEqual(config.asarUnpack, [
      ...NODE_PTY_ASAR_UNPACK_GLOBS,
      ...AI_DETECTOR_ASAR_UNPACK_GLOBS,
    ]);
  });

  it("blocks unsupported or non-matching Linux native build hosts", () => {
    assert.equal(
      validateDesktopNativeBuildHost({
        platform: "linux",
        arch: "x64",
        hostPlatform: "linux",
        hostArch: "x64",
      }),
      null,
    );

    assert.equal(
      validateDesktopNativeBuildHost({
        platform: "linux",
        arch: "universal",
        hostPlatform: "linux",
        hostArch: "x64",
      }),
      "Linux desktop artifacts support x64 or arm64 builds, not universal builds.",
    );

    const issue = validateDesktopNativeBuildHost({
      platform: "linux",
      arch: "x64",
      hostPlatform: "darwin",
      hostArch: "arm64",
    });

    assert.ok(issue?.includes("Build linux/x64 on a matching Linux host"));
  });

  it("keeps separate macOS sources for solid and rounded icons", () => {
    assert.equal(BRAND_ASSET_PATHS.productionMacIconPng, "assets/prod/djl-macos-1024.png");
    assert.equal(
      BRAND_ASSET_PATHS.productionMacLegacyIconPng,
      "assets/prod/djl-macos-legacy-1024.png",
    );
    assert.equal(BRAND_ASSET_PATHS.productionLinuxIconPng, "assets/prod/djl-universal-1024.png");
    assert.equal(BRAND_ASSET_PATHS.productionWindowsIconIco, "assets/prod/djl-windows.ico");
    assert.equal(BRAND_ASSET_PATHS.productionWebFaviconIco, "assets/prod/djl-web-favicon.ico");
    assert.equal(MICROPHONE_USAGE_DESCRIPTION.startsWith("DJL needs"), true);
  });
});
