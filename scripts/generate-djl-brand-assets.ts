// FILE: generate-djl-brand-assets.ts
// Purpose: Derives every DJL web, desktop, and iOS icon from the supplied canonical raster artwork.
// Layer: Build tooling

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROD_DIR = join(REPO_ROOT, "assets/prod");
const WEB_PUBLIC_DIR = join(REPO_ROOT, "apps/web/public");
const DESKTOP_RESOURCES_DIR = join(REPO_ROOT, "apps/desktop/resources");
const IOS_ASSETS_DIR = join(REPO_ROOT, "apps/ios/DJL/Assets.xcassets");
const IOS_APP_ICON_DIR = join(IOS_ASSETS_DIR, "AppIcon.appiconset");
const IOS_APP_LOGO_DIR = join(IOS_ASSETS_DIR, "AppLogo.imageset");

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function renderPng(sourceImage: string, size: number, outputPath: string): void {
  run("magick", [
    sourceImage,
    "-background",
    "none",
    "-resize",
    `${size}x${size}`,
    "-depth",
    "8",
    outputPath,
  ]);
}

function generateIcns(sourceImage: string, outputPath: string): void {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "djl-icon-"));
  const iconsetDir = join(temporaryRoot, "icon.iconset");
  mkdirSync(iconsetDir);

  try {
    for (const size of [16, 32, 128, 256, 512]) {
      renderPng(sourceImage, size, join(iconsetDir, `icon_${size}x${size}.png`));
      renderPng(sourceImage, size * 2, join(iconsetDir, `icon_${size}x${size}@2x.png`));
    }
    run("iconutil", ["-c", "icns", iconsetDir, "-o", outputPath]);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

mkdirSync(PROD_DIR, { recursive: true });
mkdirSync(WEB_PUBLIC_DIR, { recursive: true });
mkdirSync(DESKTOP_RESOURCES_DIR, { recursive: true });
mkdirSync(IOS_APP_ICON_DIR, { recursive: true });
mkdirSync(IOS_APP_LOGO_DIR, { recursive: true });

const canonicalSourcePath = join(PROD_DIR, "djl-logo-source.png");
const normalizedLogoPath = join(PROD_DIR, "djl-logo.png");
const macIconPath = join(PROD_DIR, "djl-macos-1024.png");
const macLegacyIconPath = join(PROD_DIR, "djl-macos-legacy-1024.png");
const universalIconPath = join(PROD_DIR, "djl-universal-1024.png");
const windowsIconPath = join(PROD_DIR, "djl-windows.ico");
const webFaviconPath = join(PROD_DIR, "djl-web-favicon.ico");
const webFavicon16Path = join(PROD_DIR, "djl-web-favicon-16x16.png");
const webFavicon32Path = join(PROD_DIR, "djl-web-favicon-32x32.png");
const webTouchIconPath = join(PROD_DIR, "djl-web-apple-touch-180.png");

if (!existsSync(canonicalSourcePath)) {
  throw new Error(`Canonical DJL logo source is missing at ${canonicalSourcePath}`);
}

run("magick", [
  canonicalSourcePath,
  "-trim",
  "+repage",
  "-resize",
  "800x800",
  "-gravity",
  "center",
  "-background",
  "none",
  "-extent",
  "1024x1024",
  "-depth",
  "8",
  normalizedLogoPath,
]);

run("magick", [
  "-size",
  "1024x1024",
  "canvas:none",
  "-fill",
  "#f4f4f2",
  "-draw",
  "roundrectangle 64,64 960,960 224,224",
  normalizedLogoPath,
  "-gravity",
  "center",
  "-compose",
  "over",
  "-composite",
  "-depth",
  "8",
  universalIconPath,
]);

copyFileSync(universalIconPath, macIconPath);
copyFileSync(universalIconPath, macLegacyIconPath);
renderPng(universalIconPath, 16, webFavicon16Path);
renderPng(universalIconPath, 32, webFavicon32Path);
renderPng(universalIconPath, 180, webTouchIconPath);
run("magick", [
  universalIconPath,
  "-background",
  "none",
  "-define",
  "icon:auto-resize=256,128,64,48,32,16",
  windowsIconPath,
]);
copyFileSync(windowsIconPath, webFaviconPath);

copyFileSync(webFaviconPath, join(WEB_PUBLIC_DIR, "favicon.ico"));
copyFileSync(webFavicon16Path, join(WEB_PUBLIC_DIR, "favicon-16x16.png"));
copyFileSync(webFavicon32Path, join(WEB_PUBLIC_DIR, "favicon-32x32.png"));
copyFileSync(webTouchIconPath, join(WEB_PUBLIC_DIR, "apple-touch-icon.png"));
copyFileSync(normalizedLogoPath, join(WEB_PUBLIC_DIR, "djl-logo.png"));
copyFileSync(universalIconPath, join(DESKTOP_RESOURCES_DIR, "icon.png"));
copyFileSync(universalIconPath, join(DESKTOP_RESOURCES_DIR, "dock-icon.png"));
copyFileSync(windowsIconPath, join(DESKTOP_RESOURCES_DIR, "icon.ico"));
generateIcns(universalIconPath, join(DESKTOP_RESOURCES_DIR, "icon.icns"));

// iOS supplies its own rounded mask, so flatten the shared desktop artwork
// onto the canonical light background to satisfy the opaque App Store icon
// requirement without changing the visible DJL mark.
run("magick", [
  universalIconPath,
  "-background",
  "#f4f4f2",
  "-alpha",
  "remove",
  "-alpha",
  "off",
  "-depth",
  "8",
  join(IOS_APP_ICON_DIR, "djl-app-icon-1024.png"),
]);
copyFileSync(normalizedLogoPath, join(IOS_APP_LOGO_DIR, "djl-logo.png"));
