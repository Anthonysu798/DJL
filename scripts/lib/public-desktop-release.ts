// FILE: public-desktop-release.ts
// Purpose: Validates and prepares the exact public Windows/macOS desktop release asset set.

import { createHash } from "node:crypto";

export const PUBLIC_DESKTOP_RELEASE_REPOSITORY = "Anthonysu798/DJL";
export const PUBLIC_DESKTOP_UPDATE_CHANNEL = "djl";
// Temporary read-only aliases let already-shipped 0.5.1 clients reach the first DJL-channel
// release. Remove these aliases after that transition release has completed its migration window.
export const LEGACY_PUBLIC_DESKTOP_UPDATE_CHANNEL = "synara";

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export interface PublicDesktopReleaseVersion {
  readonly version: string;
  readonly tag: string;
  readonly isPrerelease: boolean;
}

export interface PublicDesktopReleaseAsset {
  readonly name: string;
  readonly contents: Uint8Array;
}

export type PublicDesktopReleasePlatform = "mac" | "win";
export type PublicDesktopReleaseArch = "arm64" | "x64";

export interface PublicDesktopReleaseReceiptAsset {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly sha512?: string;
}

export interface PublicDesktopReleaseReceipt {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly platform: PublicDesktopReleasePlatform;
  readonly arch: PublicDesktopReleaseArch;
  readonly assets: readonly PublicDesktopReleaseReceiptAsset[];
}

export interface PublicDesktopReleaseRemoteAsset {
  readonly name: string;
  readonly size: number;
  readonly digest: string;
}

interface UpdateManifestFile {
  readonly url: string;
  readonly sha512: string;
  readonly size: number;
  readonly blockMapSize?: number;
}

interface UpdateManifest {
  readonly version: string;
  readonly files: ReadonlyArray<UpdateManifestFile>;
  readonly releaseDate: string;
  readonly extras: Readonly<Record<string, string>>;
}

interface MutableUpdateManifestFile {
  url?: string;
  sha512?: string;
  size?: number;
  blockMapSize?: number;
}

export function validatePublicDesktopReleaseVersion(
  rawVersion: string,
): PublicDesktopReleaseVersion {
  const version = rawVersion.trim();
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(
      `Invalid release version '${rawVersion}'. Expected X.Y.Z or X.Y.Z-prerelease syntax.`,
    );
  }
  return {
    version,
    tag: `v${version}`,
    isPrerelease: match[4] !== undefined,
  };
}

export function sourcePublicDesktopReleaseAssetNames(version: string): readonly string[] {
  validatePublicDesktopReleaseVersion(version);
  return [
    `DJL-${version}-arm64.dmg`,
    `DJL-${version}-arm64.dmg.blockmap`,
    `DJL-${version}-arm64.zip`,
    `DJL-${version}-x64.dmg`,
    `DJL-${version}-x64.dmg.blockmap`,
    `DJL-${version}-x64.zip`,
    `DJL-${version}-x64.exe`,
    `DJL-${version}-x64.exe.blockmap`,
    "latest-mac-arm64.yml",
    "latest-mac-x64.yml",
    "latest.yml",
  ];
}

export function publishedPublicDesktopReleaseAssetNames(version: string): readonly string[] {
  return [
    ...sourcePublicDesktopReleaseAssetNames(version).filter((name) => !name.startsWith("latest")),
    "latest-mac.yml",
    "latest.yml",
    `${PUBLIC_DESKTOP_UPDATE_CHANNEL}-mac.yml`,
    `${PUBLIC_DESKTOP_UPDATE_CHANNEL}.yml`,
    `${LEGACY_PUBLIC_DESKTOP_UPDATE_CHANNEL}-mac.yml`,
    `${LEGACY_PUBLIC_DESKTOP_UPDATE_CHANNEL}.yml`,
    "SHA256SUMS",
  ].toSorted();
}

export function publicDesktopReleaseReceiptAssetNames(
  version: string,
  platform: PublicDesktopReleasePlatform,
  arch: PublicDesktopReleaseArch,
): readonly string[] {
  if (platform === "mac") {
    return [
      `DJL-${version}-${arch}.dmg`,
      `DJL-${version}-${arch}.dmg.blockmap`,
      `DJL-${version}-${arch}.zip`,
    ];
  }
  if (arch !== "x64") {
    throw new Error("Invalid release receipt lane win/arm64.");
  }
  return [`DJL-${version}-x64.exe`, `DJL-${version}-x64.exe.blockmap`];
}

function decodeYamlScalar(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }
  return value;
}

function quoteYamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parsePositiveInteger(raw: string, label: string, sourceName: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid ${label} in ${sourceName}: expected a non-negative integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid ${label} in ${sourceName}: value is not a safe integer.`);
  }
  return value;
}

function parseUpdateManifest(raw: string, sourceName: string): UpdateManifest {
  const lines = raw.split(/\r?\n/);
  const files: UpdateManifestFile[] = [];
  const extras: Record<string, string> = {};
  let version: string | undefined;
  let releaseDate: string | undefined;
  let inFiles = false;
  let currentFile: MutableUpdateManifestFile | undefined;

  const finishFile = (lineNumber: number) => {
    if (!currentFile) return;
    if (
      typeof currentFile.url !== "string" ||
      typeof currentFile.sha512 !== "string" ||
      typeof currentFile.size !== "number"
    ) {
      throw new Error(
        `Invalid updater manifest ${sourceName}:${lineNumber}: incomplete file entry.`,
      );
    }
    files.push(currentFile as UpdateManifestFile);
    currentFile = undefined;
  };

  for (const [index, originalLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = originalLine.trimEnd();
    if (line.length === 0) continue;

    if (line === "files:") {
      if (inFiles) {
        throw new Error(`Invalid updater manifest ${sourceName}:${lineNumber}: duplicate files.`);
      }
      inFiles = true;
      continue;
    }

    const fileStart = line.match(/^  - url:\s*(.+)$/);
    if (fileStart?.[1]) {
      if (!inFiles) {
        throw new Error(`Invalid updater manifest ${sourceName}:${lineNumber}: file before files.`);
      }
      finishFile(lineNumber);
      currentFile = { url: decodeYamlScalar(fileStart[1]) };
      continue;
    }

    const fileField = line.match(/^    (sha512|size|blockMapSize):\s*(.+)$/);
    if (fileField?.[1] && fileField[2]) {
      if (!currentFile) {
        throw new Error(
          `Invalid updater manifest ${sourceName}:${lineNumber}: file metadata without a URL.`,
        );
      }
      if (fileField[1] === "sha512") {
        currentFile.sha512 = decodeYamlScalar(fileField[2]);
      } else if (fileField[1] === "size") {
        currentFile.size = parsePositiveInteger(fileField[2], "size", sourceName);
      } else {
        currentFile.blockMapSize = parsePositiveInteger(fileField[2], "blockMapSize", sourceName);
      }
      continue;
    }

    if (/^\s/.test(line)) {
      throw new Error(`Invalid updater manifest ${sourceName}:${lineNumber}: '${line}'.`);
    }

    finishFile(lineNumber);
    inFiles = false;
    const topLevel = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!topLevel?.[1] || topLevel[2] === undefined) {
      throw new Error(`Invalid updater manifest ${sourceName}:${lineNumber}: '${line}'.`);
    }
    const key = topLevel[1];
    const value = decodeYamlScalar(topLevel[2]);
    if (key === "version") {
      version = value;
    } else if (key === "releaseDate") {
      releaseDate = value;
    } else if (key !== "path" && key !== "sha512") {
      extras[key] = topLevel[2].trim();
    }
  }
  finishFile(lines.length);

  if (!version || !releaseDate || files.length === 0) {
    throw new Error(
      `Invalid updater manifest ${sourceName}: version, files, and releaseDate are required.`,
    );
  }
  const urls = files.map((file) => file.url);
  if (new Set(urls).size !== urls.length) {
    throw new Error(`Invalid updater manifest ${sourceName}: duplicate file URL.`);
  }
  return { version, files, releaseDate, extras };
}

function serializeUpdateManifest(manifest: UpdateManifest): Uint8Array {
  const lines = [`version: ${manifest.version}`, "files:"];
  for (const file of manifest.files) {
    lines.push(`  - url: ${file.url}`);
    lines.push(`    sha512: ${file.sha512}`);
    lines.push(`    size: ${file.size}`);
    if (file.blockMapSize !== undefined) {
      lines.push(`    blockMapSize: ${file.blockMapSize}`);
    }
  }
  for (const key of Object.keys(manifest.extras).toSorted()) {
    lines.push(`${key}: ${manifest.extras[key]}`);
  }
  lines.push(`releaseDate: ${quoteYamlString(manifest.releaseDate)}`, "");
  return Buffer.from(lines.join("\n"));
}

function assertExactNames(
  actualNames: ReadonlyArray<string>,
  expectedNames: readonly string[],
): void {
  const counts = new Map<string, number>();
  for (const name of actualNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .toSorted();
  if (duplicates.length > 0) {
    throw new Error(`Duplicate release assets: ${duplicates.join(", ")}`);
  }
  const actual = new Set(actualNames);
  const expected = new Set(expectedNames);
  const missing = expectedNames.filter((name) => !actual.has(name));
  const unexpected = actualNames.filter((name) => !expected.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : undefined,
      unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : undefined,
    ].filter(Boolean);
    throw new Error(`Invalid release asset set (${details.join("; ")}).`);
  }
}

function validateReceiptAsset(
  rawAsset: unknown,
  receiptLabel: string,
): PublicDesktopReleaseReceiptAsset {
  if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) {
    throw new Error(`Invalid release receipt ${receiptLabel}: asset must be an object.`);
  }
  const asset = rawAsset as Record<string, unknown>;
  if (typeof asset.name !== "string" || asset.name.length === 0) {
    throw new Error(`Invalid release receipt ${receiptLabel}: asset name is required.`);
  }
  if (typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(
      `Invalid release receipt ${receiptLabel}: ${asset.name} size must be a positive integer.`,
    );
  }
  if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error(
      `Invalid release receipt ${receiptLabel}: ${asset.name} requires a lowercase SHA-256.`,
    );
  }
  if (
    asset.sha512 !== undefined &&
    (typeof asset.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(asset.sha512))
  ) {
    throw new Error(
      `Invalid release receipt ${receiptLabel}: ${asset.name} has an invalid updater SHA-512.`,
    );
  }
  return {
    name: asset.name,
    size: asset.size,
    sha256: asset.sha256,
    ...(asset.sha512 === undefined ? {} : { sha512: asset.sha512 as string }),
  };
}

export function validatePublicDesktopReleaseReceipt(
  rawReceipt: unknown,
  expectedVersion?: string,
): PublicDesktopReleaseReceipt {
  if (!rawReceipt || typeof rawReceipt !== "object" || Array.isArray(rawReceipt)) {
    throw new Error("Invalid release receipt: expected an object.");
  }
  const receipt = rawReceipt as Record<string, unknown>;
  if (receipt.schemaVersion !== 1) {
    throw new Error("Invalid release receipt: schemaVersion must be 1.");
  }
  if (typeof receipt.version !== "string") {
    throw new Error("Invalid release receipt: version is required.");
  }
  const { version } = validatePublicDesktopReleaseVersion(receipt.version);
  if (expectedVersion !== undefined && version !== expectedVersion) {
    throw new Error(
      `Invalid release receipt: version ${version} does not match ${expectedVersion}.`,
    );
  }
  if (receipt.platform !== "mac" && receipt.platform !== "win") {
    throw new Error("Invalid release receipt: platform must be mac or win.");
  }
  if (receipt.arch !== "arm64" && receipt.arch !== "x64") {
    throw new Error("Invalid release receipt: arch must be arm64 or x64.");
  }
  if (!Array.isArray(receipt.assets)) {
    throw new Error("Invalid release receipt: assets must be an array.");
  }
  const platform = receipt.platform;
  const arch = receipt.arch;
  const label = `${platform}/${arch}`;
  const assets = receipt.assets.map((asset) => validateReceiptAsset(asset, label));
  assertExactNames(
    assets.map((asset) => asset.name),
    publicDesktopReleaseReceiptAssetNames(version, platform, arch),
  );
  return {
    schemaVersion: 1,
    version,
    platform,
    arch,
    assets,
  };
}

export function createPublicDesktopReleaseReceipt(
  rawVersion: string,
  platform: PublicDesktopReleasePlatform,
  arch: PublicDesktopReleaseArch,
  sourceAssets: ReadonlyArray<PublicDesktopReleaseAsset>,
): PublicDesktopReleaseReceipt {
  const { version } = validatePublicDesktopReleaseVersion(rawVersion);
  const receipt: PublicDesktopReleaseReceipt = {
    schemaVersion: 1,
    version,
    platform,
    arch,
    assets: sourceAssets.map((asset) => ({
      name: asset.name,
      size: asset.contents.byteLength,
      sha256: createHash("sha256").update(asset.contents).digest("hex"),
      ...(asset.name.endsWith(".blockmap")
        ? {}
        : { sha512: createHash("sha512").update(asset.contents).digest("base64") }),
    })),
  };
  return validatePublicDesktopReleaseReceipt(receipt, version);
}

function assertManifestMetadata(
  manifest: UpdateManifest,
  sourceName: string,
  version: string,
  expectedUrls: readonly string[],
  assets: ReadonlyMap<string, { readonly size: number; readonly sha512?: string }>,
): void {
  if (manifest.version !== version) {
    throw new Error(
      `Updater manifest ${sourceName} has version ${manifest.version}; expected ${version}.`,
    );
  }
  const urls = manifest.files.map((file) => file.url);
  assertExactNames(urls, expectedUrls);
  for (const file of manifest.files) {
    const payload = assets.get(file.url);
    if (!payload) throw new Error(`Updater manifest ${sourceName} references missing ${file.url}.`);
    if (file.size !== payload.size || file.sha512 !== payload.sha512) {
      throw new Error(`Updater manifest ${sourceName} metadata does not match ${file.url}.`);
    }
  }
}

function mergeMacManifests(arm64: UpdateManifest, x64: UpdateManifest): UpdateManifest {
  const extras: Record<string, string> = { ...arm64.extras };
  for (const [key, value] of Object.entries(x64.extras)) {
    if (extras[key] !== undefined && extras[key] !== value) {
      throw new Error(`macOS updater manifests disagree on '${key}'.`);
    }
    extras[key] = value;
  }
  return {
    version: arm64.version,
    files: [...arm64.files, ...x64.files],
    releaseDate: arm64.releaseDate >= x64.releaseDate ? arm64.releaseDate : x64.releaseDate,
    extras,
  };
}

function sha256SumsFromDigests(
  assets: ReadonlyArray<{ readonly name: string; readonly sha256: string }>,
): Uint8Array {
  const lines = assets.map((asset) => `${asset.sha256}  ${asset.name}`).toSorted();
  return Buffer.from(`${lines.join("\n")}\n`);
}

export function preparePublicDesktopReleaseMetadata(
  rawVersion: string,
  rawReceipts: readonly unknown[],
  sourceManifests: ReadonlyArray<PublicDesktopReleaseAsset>,
): readonly PublicDesktopReleaseAsset[] {
  const { version } = validatePublicDesktopReleaseVersion(rawVersion);
  const receipts = rawReceipts.map((receipt) =>
    validatePublicDesktopReleaseReceipt(receipt, version),
  );
  const receiptsByLane = new Map<string, PublicDesktopReleaseReceipt>();
  for (const receipt of receipts) {
    const lane = `${receipt.platform}/${receipt.arch}`;
    if (receiptsByLane.has(lane)) {
      throw new Error(`Duplicate release receipt: ${lane}.`);
    }
    receiptsByLane.set(lane, receipt);
  }
  const expectedLanes = ["mac/arm64", "mac/x64", "win/x64"] as const;
  const missingLanes = expectedLanes.filter((lane) => !receiptsByLane.has(lane));
  const unexpectedLanes = [...receiptsByLane.keys()].filter(
    (lane) => !expectedLanes.includes(lane as (typeof expectedLanes)[number]),
  );
  if (missingLanes.length > 0 || unexpectedLanes.length > 0) {
    const details = [
      missingLanes.length > 0 ? `missing receipt: ${missingLanes.join(", ")}` : undefined,
      unexpectedLanes.length > 0 ? `unexpected receipt: ${unexpectedLanes.join(", ")}` : undefined,
    ].filter(Boolean);
    throw new Error(`Invalid release receipt set (${details.join("; ")}).`);
  }

  const receiptAssets = receipts.flatMap((receipt) => receipt.assets);
  assertExactNames(
    receiptAssets.map((asset) => asset.name),
    sourcePublicDesktopReleaseAssetNames(version).filter((name) => !name.startsWith("latest")),
  );
  assertExactNames(
    sourceManifests.map((asset) => asset.name),
    ["latest-mac-arm64.yml", "latest-mac-x64.yml", "latest.yml"],
  );

  const manifestAssets = new Map(sourceManifests.map((asset) => [asset.name, asset.contents]));
  const readManifest = (name: string) => {
    const contents = manifestAssets.get(name);
    if (!contents) throw new Error(`Missing updater manifest ${name}.`);
    return parseUpdateManifest(new TextDecoder("utf-8", { fatal: true }).decode(contents), name);
  };
  const receiptMetadata = new Map(
    receiptAssets.map((asset) => [
      asset.name,
      { size: asset.size, ...(asset.sha512 === undefined ? {} : { sha512: asset.sha512 }) },
    ]),
  );

  const arm64 = readManifest("latest-mac-arm64.yml");
  const x64 = readManifest("latest-mac-x64.yml");
  const windows = readManifest("latest.yml");
  assertManifestMetadata(
    arm64,
    "latest-mac-arm64.yml",
    version,
    [`DJL-${version}-arm64.zip`, `DJL-${version}-arm64.dmg`],
    receiptMetadata,
  );
  assertManifestMetadata(
    x64,
    "latest-mac-x64.yml",
    version,
    [`DJL-${version}-x64.zip`, `DJL-${version}-x64.dmg`],
    receiptMetadata,
  );
  assertManifestMetadata(
    windows,
    "latest.yml",
    version,
    [`DJL-${version}-x64.exe`],
    receiptMetadata,
  );

  const latestMac = serializeUpdateManifest(mergeMacManifests(arm64, x64));
  const latestWindows = manifestAssets.get("latest.yml");
  if (!latestWindows) throw new Error("Missing updater manifest latest.yml.");
  const prepared: PublicDesktopReleaseAsset[] = [
    { name: "latest-mac.yml", contents: latestMac },
    { name: "latest.yml", contents: latestWindows },
    { name: `${PUBLIC_DESKTOP_UPDATE_CHANNEL}-mac.yml`, contents: latestMac },
    { name: `${PUBLIC_DESKTOP_UPDATE_CHANNEL}.yml`, contents: latestWindows },
    { name: `${LEGACY_PUBLIC_DESKTOP_UPDATE_CHANNEL}-mac.yml`, contents: latestMac },
    { name: `${LEGACY_PUBLIC_DESKTOP_UPDATE_CHANNEL}.yml`, contents: latestWindows },
  ].toSorted((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  prepared.push({
    name: "SHA256SUMS",
    contents: sha256SumsFromDigests([
      ...receiptAssets.map((asset) => ({ name: asset.name, sha256: asset.sha256 })),
      ...prepared.map((asset) => ({
        name: asset.name,
        sha256: createHash("sha256").update(asset.contents).digest("hex"),
      })),
    ]),
  });
  assertExactNames(
    [...receiptAssets.map((asset) => asset.name), ...prepared.map((asset) => asset.name)],
    publishedPublicDesktopReleaseAssetNames(version),
  );
  return prepared.toSorted((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
}

export function preparePublicDesktopReleaseAssets(
  rawVersion: string,
  sourceAssets: ReadonlyArray<PublicDesktopReleaseAsset>,
): readonly PublicDesktopReleaseAsset[] {
  const { version } = validatePublicDesktopReleaseVersion(rawVersion);
  assertExactNames(
    sourceAssets.map((asset) => asset.name),
    sourcePublicDesktopReleaseAssetNames(version),
  );
  const byName = new Map(sourceAssets.map((asset) => [asset.name, asset]));
  const select = (...names: string[]): PublicDesktopReleaseAsset[] =>
    names.map((name) => {
      const asset = byName.get(name);
      if (!asset) throw new Error(`Missing release asset ${name}.`);
      return asset;
    });
  const receipts = [
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
      select(`DJL-${version}-x64.dmg`, `DJL-${version}-x64.dmg.blockmap`, `DJL-${version}-x64.zip`),
    ),
    createPublicDesktopReleaseReceipt(
      version,
      "win",
      "x64",
      select(`DJL-${version}-x64.exe`, `DJL-${version}-x64.exe.blockmap`),
    ),
  ];
  const payloads = sourceAssets.filter((asset) => !asset.name.startsWith("latest"));
  const manifests = select("latest-mac-arm64.yml", "latest-mac-x64.yml", "latest.yml");
  const prepared = [
    ...payloads,
    ...preparePublicDesktopReleaseMetadata(version, receipts, manifests),
  ];
  return prepared.toSorted((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
}

export function validatePublicDesktopReleaseRemoteAssets(
  rawVersion: string,
  rawReceipts: readonly unknown[],
  metadata: ReadonlyArray<PublicDesktopReleaseAsset>,
  rawRemoteAssets: readonly unknown[],
): void {
  const { version } = validatePublicDesktopReleaseVersion(rawVersion);
  const receipts = rawReceipts.map((receipt) =>
    validatePublicDesktopReleaseReceipt(receipt, version),
  );
  const receiptAssets = receipts.flatMap((receipt) => receipt.assets);
  const expectedNames = publishedPublicDesktopReleaseAssetNames(version);
  assertExactNames(
    [...receiptAssets.map((asset) => asset.name), ...metadata.map((asset) => asset.name)],
    expectedNames,
  );

  const expected = new Map<string, { readonly size: number; readonly sha256: string }>([
    ...receiptAssets.map(
      (asset) => [asset.name, { size: asset.size, sha256: asset.sha256 }] as const,
    ),
    ...metadata.map(
      (asset) =>
        [
          asset.name,
          {
            size: asset.contents.byteLength,
            sha256: createHash("sha256").update(asset.contents).digest("hex"),
          },
        ] as const,
    ),
  ]);
  const remoteAssets = rawRemoteAssets.map((rawAsset) => {
    if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) {
      throw new Error("Invalid GitHub release asset: expected an object.");
    }
    const asset = rawAsset as Record<string, unknown>;
    if (typeof asset.name !== "string" || asset.name.length === 0) {
      throw new Error("Invalid GitHub release asset: name is required.");
    }
    if (typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`Invalid GitHub release asset ${asset.name}: size must be positive.`);
    }
    if (typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
      throw new Error(
        `Invalid GitHub release asset ${asset.name}: lowercase SHA-256 digest is required.`,
      );
    }
    return {
      name: asset.name,
      size: asset.size,
      digest: asset.digest,
    } satisfies PublicDesktopReleaseRemoteAsset;
  });
  assertExactNames(
    remoteAssets.map((asset) => asset.name),
    expectedNames,
  );
  for (const remote of remoteAssets) {
    const local = expected.get(remote.name);
    if (!local) throw new Error(`Unexpected GitHub release asset ${remote.name}.`);
    if (remote.size !== local.size) {
      throw new Error(
        `GitHub release asset ${remote.name} size mismatch: ${remote.size} != ${local.size}.`,
      );
    }
    if (remote.digest !== `sha256:${local.sha256}`) {
      throw new Error(`GitHub release asset ${remote.name} SHA-256 mismatch.`);
    }
  }
}
