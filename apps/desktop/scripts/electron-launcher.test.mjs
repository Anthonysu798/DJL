import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import * as launcher from "./electron-launcher.mjs";

const temporaryDirectories = [];

function createIconFixture(contents) {
  const directory = mkdtempSync(join(tmpdir(), "djl-electron-launcher-"));
  temporaryDirectories.push(directory);
  const iconPath = join(directory, "icon.icns");
  writeFileSync(iconPath, contents);
  return iconPath;
}

function requireMetadataBuilder() {
  expect(launcher.buildMacLauncherMetadata).toBeTypeOf("function");
  return launcher.buildMacLauncherMetadata;
}

function metadataInput(iconPath) {
  return {
    appBundleId: "com.example.djl.dev",
    appDisplayName: "DJL (Dev)",
    iconPath,
    microphoneUsageDescription: "DJL needs microphone access.",
    sourceAppBundlePath: "/Applications/Electron.app",
    sourceAppMtimeMs: 1234,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("macOS Electron launcher cache metadata", () => {
  it("invalidates when the branded application identity changes", () => {
    const buildMetadata = requireMetadataBuilder();
    if (typeof buildMetadata !== "function") return;
    const iconPath = createIconFixture("djl-icon");
    const input = metadataInput(iconPath);

    const djlMetadata = buildMetadata(input);

    expect(
      buildMetadata({
        ...input,
        appDisplayName: "Synara (Dev)",
      }),
    ).not.toEqual(djlMetadata);
    expect(
      buildMetadata({
        ...input,
        appBundleId: "com.example.synara.dev",
      }),
    ).not.toEqual(djlMetadata);
  });

  it("invalidates when icon bytes change without an mtime change", () => {
    const buildMetadata = requireMetadataBuilder();
    if (typeof buildMetadata !== "function") return;
    const iconPath = createIconFixture("old-synara-icon");
    const input = metadataInput(iconPath);
    const originalTimes = statSync(iconPath);

    const oldMetadata = buildMetadata(input);
    writeFileSync(iconPath, "new-djl-icon");
    utimesSync(iconPath, originalTimes.atime, originalTimes.mtime);

    expect(buildMetadata(input)).not.toEqual(oldMetadata);
  });
});
