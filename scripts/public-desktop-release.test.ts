import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "@effect/vitest";

import {
  createPublicDesktopReleaseReceipt,
  preparePublicDesktopReleaseAssets,
  preparePublicDesktopReleaseMetadata,
  PUBLIC_DESKTOP_RELEASE_REPOSITORY,
  publishedPublicDesktopReleaseAssetNames,
  type PublicDesktopReleaseReceipt,
  type PublicDesktopReleaseAsset,
  validatePublicDesktopReleaseRemoteAssets,
  validatePublicDesktopReleaseVersion,
} from "./lib/public-desktop-release.ts";
import { preparePublicDesktopReleaseDirectory } from "./prepare-public-desktop-release.ts";

const VERSION = "1.2.3";
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function manifest(version: string, payloads: readonly PublicDesktopReleaseAsset[]): Uint8Array {
  const files = payloads.flatMap((payload) => [
    `  - url: ${payload.name}`,
    `    sha512: ${createHash("sha512").update(payload.contents).digest("base64")}`,
    `    size: ${payload.contents.byteLength}`,
  ]);
  return Buffer.from(
    [`version: ${version}`, "files:", ...files, "releaseDate: '2026-07-22T12:00:00.000Z'", ""].join(
      "\n",
    ),
  );
}

function completeFixture(version = VERSION): PublicDesktopReleaseAsset[] {
  const payload = (name: string): PublicDesktopReleaseAsset => ({
    name,
    contents: Buffer.from(`contents:${name}`),
  });
  const armZip = payload(`DJL-${version}-arm64.zip`);
  const armDmg = payload(`DJL-${version}-arm64.dmg`);
  const x64Zip = payload(`DJL-${version}-x64.zip`);
  const x64Dmg = payload(`DJL-${version}-x64.dmg`);
  const windows = payload(`DJL-${version}-x64.exe`);
  return [
    armDmg,
    payload(`${armDmg.name}.blockmap`),
    armZip,
    x64Dmg,
    payload(`${x64Dmg.name}.blockmap`),
    x64Zip,
    windows,
    payload(`${windows.name}.blockmap`),
    { name: "latest-mac-arm64.yml", contents: manifest(version, [armZip, armDmg]) },
    { name: "latest-mac-x64.yml", contents: manifest(version, [x64Zip, x64Dmg]) },
    { name: "latest.yml", contents: manifest(version, [windows]) },
  ];
}

function receiptFixture(version = VERSION): {
  receipts: PublicDesktopReleaseReceipt[];
  manifests: PublicDesktopReleaseAsset[];
} {
  const assets = completeFixture(version);
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const select = (...names: string[]): PublicDesktopReleaseAsset[] =>
    names.map((name) => {
      const asset = byName.get(name);
      if (!asset) throw new Error(`Missing fixture asset ${name}.`);
      return asset;
    });
  return {
    receipts: [
      createPublicDesktopReleaseReceipt(
        version,
        "mac",
        "arm64",
        select(
          `DJL-${version}-arm64.dmg`,
          `DJL-${version}-arm64.dmg.blockmap`,
          `DJL-${version}-arm64.zip`,
        ),
      ),
      createPublicDesktopReleaseReceipt(
        version,
        "mac",
        "x64",
        select(
          `DJL-${version}-x64.dmg`,
          `DJL-${version}-x64.dmg.blockmap`,
          `DJL-${version}-x64.zip`,
        ),
      ),
      createPublicDesktopReleaseReceipt(
        version,
        "win",
        "x64",
        select(`DJL-${version}-x64.exe`, `DJL-${version}-x64.exe.blockmap`),
      ),
    ],
    manifests: select("latest-mac-arm64.yml", "latest-mac-x64.yml", "latest.yml"),
  };
}

describe("public desktop release preparation", () => {
  it("validates stable and prerelease semantic versions", () => {
    assert.deepStrictEqual(validatePublicDesktopReleaseVersion("1.2.3"), {
      version: "1.2.3",
      tag: "v1.2.3",
      isPrerelease: false,
    });
    assert.equal(validatePublicDesktopReleaseVersion("1.2.3-rc.1").isPrerelease, true);
    for (const invalid of ["v1.2.3", "1.2", "01.2.3", "1.2.3-01", "1.2.3+build"]) {
      assert.throws(() => validatePublicDesktopReleaseVersion(invalid), /Invalid release version/);
    }
  });

  it("prepares the complete payload, manifest aliases, and checksums", () => {
    const prepared = preparePublicDesktopReleaseAssets(VERSION, completeFixture());
    assert.deepStrictEqual(
      prepared.map((asset) => asset.name),
      publishedPublicDesktopReleaseAssetNames(VERSION),
    );
    const latestMac = Buffer.from(
      prepared.find((asset) => asset.name === "latest-mac.yml")?.contents ?? [],
    ).toString("utf8");
    assert.match(latestMac, /DJL-1\.2\.3-arm64\.zip/);
    assert.match(latestMac, /DJL-1\.2\.3-x64\.zip/);
    assert.deepStrictEqual(
      prepared.find((asset) => asset.name === "latest-mac.yml")?.contents,
      prepared.find((asset) => asset.name === "djl-mac.yml")?.contents,
    );
    assert.deepStrictEqual(
      prepared.find((asset) => asset.name === "latest.yml")?.contents,
      prepared.find((asset) => asset.name === "djl.yml")?.contents,
    );
    assert.deepStrictEqual(
      prepared.find((asset) => asset.name === "djl-mac.yml")?.contents,
      prepared.find((asset) => asset.name === "synara-mac.yml")?.contents,
    );
    assert.deepStrictEqual(
      prepared.find((asset) => asset.name === "djl.yml")?.contents,
      prepared.find((asset) => asset.name === "synara.yml")?.contents,
    );
    const sums = Buffer.from(
      prepared.find((asset) => asset.name === "SHA256SUMS")?.contents ?? [],
    ).toString("utf8");
    assert.equal(sums.trim().split("\n").length, prepared.length - 1);
    assert.match(sums, /  latest-mac\.yml/);
  });

  it("finalizes metadata from small receipts without transferring installer bytes", () => {
    const { receipts, manifests } = receiptFixture();
    const metadata = preparePublicDesktopReleaseMetadata(VERSION, receipts, manifests);
    const uploadedNames = [
      ...receipts.flatMap((receipt) => receipt.assets.map((asset) => asset.name)),
      ...metadata.map((asset) => asset.name),
    ].toSorted();

    assert.equal(PUBLIC_DESKTOP_RELEASE_REPOSITORY, "Anthonysu798/DJL");
    assert.deepStrictEqual(uploadedNames, publishedPublicDesktopReleaseAssetNames(VERSION));
    assert.deepStrictEqual(
      metadata.find((asset) => asset.name === "latest-mac.yml")?.contents,
      metadata.find((asset) => asset.name === "djl-mac.yml")?.contents,
    );
    assert.deepStrictEqual(
      metadata.find((asset) => asset.name === "latest.yml")?.contents,
      metadata.find((asset) => asset.name === "synara.yml")?.contents,
    );
    const sums = Buffer.from(
      metadata.find((asset) => asset.name === "SHA256SUMS")?.contents ?? [],
    ).toString("utf8");
    assert.equal(sums.trim().split("\n").length, 14);
    assert.match(sums, /^[a-f0-9]{64}  DJL-1\.2\.3-arm64\.dmg$/m);
  });

  it("rejects malformed, duplicate, and incomplete receipts", () => {
    const { receipts, manifests } = receiptFixture();
    const malformed = structuredClone(receipts);
    const firstAsset = malformed[0]?.assets[0];
    if (!firstAsset) throw new Error("Fixture receipt is incomplete.");
    (firstAsset as { sha256: string }).sha256 = firstAsset.sha256.toUpperCase();
    assert.throws(
      () => preparePublicDesktopReleaseMetadata(VERSION, malformed, manifests),
      /lowercase SHA-256/,
    );
    assert.throws(
      () =>
        preparePublicDesktopReleaseMetadata(
          VERSION,
          [receipts[0]!, receipts[0]!, receipts[2]!],
          manifests,
        ),
      /Duplicate release receipt/,
    );
    assert.throws(
      () => preparePublicDesktopReleaseMetadata(VERSION, receipts.slice(1), manifests),
      /missing receipt: mac\/arm64/,
    );
  });

  it("rejects receipt and updater-manifest digest or size mismatches", () => {
    const { receipts, manifests } = receiptFixture();
    const mismatched = structuredClone(receipts);
    const zip = mismatched[0]?.assets.find((asset) => asset.name.endsWith("-arm64.zip"));
    if (!zip) throw new Error("Fixture receipt is missing its ARM64 ZIP.");
    (zip as { size: number }).size += 1;
    assert.throws(
      () => preparePublicDesktopReleaseMetadata(VERSION, mismatched, manifests),
      /metadata does not match DJL-1\.2\.3-arm64\.zip/,
    );
  });

  it("validates GitHub-reported names, sizes, and digests for exactly 15 assets", () => {
    const { receipts, manifests } = receiptFixture();
    const metadata = preparePublicDesktopReleaseMetadata(VERSION, receipts, manifests);
    const remoteAssets = [
      ...receipts.flatMap((receipt) =>
        receipt.assets.map((asset) => ({
          name: asset.name,
          size: asset.size,
          digest: `sha256:${asset.sha256}`,
        })),
      ),
      ...metadata.map((asset) => ({
        name: asset.name,
        size: asset.contents.byteLength,
        digest: `sha256:${createHash("sha256").update(asset.contents).digest("hex")}`,
      })),
    ];

    assert.doesNotThrow(() =>
      validatePublicDesktopReleaseRemoteAssets(VERSION, receipts, metadata, remoteAssets),
    );
    const wrongSize = structuredClone(remoteAssets);
    wrongSize[0]!.size += 1;
    assert.throws(
      () => validatePublicDesktopReleaseRemoteAssets(VERSION, receipts, metadata, wrongSize),
      /size mismatch/,
    );
    assert.throws(
      () =>
        validatePublicDesktopReleaseRemoteAssets(
          VERSION,
          receipts,
          metadata,
          remoteAssets.slice(1),
        ),
      /missing: DJL-1\.2\.3-arm64\.dmg/,
    );
  });

  it("rejects missing and duplicate assets", () => {
    const complete = completeFixture();
    assert.throws(
      () => preparePublicDesktopReleaseAssets(VERSION, complete.slice(1)),
      /missing: DJL-1\.2\.3-arm64\.dmg/,
    );
    assert.throws(
      () => preparePublicDesktopReleaseAssets(VERSION, [...complete, complete[0]!]),
      /Duplicate release assets/,
    );
  });

  it("rejects mismatched versions, references, and payload metadata", () => {
    const wrongVersion = completeFixture();
    wrongVersion[8] = {
      name: "latest-mac-arm64.yml",
      contents: manifest(
        "1.2.4",
        wrongVersion.slice(0, 3).filter((asset) => !asset.name.endsWith("blockmap")),
      ),
    };
    assert.throws(
      () => preparePublicDesktopReleaseAssets(VERSION, wrongVersion),
      /has version 1\.2\.4; expected 1\.2\.3/,
    );

    const wrongReference = completeFixture();
    wrongReference[10] = {
      name: "latest.yml",
      contents: Buffer.from(
        Buffer.from(wrongReference[10]!.contents)
          .toString("utf8")
          .replace("DJL-1.2.3-x64.exe", "DJL-1.2.3-arm64.exe"),
      ),
    };
    assert.throws(
      () => preparePublicDesktopReleaseAssets(VERSION, wrongReference),
      /missing: DJL-1\.2\.3-x64\.exe; unexpected: DJL-1\.2\.3-arm64\.exe/,
    );

    const wrongMetadata = completeFixture();
    wrongMetadata[6] = { ...wrongMetadata[6]!, contents: Buffer.from("changed") };
    assert.throws(
      () => preparePublicDesktopReleaseAssets(VERSION, wrongMetadata),
      /metadata does not match DJL-1\.2\.3-x64\.exe/,
    );
  });

  it("prepares a release directory in place only after complete validation", () => {
    const directory = mkdtempSync(join(tmpdir(), "djl-public-release-"));
    try {
      for (const asset of completeFixture()) {
        writeFileSync(resolve(directory, asset.name), asset.contents);
      }
      const prepared = preparePublicDesktopReleaseDirectory(VERSION, directory);
      assert.deepStrictEqual(prepared, publishedPublicDesktopReleaseAssetNames(VERSION));
      assert.deepStrictEqual(readdirSync(directory).toSorted(), prepared);
      assert.equal(readFileSync(resolve(directory, "latest-mac.yml")).byteLength > 0, true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps desktop CI and fail-closed production publication scoped and pinned", () => {
    const ciWorkflow = readFileSync(
      resolve(REPOSITORY_ROOT, ".github/workflows/desktop-ci.yml"),
      "utf8",
    );
    const releaseWorkflow = readFileSync(
      resolve(REPOSITORY_ROOT, ".github/workflows/desktop-release.yml"),
      "utf8",
    );
    const workflows = readdirSync(resolve(REPOSITORY_ROOT, ".github/workflows")).toSorted();
    assert.deepStrictEqual(workflows, ["desktop-ci.yml", "desktop-release.yml"]);

    assert.match(ciWorkflow, /pull_request:/);
    assert.match(ciWorkflow, /push:\n    branches:\n      - main/);
    assert.match(ciWorkflow, /workflow_dispatch:/);
    assert.match(ciWorkflow, /if: github\.event_name != 'pull_request'/);
    for (const runner of ["macos-14", "macos-15-intel", "windows-2022"]) {
      assert.match(ciWorkflow, new RegExp(`runner: ${runner}`));
      assert.match(releaseWorkflow, new RegExp(`runner: ${runner}`));
    }
    for (const command of [
      "ci:desktop:format",
      "ci:desktop:lint",
      "ci:desktop:typecheck",
      "ci:desktop:test",
      "ci:desktop:release-tests",
      "ci:desktop:browser",
      "ci:desktop:node-pty",
      "build:desktop",
      "ci:desktop:preload",
      "test:desktop-smoke",
      "ci:desktop:embedded-runtime",
    ]) {
      assert.match(ciWorkflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    assert.match(releaseWorkflow, /RELEASE_REPOSITORY: Anthonysu798\/DJL/);
    assert.match(
      releaseWorkflow,
      /workflow_dispatch:\n    inputs:\n      version:[\s\S]*required: true/,
    );
    assert.equal(releaseWorkflow.includes("pull_request_target"), false);
    assert.equal(releaseWorkflow.includes(["DJL", "RELEASES", "TOKEN"].join("_")), false);
    assert.match(releaseWorkflow, /permissions:\n  contents: read/);
    assert.match(releaseWorkflow, /persist-credentials: false/);
    assert.match(releaseWorkflow, /environment: production/);
    assert.match(releaseWorkflow, /retention-days: 1/);
    assert.match(releaseWorkflow, /gh release upload "\$RELEASE_TAG" "\$\{payloads\[@\]\}"/);
    assert.match(releaseWorkflow, /Get-AuthenticodeSignature/);
    assert.match(releaseWorkflow, /Status -ne "NotSigned"/);
    assert.match(releaseWorkflow, /xcrun stapler validate "\$dmg"/);
    assert.match(releaseWorkflow, /TeamIdentifier=U76N9JSK4M/);
    assert.match(releaseWorkflow, /onnxruntime-node\/package\.json/);
    assert.match(releaseWorkflow, /This exact commit has no successful full Desktop CI run/);
    assert.match(releaseWorkflow, /The canonical main branch must be protected/);
    assert.match(releaseWorkflow, /Verify exact 15-asset draft inventory/);
    assert.equal(releaseWorkflow.includes("gh release delete"), false);
    assert.equal(releaseWorkflow.includes("if: failure()"), false);

    assert.ok(
      releaseWorkflow.indexOf("Create draft before native builds") <
        releaseWorkflow.indexOf("Build native release"),
    );
    assert.ok(
      releaseWorkflow.indexOf("Upload large payloads directly to private draft") <
        releaseWorkflow.indexOf("Transfer one-day receipts and manifests"),
    );
    assert.ok(
      releaseWorkflow.indexOf("Upload checksum before updater manifests") <
        releaseWorkflow.indexOf("Upload updater manifests last"),
    );
    assert.ok(
      releaseWorkflow.indexOf("Verify exact 15-asset draft inventory") <
        releaseWorkflow.indexOf("environment: production"),
    );

    for (const workflow of [ciWorkflow, releaseWorkflow]) {
      const actionReferences = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s]+)/g)].map(
        (match) => match[1],
      );
      assert.ok(actionReferences.length > 0);
      for (const reference of actionReferences) assert.match(reference!, /^[a-f0-9]{40}$/);
      for (const forbidden of [
        "platform: linux",
        "AppImage",
        "apps/ios",
        "remote-relay",
        "apps/landing",
        "apps/marketing",
        "bun publish",
      ]) {
        assert.equal(workflow.includes(forbidden), false);
      }
    }
  });
});
