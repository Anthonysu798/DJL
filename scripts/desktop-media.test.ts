import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { DESKTOP_MEDIA_MANIFEST } from "./lib/desktop-media-manifest.ts";
import {
  findPackagedMediaRoots,
  resolveDesktopMediaTargets,
  verifyMediaArchitecture,
  verifyMediaDigest,
  verifyRedistributableMedia,
} from "./lib/desktop-media.ts";

it("pins every supported desktop media archive, payload and retained notice", () => {
  expect(resolveDesktopMediaTargets("mac", "universal")).toEqual(["darwin-arm64", "darwin-x64"]);
  expect(resolveDesktopMediaTargets("win", "x64")).toEqual(["win32-x64"]);
  expect(resolveDesktopMediaTargets("linux", "x64")).toEqual([]);
  expect(() => resolveDesktopMediaTargets("win", "arm64")).toThrow("No verified media");
  for (const manifest of Object.values(DESKTOP_MEDIA_MANIFEST)) {
    for (const name of ["ffmpeg", "ffprobe", "license", "buildInfo"] as const) {
      const asset = manifest[name];
      expect(asset.url).toMatch(/^https:\/\//);
      expect(asset.url).not.toMatch(/latest|redirect/);
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      if (asset.archiveEntry) expect(asset.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  }
});

it("reads executable bytes instead of trusting architecture in a path", () => {
  const arm = Buffer.alloc(64);
  arm.writeUInt32LE(0xfeedfacf, 0);
  arm.writeUInt32LE(0x0100000c, 4);
  expect(() => verifyMediaArchitecture(arm, "darwin-arm64")).not.toThrow();
  expect(() => verifyMediaArchitecture(arm, "darwin-x64")).toThrow("not darwin-x64");
  const pe = Buffer.alloc(128);
  pe.write("MZ");
  pe.writeUInt32LE(64, 60);
  pe.writeUInt32LE(0x00004550, 64);
  pe.writeUInt16LE(0x8664, 68);
  expect(() => verifyMediaArchitecture(pe, "win32-x64")).not.toThrow();
  pe.writeUInt16LE(0xaa64, 68);
  expect(() => verifyMediaArchitecture(pe, "win32-x64")).toThrow();
  expect(() =>
    verifyMediaArchitecture(Buffer.from("/some/arm64/ffmpeg"), "darwin-arm64"),
  ).toThrow();
});

it("rejects a changed download or a nonredistributable runtime", () => {
  const expected = createHash("sha256").update("pinned").digest("hex");
  expect(() => verifyMediaDigest(Buffer.from("pinned"), expected, "fixture")).not.toThrow();
  expect(() => verifyMediaDigest(Buffer.from("changed"), expected, "fixture")).toThrow(
    "integrity mismatch",
  );
  expect(() =>
    verifyRedistributableMedia(
      "ffmpeg version 9.0.2 Copyright",
      "GNU General Public License",
      "9.0.2",
    ),
  ).not.toThrow();
  expect(() =>
    verifyRedistributableMedia(
      "ffmpeg version 9.0.2 Copyright --enable-nonfree",
      "GNU General Public License",
      "9.0.2",
    ),
  ).toThrow("cannot be redistributed");
  expect(() =>
    verifyRedistributableMedia(
      "ffmpeg version 9.0.2 Copyright",
      "This version is not legally redistributable.",
      "9.0.2",
    ),
  ).toThrow();
  expect(() =>
    verifyRedistributableMedia(
      "ffmpeg version 6.0 Copyright",
      "GNU General Public License",
      "9.0.2",
    ),
  ).toThrow("version");
});

it("locates actual resources in both platform packaging layouts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "djl-media-layout-"));
  try {
    const windows = path.join(root, "win-unpacked", "resources", "media");
    const mac = path.join(root, "mac-arm64", "DJL.app", "Contents", "Resources", "media");
    await mkdir(windows, { recursive: true });
    await mkdir(mac, { recursive: true });
    expect(findPackagedMediaRoots(root).toSorted()).toEqual([windows, mac].toSorted());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("runs package media verification in the shared build and CI path", async () => {
  const [build, ci, mac] = await Promise.all([
    readFile(new URL("./build-desktop-artifact.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/desktop-ci.yml", import.meta.url), "utf8"),
    readFile(new URL("./verify-macos-app-bundle.sh", import.meta.url), "utf8"),
  ]);
  expect(build).toContain("stageDesktopMedia({");
  expect(build).toContain("smokeDesktopMedia(roots[0]!, target)");
  expect(build).toContain('to: "media"');
  expect(ci).toContain("Verify pinned native media tools");
  expect(ci).toContain("desktop-media.test.ts");
  expect(mac).toContain('--verify --packaged --platform mac --arch "$arch"');
});
