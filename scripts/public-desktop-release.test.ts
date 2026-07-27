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
      metadata.find((asset) => asset.name === "djl.yml")?.contents,
    );
    const sums = Buffer.from(
      metadata.find((asset) => asset.name === "SHA256SUMS")?.contents ?? [],
    ).toString("utf8");
    assert.equal(sums.trim().split("\n").length, 12);
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

  it("validates GitHub-reported names, sizes, and digests for exactly 13 assets", () => {
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

  it("keeps the release skill truthful about the shipping workflow", () => {
    // The skill is what an agent reads before shipping. It drifted once to a 15-asset inventory and
    // a `gh workflow run desktop-release.yml` dispatch that cannot work, because the release
    // triggers only on a tag push. Pin the claims that would misdirect a release.
    const skill = readFileSync(
      resolve(REPOSITORY_ROOT, "docs/skills/djl-desktop-release/SKILL.md"),
      "utf8",
    );
    const setup = readFileSync(
      resolve(REPOSITORY_ROOT, "docs/skills/djl-desktop-release/references/platform-setup.md"),
      "utf8",
    );
    const assetCount = publishedPublicDesktopReleaseAssetNames(VERSION).length;

    assert.match(skill, new RegExp(`exactly \\*\\*${assetCount}\\*\\* assets`));
    assert.match(skill, new RegExp(`${assetCount}-asset inventory verification`));
    assert.match(skill, /bun run ship/);
    assert.match(setup, /`desktop-ci`/);
    assert.match(setup, /`v\*` \(tag\)/);
    // A dispatch command for the release workflow is always wrong: it has no workflow_dispatch.
    assert.equal(skill.includes("gh workflow run desktop-release.yml"), false);
  });

  it("preserves markdown headings in the release notes it writes into the tag", () => {
    const shipScript = readFileSync(resolve(REPOSITORY_ROOT, "scripts/ship-release.ts"), "utf8");

    // git treats '#' lines in a tag message as comments and drops them. Release notes are markdown,
    // so without --cleanup=verbatim every '### Added' heading disappears from the published body.
    assert.match(shipScript, /"tag",\s*"-a",\s*"--cleanup=verbatim"/);
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
    const setupAction = readFileSync(
      resolve(REPOSITORY_ROOT, ".github/actions/setup-desktop/action.yml"),
      "utf8",
    );
    const landingWorkflow = readFileSync(
      resolve(REPOSITORY_ROOT, ".github/workflows/landing-deploy.yml"),
      "utf8",
    );
    const workflows = readdirSync(resolve(REPOSITORY_ROOT, ".github/workflows")).toSorted();
    assert.deepStrictEqual(workflows, [
      "desktop-ci.yml",
      "desktop-release.yml",
      "desktop-signed-update-e2e.yml",
      "landing-deploy.yml",
    ]);

    // The landing mirror deploys the marketing site only. It must never grow into a second desktop
    // pipeline, never run for fork pull requests, and never hold write access to this repository.
    assert.match(landingWorkflow, /paths:\n      - "apps\/landing\/\*\*"/);
    assert.match(landingWorkflow, /permissions:\n  contents: read/);
    assert.match(landingWorkflow, /persist-credentials: false/);
    assert.equal(landingWorkflow.includes("pull_request"), false);
    assert.equal(landingWorkflow.includes("build:desktop"), false);
    assert.equal(landingWorkflow.includes("dist:desktop:artifact"), false);

    assert.match(ciWorkflow, /pull_request:/);
    assert.match(ciWorkflow, /push:\n    branches:\n      - main/);
    assert.match(ciWorkflow, /workflow_dispatch:/);
    assert.match(
      ciWorkflow,
      /if: github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(ciWorkflow, /quality:\n    name: Quality/);
    assert.match(ciWorkflow, /desktop-tests:\n    name: Desktop unit and contract tests/);
    assert.match(ciWorkflow, /renderer-tests:\n    name: Chromium renderer tests/);
    assert.match(
      ciWorkflow,
      /release-audit:\n    name: Release, security, and public-source audits/,
    );
    assert.match(ciWorkflow, /runtime-smoke:\n    name: Desktop runtime smoke/);
    assert.match(
      ciWorkflow,
      /desktop-ci:\n    name: desktop-ci\n    if: always\(\)\n    needs:[\s\S]*- runtime-smoke/,
    );
    assert.match(ciWorkflow, /package-smoke:[\s\S]*needs: desktop-ci/);
    assert.equal(ciWorkflow.includes("secrets."), false);
    assert.equal(ciWorkflow.includes("pull_request_target"), false);
    assert.match(ciWorkflow, /cancel-in-progress: true/);
    assert.match(setupAction, /bun install --frozen-lockfile/);
    assert.match(
      setupAction,
      /key: bun-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-\$\{\{ hashFiles\('bun\.lock', 'package\.json'\) \}\}/,
    );
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
    assert.match(releaseWorkflow, /push:\n    tags:\n      - "v\*\.\*\.\*"/);
    assert.equal(releaseWorkflow.includes("workflow_dispatch:"), false);
    assert.match(releaseWorkflow, /Release tag \$RELEASE_TAG must be annotated/);
    assert.match(releaseWorkflow, /refs\/tags\/\$RELEASE_TAG\^\{\}/);
    assert.match(releaseWorkflow, /Tagged commit \$RELEASE_COMMIT is not contained in main/);
    assert.match(releaseWorkflow, /generate_release_notes: true/);
    assert.match(releaseWorkflow, /cancel-in-progress: false/);
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
    // The bundle contract now lives in one script that both the release build and the CI package
    // smoke run, so a check can never exist in the release path alone and go unproven until a real
    // release pays for signing and notarization to discover it.
    const bundleVerifier = readFileSync(
      resolve(REPOSITORY_ROOT, "scripts/verify-macos-app-bundle.sh"),
      "utf8",
    );
    assert.match(releaseWorkflow, /scripts\/verify-macos-app-bundle\.sh "\$app"/);
    assert.match(ciWorkflow, /scripts\/verify-macos-app-bundle\.sh "\$mount_point\/DJL\.app"/);
    assert.match(bundleVerifier, /onnxruntime-node\/package\.json/);
    assert.match(bundleVerifier, /app-update\.yml/);
    // file -b, never file: the path must not be able to satisfy an architecture match.
    assert.match(bundleVerifier, /file -b/);
    assert.equal(/\bfile "\$/.test(bundleVerifier), false);
    assert.match(releaseWorkflow, /This exact commit has no successful full Desktop CI run/);
    assert.match(releaseWorkflow, /The canonical main branch must be protected/);
    assert.match(releaseWorkflow, /Verify exact 13-asset draft inventory/);
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
      releaseWorkflow.indexOf("Verify exact 13-asset draft inventory") <
        releaseWorkflow.indexOf("environment: production"),
    );

    for (const workflow of [ciWorkflow, releaseWorkflow, setupAction]) {
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

  it("keeps the signed updater E2E build protected and non-publishing", () => {
    const workflow = readFileSync(
      resolve(REPOSITORY_ROOT, ".github/workflows/desktop-signed-update-e2e.yml"),
      "utf8",
    );

    assert.match(workflow, /workflow_dispatch:/);
    assert.equal(workflow.includes("pull_request:"), false);
    assert.equal(workflow.includes("push:"), false);
    assert.match(workflow, /permissions:\n  contents: read/);
    assert.match(workflow, /environment: production/);
    assert.match(
      workflow,
      /if: github\.repository == 'Anthonysu798\/DJL' && github\.ref == 'refs\/heads\/main'/,
    );
    assert.match(workflow, /baseline_version:[\s\S]*required: true/);
    assert.match(workflow, /target_version:[\s\S]*required: true/);
    assert.match(workflow, /RELEASE_REPOSITORY: Anthonysu798\/DJL/);
    assert.match(workflow, /SYNARA_DESKTOP_UPDATE_REPOSITORY: Anthonysu798\/DJL/);
    assert.match(workflow, /repos\/\$RELEASE_REPOSITORY\/releases\/latest/);
    assert.match(workflow, /compareReleaseVersions/);
    assert.match(workflow, /--target dmg --arch arm64/);
    assert.match(workflow, /--build-version "\$BASELINE_VERSION"/);
    assert.match(workflow, /--signed/);
    assert.match(workflow, /Developer ID Application:.*U76N9JSK4M/);
    assert.match(workflow, /TeamIdentifier=U76N9JSK4M/);
    assert.match(workflow, /xcrun stapler validate "\$dmg"/);
    assert.match(
      workflow,
      /spctl --assess --type open --context context:primary-signature -v "\$dmg"/,
    );
    assert.match(workflow, /scripts\/verify-macos-app-bundle\.sh "\$app"/);
    assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
    assert.match(workflow, /retention-days: 1/);

    const actionReferences = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s]+)/g)].map(
      (match) => match[1],
    );
    assert.ok(actionReferences.length > 0);
    for (const reference of actionReferences) assert.match(reference!, /^[a-f0-9]{40}$/);

    for (const secret of [
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
      "APPLE_API_KEY",
      "APPLE_API_KEY_ID",
      "APPLE_API_ISSUER",
    ]) {
      assert.match(workflow, new RegExp(`secrets\\.${secret}`));
    }
    for (const forbidden of [
      "contents: write",
      "gh release create",
      "gh release upload",
      "git tag",
      "downloads.slcor.com",
      "publish-desktop-release",
    ]) {
      assert.equal(workflow.includes(forbidden), false);
    }
  });
});
