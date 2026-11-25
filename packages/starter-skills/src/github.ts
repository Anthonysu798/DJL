// FILE: github.ts
// Purpose: Fetch one skill folder from a public GitHub repo at a pinned commit, safely: list the
//          repo tree, pick the skill's files, refuse symlinks / submodules / oversized folders,
//          detect its license and any scripts, then download only those files.
// Layer: Shared package (Node). Used by the DJL server's Skills store and the catalog curation
//        script, so both judge a skill the same way.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const SKILL_MAX_FILES = 300;
export const SKILL_MAX_BYTES = 10 * 1024 * 1024;
const TREE_MAX_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SCRIPT_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".rb",
  ".pl",
  ".ps1",
  ".bat",
  ".cmd",
  ".exe",
]);
const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;
/** Licenses DJL accepts for skills it installs. */
export const ACCEPTED_SKILL_LICENSES = ["MIT", "Apache-2.0", "BSD", "ISC", "CC-BY-4.0"] as const;

export type SkillSourceErrorCode =
  | "badRepo"
  | "network"
  | "notFound"
  | "unsafe"
  | "tooLarge"
  | "noLicense"
  | "license";

// No parameter properties: the desktop build script loads this file with Node's type stripping,
// which rejects them.
export class SkillSourceError extends Error {
  readonly code: SkillSourceErrorCode;
  constructor(message: string, code: SkillSourceErrorCode = "network") {
    super(message);
    this.code = code;
  }
}

export interface RepoTreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: "blob" | "tree" | "commit";
  readonly size?: number;
}

export interface SkillFilePlan {
  /** Folder of the skill inside the repo, e.g. `skills/frontend-design`. */
  readonly skillPath: string;
  /** Files under the folder, relative to it. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly size: number }>;
  /** Files that can run code: executables and script extensions. */
  readonly scripts: ReadonlyArray<string>;
  /** Repo path of the license file to use: the skill's own, else the repo's. */
  readonly licensePath: string | null;
}

export function assertRepo(repo: string): void {
  if (!REPO_PATTERN.test(repo) || repo.includes(".."))
    throw new SkillSourceError(`"${repo}" is not a GitHub repository`, "badRepo");
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  // A compressed body's length says nothing about the decoded size (tiny files can grow).
  const declared = response.headers.get("content-encoding")
    ? 0
    : Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new SkillSourceError("The download is too large", "tooLarge");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SkillSourceError("The download is too large", "tooLarge");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function request(
  fetchImpl: FetchLike,
  url: string,
  maxBytes: number,
  headers: Record<string, string> = {},
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "error",
      headers: { "User-Agent": "DJL-skills-store", ...headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SkillSourceError("GitHub could not be reached", "network");
  }
  if (response.status === 404) throw new SkillSourceError("Not found on GitHub", "notFound");
  if (response.status === 403 || response.status === 429)
    throw new SkillSourceError("GitHub is rate limiting requests; try again later", "network");
  if (!response.ok) throw new SkillSourceError(`GitHub answered ${response.status}`, "network");
  return readCapped(response, maxBytes);
}

/** The commit the repo's default branch points at now. */
export async function resolveHeadCommit(fetchImpl: FetchLike, repo: string): Promise<string> {
  assertRepo(repo);
  const bytes = await request(
    fetchImpl,
    `https://api.github.com/repos/${repo}/commits/HEAD`,
    1024,
    {
      Accept: "application/vnd.github.sha",
    },
  );
  const sha = new TextDecoder().decode(bytes).trim();
  if (!COMMIT_PATTERN.test(sha)) throw new SkillSourceError("GitHub returned no commit", "network");
  return sha;
}

export async function listRepoTree(
  fetchImpl: FetchLike,
  repo: string,
  commit: string,
): Promise<RepoTreeEntry[]> {
  assertRepo(repo);
  if (!COMMIT_PATTERN.test(commit)) throw new SkillSourceError("Invalid commit", "badRepo");
  const bytes = await request(
    fetchImpl,
    `https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`,
    TREE_MAX_BYTES,
    { Accept: "application/vnd.github+json" },
  );
  const body = JSON.parse(new TextDecoder().decode(bytes)) as {
    tree?: RepoTreeEntry[];
    truncated?: boolean;
  };
  if (body.truncated)
    throw new SkillSourceError("This repository is too large to read", "tooLarge");
  return body.tree ?? [];
}

/**
 * The folder holding the skill: the given path when it has a SKILL.md, else the shallowest
 * folder named after the skill, else the repo's only skill.
 */
export function findSkillPath(
  tree: ReadonlyArray<RepoTreeEntry>,
  want: { readonly path?: string; readonly skillId: string },
): string | null {
  const skillDirs = tree
    .filter((entry) => entry.type === "blob" && /(^|\/)SKILL\.md$/.test(entry.path))
    .map((entry) => path.posix.dirname(entry.path))
    .map((dir) => (dir === "." ? "" : dir));
  if (want.path !== undefined) return skillDirs.includes(want.path) ? want.path : null;
  const named = skillDirs
    .filter((dir) => path.posix.basename(dir) === want.skillId)
    .toSorted((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  if (named[0] !== undefined) return named[0];
  return skillDirs.length === 1 ? skillDirs[0]! : null;
}

function isSafeRelative(relative: string): boolean {
  return (
    relative.length > 0 &&
    !relative.startsWith("/") &&
    !relative.includes("\\") &&
    !relative.split("/").some((part) => part === ".." || part === "." || part === "")
  );
}

/** Which files to download for the skill, after the safety checks. */
export function planSkillFiles(
  tree: ReadonlyArray<RepoTreeEntry>,
  skillPath: string,
): SkillFilePlan {
  const prefix = skillPath ? `${skillPath}/` : "";
  const inside = tree.filter((entry) => entry.path.startsWith(prefix));
  const files: Array<{ path: string; size: number }> = [];
  const scripts: string[] = [];
  let total = 0;
  for (const entry of inside) {
    const relative = entry.path.slice(prefix.length);
    if (entry.type === "commit")
      throw new SkillSourceError(`The skill links another repository (${relative})`, "unsafe");
    if (entry.type !== "blob") continue;
    if (entry.mode === "120000")
      throw new SkillSourceError(`The skill contains a symbolic link (${relative})`, "unsafe");
    if (!isSafeRelative(relative))
      throw new SkillSourceError(`The skill contains an unsafe path (${relative})`, "unsafe");
    const size = entry.size ?? 0;
    total += size;
    files.push({ path: relative, size });
    if (
      entry.mode === "100755" ||
      SCRIPT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())
    )
      scripts.push(relative);
  }
  if (!files.some((file) => file.path === "SKILL.md"))
    throw new SkillSourceError("The folder has no SKILL.md", "notFound");
  if (files.length > SKILL_MAX_FILES || total > SKILL_MAX_BYTES)
    throw new SkillSourceError("The skill folder is too large", "tooLarge");
  const ownLicense = files.find((file) => !file.path.includes("/") && LICENSE_FILE.test(file.path));
  const repoLicense = tree.find(
    (entry) => entry.type === "blob" && !entry.path.includes("/") && LICENSE_FILE.test(entry.path),
  );
  return {
    skillPath,
    files: files.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    scripts: scripts.toSorted(),
    licensePath: ownLicense ? `${prefix}${ownLicense.path}` : (repoLicense?.path ?? null),
  };
}

/** SPDX-style id for a license text, or "Other" when it is a license DJL does not recognise. */
export function identifyLicense(text: string): string {
  const normalized = text.replace(/\s+/g, " ");
  if (/Apache License,? Version 2\.0/i.test(normalized)) return "Apache-2.0";
  if (/Permission is hereby granted, free of charge/i.test(normalized)) return "MIT";
  if (/Redistribution and use in source and binary forms/i.test(normalized)) return "BSD";
  if (/Permission to use, copy, modify, and\/or distribute this software/i.test(normalized))
    return "ISC";
  if (/Creative Commons Attribution 4\.0/i.test(normalized)) return "CC-BY-4.0";
  return "Other";
}

export function rawFileUrl(repo: string, commit: string, repoPath: string): string {
  assertRepo(repo);
  const encoded = repoPath.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${repo}/${commit}/${encoded}`;
}

export async function fetchRepoText(
  fetchImpl: FetchLike,
  repo: string,
  commit: string,
  repoPath: string,
  maxBytes = 512 * 1024,
): Promise<string> {
  const bytes = await request(fetchImpl, rawFileUrl(repo, commit, repoPath), maxBytes);
  return new TextDecoder().decode(bytes);
}

/** Downloads the planned files into `destination` (which must not exist yet). */
export async function downloadSkillFiles(
  fetchImpl: FetchLike,
  input: { readonly repo: string; readonly commit: string; readonly plan: SkillFilePlan },
  destination: string,
): Promise<void> {
  const prefix = input.plan.skillPath ? `${input.plan.skillPath}/` : "";
  const queue = [...input.plan.files];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const bytes = await request(
        fetchImpl,
        rawFileUrl(input.repo, input.commit, `${prefix}${file.path}`),
        Math.max(file.size, 1),
      );
      if (bytes.byteLength !== file.size)
        throw new SkillSourceError(`${file.path} does not match GitHub's file list`, "unsafe");
      const target = path.join(destination, ...file.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { mode: 0o644 });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

/** `name:` from SKILL.md frontmatter, if any. */
export function skillFrontmatterName(markdown: string): string | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1];
  const name = frontmatter && /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(frontmatter)?.[1];
  return name ? name.trim() : null;
}
