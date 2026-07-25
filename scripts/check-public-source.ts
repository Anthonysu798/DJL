// FILE: check-public-source.ts
// Purpose: Blocks private runtime state, credentials, LFS pointers, and oversized public files.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";

const GITHUB_REGULAR_FILE_LIMIT = 100_000_000;
const MAX_TEXT_SCAN_SIZE = 10_000_000;
const legacyCrossRepositoryToken = ["DJL", "RELEASES", "TOKEN"].join("_");
const legacyRuntimePrefix = `.${String.fromCharCode(100, 112, 99, 111, 100, 101)}`;
const legacyRuntimeDirectory = `.${String.fromCharCode(116, 51)}`;
const REQUIRED_PUBLIC_LICENSE_MARKERS = new Map<string, readonly string[]>([
  [
    "LICENSE",
    [
      "Copyright (c) 2026 Emanuele Di Pietro",
      "Copyright (c) 2026 Anthony Su",
      "Permission is hereby granted",
    ],
  ],
  ["THIRD_PARTY_NOTICES.md", ["Synara", "Remodex", "OpenCode", "Ghostty"]],
  ["apps/ios/UPSTREAM_LICENSE", ["Apache License", "Version 2.0"]],
  ["apps/remote-gateway/UPSTREAM_LICENSE", ["Apache License", "Version 2.0"]],
  ["vendor/opencode/LICENSE", ["MIT License", "Copyright (c) 2025 opencode"]],
  [
    "apps/ios/DJL/Terminal/Vendor/GHOSTTY_LICENSE",
    ["MIT License", "Mitchell Hashimoto", "Ghostty contributors"],
  ],
]);

export interface PublicSourceFile {
  readonly path: string;
  readonly size: number;
  readonly contents: Uint8Array;
}

export interface PublicSourceViolation {
  readonly path: string;
  readonly rule:
    | "private-runtime-path"
    | "database-or-log"
    | "signing-or-credential-material"
    | "git-lfs-pointer"
    | "github-file-size"
    | "hard-coded-release-host"
    | "hard-coded-local-secret-path"
    | "embedded-api-key"
    | "legacy-cross-repository-token"
    | "third-party-license";
  readonly detail: string;
}

function pathRule(path: string): PublicSourceViolation | undefined {
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment === ".djl" ||
        segment === ".synara" ||
        segment.startsWith(legacyRuntimePrefix) ||
        segment === legacyRuntimeDirectory ||
        segment === ".wrangler",
    )
  ) {
    return {
      path,
      rule: "private-runtime-path",
      detail: "Private application or deployment runtime state must not be tracked.",
    };
  }

  const name = segments.at(-1) ?? path;
  if (/\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm))?$/i.test(name) || /\.log(?:\.\d+)?$/i.test(name)) {
    return {
      path,
      rule: "database-or-log",
      detail: "Databases and logs must not be tracked.",
    };
  }
  const isEnvironmentFile =
    name === ".env" ||
    (name.startsWith(".env.") && name !== ".env.example" && name !== ".env.template");
  if (
    isEnvironmentFile ||
    /\.(?:p8|p12|pem|key|mobileprovision)$/i.test(name) ||
    /^(?:auth|credentials)\.json$/i.test(name) ||
    name === "server-signing-key.bin"
  ) {
    return {
      path,
      rule: "signing-or-credential-material",
      detail: "Signing or credential material must be supplied outside the repository.",
    };
  }
  return undefined;
}

function isSearchableText(file: PublicSourceFile): boolean {
  if (file.size > MAX_TEXT_SCAN_SIZE) return false;
  return !file.contents.includes(0);
}

export function findPublicSourceViolations(
  files: readonly PublicSourceFile[],
): PublicSourceViolation[] {
  const violations: PublicSourceViolation[] = [];
  for (const file of files) {
    const pathViolation = pathRule(file.path);
    if (pathViolation) violations.push(pathViolation);

    if (file.size >= GITHUB_REGULAR_FILE_LIMIT) {
      violations.push({
        path: file.path,
        rule: "github-file-size",
        detail: `File is ${file.size} bytes; regular GitHub files must stay below ${GITHUB_REGULAR_FILE_LIMIT}.`,
      });
    }
    const prefix = Buffer.from(file.contents.subarray(0, 200)).toString("utf8");
    if (prefix.startsWith("version https://git-lfs.github.com/spec/v1\n")) {
      violations.push({
        path: file.path,
        rule: "git-lfs-pointer",
        detail: "Expand the Git LFS object into an ordinary Git file before publication.",
      });
    }
    if (!isSearchableText(file)) continue;

    const text = Buffer.from(file.contents).toString("utf8");
    const isExecutableScript =
      !/(?:^|[/.])test\.[^/]+$/i.test(file.path) &&
      (file.path.startsWith("scripts/") ||
        file.path.includes("/scripts/") ||
        /\.(?:sh|py|cjs|mjs)$/i.test(file.path));
    if (/[A-Za-z0-9._-]+@\d{1,3}(?:\.\d{1,3}){3}/.test(text)) {
      violations.push({
        path: file.path,
        rule: "hard-coded-release-host",
        detail: "Use an explicit environment variable instead of a hard-coded SSH host.",
      });
    }
    if (
      (isExecutableScript &&
        (/\/Users\/[^/<\s]+\/[^<\s]+/.test(text) || /\/home\/[^/<\s]+\/[^<\s]+/.test(text))) ||
      /\/Users\/[^/\s]+\/(?:\.ssh|\.djl-signing)\//.test(text) ||
      /\/home\/[^/\s]+\/\.ssh\//.test(text) ||
      /[A-Za-z]:\\Users\\[^\\\s]+\\(?:\.ssh|\.djl-signing)\\/.test(text)
    ) {
      violations.push({
        path: file.path,
        rule: "hard-coded-local-secret-path",
        detail:
          "Use a repository-relative path or explicit environment variable instead of a maintainer-specific path.",
      });
    }
    const hasAwsAccessKey = [...text.matchAll(/AKIA[0-9A-Z]{16}/g)].some(
      ([value]) => value !== "AKIAIOSFODNN7EXAMPLE",
    );
    if (
      /gh[pousr]_[A-Za-z0-9_]{20,}/.test(text) ||
      hasAwsAccessKey ||
      /sk-(?:proj-)?[A-Za-z0-9_-]{40,}/.test(text) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{40,}/.test(text)
    ) {
      violations.push({
        path: file.path,
        rule: "embedded-api-key",
        detail: "A token or private key pattern is present in tracked text.",
      });
    }
    if (text.includes(legacyCrossRepositoryToken)) {
      violations.push({
        path: file.path,
        rule: "legacy-cross-repository-token",
        detail: "Steady-state releases must use the same-repository GITHUB_TOKEN.",
      });
    }
  }
  return violations;
}

export function findPublicLicenseViolations(
  files: readonly PublicSourceFile[],
): PublicSourceViolation[] {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const violations: PublicSourceViolation[] = [];
  for (const [path, markers] of REQUIRED_PUBLIC_LICENSE_MARKERS) {
    const file = filesByPath.get(path);
    if (!file || file.size <= 0) {
      violations.push({
        path,
        rule: "third-party-license",
        detail: "Required public license or attribution file is missing or empty.",
      });
      continue;
    }
    const text = Buffer.from(file.contents).toString("utf8");
    const missingMarkers = markers.filter((marker) => !text.includes(marker));
    if (missingMarkers.length > 0) {
      violations.push({
        path,
        rule: "third-party-license",
        detail: `Required attribution markers are missing: ${missingMarkers.join(", ")}.`,
      });
    }
  }
  return violations;
}

function readCandidateFiles(): PublicSourceFile[] {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((path) => path.length > 0)
    .filter((path, index, all) => all.indexOf(path) === index)
    .filter((path) => existsSync(path));

  return paths.map((path) => {
    const stat = lstatSync(path);
    const contents = stat.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
    return { path, size: stat.isSymbolicLink() ? contents.byteLength : stat.size, contents };
  });
}

function main(): void {
  const files = readCandidateFiles();
  const violations = [...findPublicSourceViolations(files), ...findPublicLicenseViolations(files)];
  if (violations.length === 0) {
    console.log("Public source audit passed.");
    return;
  }
  console.error("Public source audit failed:");
  for (const violation of violations) {
    console.error(`- ${violation.path} [${violation.rule}]: ${violation.detail}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) main();
