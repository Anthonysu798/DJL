// FILE: check-brand-identity.ts
// Purpose: Prevents retired first-party identities from returning to tracked files.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const characters = (...codes: number[]): string => String.fromCharCode(...codes);
const retiredShortName = characters(116, 51);
const retiredFirstName = `${retiredShortName}${characters(99, 111, 100, 101)}`;
const retiredCompanyName = `${retiredShortName}${characters(116, 111, 111, 108, 115)}`;
const retiredSecondName = characters(100, 112, 99, 111, 100, 101);
const retiredPredecessorName = characters(99, 111, 100, 101, 116, 104, 105, 110, 103);
const retiredProductName = characters(83, 121, 110, 97, 114, 97);
const incorrectBundleDomain = characters(99, 111, 109, 46, 115, 121, 110, 97, 114, 97);
const agentInstructionPaths = new Set(["AGENTS.md", "CLAUDE.md"]);
const retiredIdentityReferencePaths = new Set([".gitignore"]);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const joinedWithOptionalSeparator = (left: string, right: string): string =>
  `${escapeRegExp(left)}[\\s._/@:-]*${escapeRegExp(right)}`;

const forbiddenPatterns = [
  new RegExp(
    joinedWithOptionalSeparator(retiredShortName, retiredFirstName.slice(retiredShortName.length)),
    "i",
  ),
  new RegExp(
    joinedWithOptionalSeparator(
      retiredShortName,
      retiredCompanyName.slice(retiredShortName.length),
    ),
    "i",
  ),
  new RegExp(
    joinedWithOptionalSeparator(retiredSecondName.slice(0, 2), retiredSecondName.slice(2)),
    "i",
  ),
  new RegExp(escapeRegExp(retiredPredecessorName), "i"),
  new RegExp(`@${escapeRegExp(retiredCompanyName)}`, "i"),
  new RegExp(
    `(?:^|[\\s"'\\x60./:@_-])${escapeRegExp(retiredShortName)}(?:$|[\\s"'\\x60./:@_-])`,
    "i",
  ),
  new RegExp(escapeRegExp(incorrectBundleDomain), "i"),
] as const;

// Raster images cannot be searched for embedded text. Keep the user-facing
// screenshots behind reviewed digests so changing either one requires another
// explicit visual identity audit instead of silently bypassing this guard.
const approvedVisualAssetDigests = new Map<string, string>([
  [
    "apps/marketing/public/screenshot.jpeg",
    "0b4be139f13dd08885a1aac26fc1f7c623697db157777d16360e985c93d47bcf",
  ],
  [
    "assets/prod/readme-screenshot.png",
    "139364364488f6e19798a786cfe805e80b325aa3b00c878fa46c007ee573888b",
  ],
]);

const approvedPinnedThirdPartyAssetDigests = new Map<string, string>([
  [
    "apps/ios/DJL/Resources/Mermaid/mermaid.min.js",
    "25fa120a2fbd80869051e58d58203c9b3432baf76e341c73cba3f17c00ee6202",
  ],
]);

export interface BrandIdentityFile {
  readonly path: string;
  readonly contents: string;
}

export interface BrandIdentityViolation {
  readonly path: string;
  readonly line: number | null;
  readonly text: string;
}

export interface BrandIdentityBinaryFile {
  readonly path: string;
  readonly contents: Uint8Array;
}

export interface TrackedFileReader {
  readonly listPaths: () => readonly string[];
  readonly readBlob: (path: string) => Uint8Array;
}

interface TrackedIndexEntry {
  readonly objectId: string;
  readonly path: string;
}

const isFirstPartyPath = (path: string): boolean =>
  path !== "vendor" && !path.startsWith("vendor/");

function containsForbiddenIdentity(value: string): boolean {
  return forbiddenPatterns.some((pattern) => pattern.test(value));
}

export function findBrandIdentityViolations(
  files: readonly BrandIdentityFile[],
): BrandIdentityViolation[] {
  const violations: BrandIdentityViolation[] = [];
  for (const file of files) {
    if (containsForbiddenIdentity(file.path)) {
      violations.push({ path: file.path, line: null, text: file.path });
    }
    if (retiredIdentityReferencePaths.has(file.path)) continue;
    const isAgentInstructionFile = agentInstructionPaths.has(file.path);
    for (const [index, line] of file.contents.split(/\r?\n/).entries()) {
      if (
        !containsForbiddenIdentity(line) &&
        !(isAgentInstructionFile && line.includes(retiredProductName))
      ) {
        continue;
      }
      violations.push({ path: file.path, line: index + 1, text: line.trim() });
    }
  }
  return violations;
}

export function findVisualBrandAssetViolations(
  files: readonly BrandIdentityBinaryFile[],
  approvedDigests: ReadonlyMap<string, string> = approvedVisualAssetDigests,
): BrandIdentityViolation[] {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const violations: BrandIdentityViolation[] = [];
  for (const [path, approvedDigest] of approvedDigests) {
    const file = filesByPath.get(path);
    if (!file) {
      violations.push({
        path,
        line: null,
        text: "Required visual brand asset is missing.",
      });
      continue;
    }
    const digest = createHash("sha256").update(file.contents).digest("hex");
    if (digest !== approvedDigest) {
      violations.push({
        path,
        line: null,
        text: "Visual brand asset changed; perform a visual identity review before approving it.",
      });
    }
  }
  return violations;
}

export function isBrandIdentityTextSearchable(
  path: string,
  pinnedDigests: ReadonlyMap<string, string> = approvedPinnedThirdPartyAssetDigests,
): boolean {
  return !pinnedDigests.has(path);
}

export function findPinnedThirdPartyAssetViolations(
  files: readonly BrandIdentityBinaryFile[],
  approvedDigests: ReadonlyMap<string, string> = approvedPinnedThirdPartyAssetDigests,
): BrandIdentityViolation[] {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const violations: BrandIdentityViolation[] = [];
  for (const [path, approvedDigest] of approvedDigests) {
    const file = filesByPath.get(path);
    if (!file) {
      violations.push({ path, line: null, text: "Pinned third-party asset is missing." });
      continue;
    }
    const digest = createHash("sha256").update(file.contents).digest("hex");
    if (digest !== approvedDigest) {
      violations.push({
        path,
        line: null,
        text: "Pinned third-party asset changed; review and update its digest.",
      });
    }
  }
  return violations;
}

function listTrackedIndexEntries(): TrackedIndexEntry[] {
  return execFileSync("git", ["ls-files", "--stage", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((record) => record.length > 0)
    .flatMap((record) => {
      const tabIndex = record.indexOf("\t");
      if (tabIndex < 0) {
        throw new Error(`Invalid git ls-files record: ${record}`);
      }
      const [mode, objectId, stage] = record.slice(0, tabIndex).split(" ");
      if (!mode || !objectId || !stage) {
        throw new Error(`Invalid git ls-files metadata: ${record}`);
      }
      if (stage !== "0") return [];
      const path = record.slice(tabIndex + 1);
      if (!isFirstPartyPath(path)) return [];
      return [{ objectId, path }];
    });
}

function readTrackedIndexFiles(): BrandIdentityBinaryFile[] {
  const entries = listTrackedIndexEntries();
  if (entries.length === 0) return [];

  const batchInput = Buffer.from(`${entries.map(({ objectId }) => objectId).join("\n")}\n`);
  const batchOutput = execFileSync("git", ["cat-file", "--batch"], {
    input: batchInput,
    maxBuffer: 1024 * 1024 * 1024,
  });
  const files: BrandIdentityBinaryFile[] = [];
  let offset = 0;

  for (const entry of entries) {
    const headerEnd = batchOutput.indexOf(10, offset);
    if (headerEnd < 0) {
      throw new Error(`Missing git cat-file header for ${entry.path}`);
    }
    const [objectId, type, rawSize] = batchOutput
      .subarray(offset, headerEnd)
      .toString("utf8")
      .split(" ");
    const size = Number(rawSize);
    if (objectId !== entry.objectId || type !== "blob" || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Invalid git cat-file response for ${entry.path}`);
    }
    const contentsStart = headerEnd + 1;
    const contentsEnd = contentsStart + size;
    if (contentsEnd >= batchOutput.length || batchOutput[contentsEnd] !== 10) {
      throw new Error(`Truncated git blob for ${entry.path}`);
    }
    files.push({ path: entry.path, contents: batchOutput.subarray(contentsStart, contentsEnd) });
    offset = contentsEnd + 1;
  }

  return files;
}

export function readTrackedFiles(reader?: TrackedFileReader): BrandIdentityBinaryFile[] {
  if (!reader) return readTrackedIndexFiles();
  return reader
    .listPaths()
    .filter(isFirstPartyPath)
    .map((path) => ({ path, contents: reader.readBlob(path) }));
}

function main(): void {
  const trackedFiles = readTrackedFiles();
  const searchableFiles = trackedFiles
    .filter((file) => isBrandIdentityTextSearchable(file.path))
    .map((file) => ({
      path: file.path,
      contents: file.contents.includes(0) ? "" : Buffer.from(file.contents).toString("utf8"),
    }));
  const violations = [
    ...findBrandIdentityViolations(searchableFiles),
    ...findVisualBrandAssetViolations(trackedFiles),
    ...findPinnedThirdPartyAssetViolations(trackedFiles),
  ];
  if (violations.length === 0) {
    console.log("DJL identity check passed.");
    return;
  }

  console.error("Retired first-party identity found:");
  for (const violation of violations) {
    const location =
      violation.line === null ? violation.path : `${violation.path}:${violation.line}`;
    console.error(`- ${location}: ${violation.text}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) main();
