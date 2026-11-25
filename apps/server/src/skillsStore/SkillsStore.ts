// FILE: SkillsStore.ts
// Purpose: The Skills store behind the Plugins page: the reviewed catalog (bundled with DJL,
//          refreshed online), live skills.sh search, and installing / updating / removing
//          skills in `~/.djl/skills`. Only folders DJL installed are ever replaced or removed.
// Layer: Server feature (plain async; SkillsStoreService wraps it in Effect). GitHub access and
//        the safety checks live in `@djl/starter-skills/node` so the curation script agrees.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  SkillsStoreCatalogFile,
  type SkillsStoreCatalogEntry,
  type SkillsStoreChangeResult,
  type SkillsStoreInstalledSkill,
  type SkillsStoreSearchResult,
  type SkillsStoreSkillInput,
  type SkillsStoreSnapshot,
} from "@djl/contracts";
import {
  downloadSkillFiles,
  fetchRepoText,
  findSkillPath,
  hashSkillFolder,
  identifyLicense,
  listRepoTree,
  planSkillFiles,
  resolveHeadCommit,
  SkillSourceError,
  skillFrontmatterName,
  type FetchLike,
} from "@djl/starter-skills/node";
import { Schema } from "effect";

export const REMOTE_CATALOG_URL = "https://slcor.com/skills/catalog.json";
const REMOTE_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const SMALL_RESPONSE_BYTES = 1024 * 1024;
const RECORDS_FILE = "skills-store.json";
const ID_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.:-]+)$/;

interface InstallRecord {
  readonly id: string;
  readonly name: string;
  readonly repo: string;
  readonly path: string;
  readonly commit: string;
  readonly license: string;
  readonly source: "curated" | "search";
  readonly installedAt: string;
  /** Folder name under the skills folder. */
  readonly folder: string;
  /** Hash of the folder as installed, to notice the user's own edits. */
  readonly sha256: string;
}

export class SkillsStoreError extends Error {}

export function parseSkillId(id: string): { repo: string; skill: string } {
  const match = ID_PATTERN.exec(id);
  if (!match || id.includes(".."))
    throw new SkillsStoreError(`"${id}" is not a skill id (owner/repo/skill)`);
  return { repo: `${match[1]}/${match[2]}`, skill: match[3]! };
}

function folderNameFor(id: string): string {
  const { repo, skill } = parseSkillId(id);
  return `${repo.split("/")[0]}--${skill}`.replace(/[^A-Za-z0-9_.-]/g, "-").toLowerCase();
}

async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const text = await response.text();
  if (text.length > maxBytes) throw new SkillsStoreError("The response is too large");
  return text;
}

const decodeCatalog = Schema.decodeUnknownSync(SkillsStoreCatalogFile);

export class SkillsStore {
  readonly #skillsDir: string;
  readonly #recordsPath: string;
  readonly #fetch: FetchLike;
  readonly #bundled: SkillsStoreCatalogFile;
  readonly #remoteCatalogUrl: string | null;
  readonly #now: () => number;
  #catalog: SkillsStoreCatalogFile;
  #catalogCheckedAt = 0;
  readonly #searchCache = new Map<string, { at: number; results: SkillsStoreSearchResult[] }>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(input: {
    readonly skillsDir: string;
    readonly stateDir: string;
    readonly bundled: SkillsStoreCatalogFile;
    readonly fetch?: FetchLike;
    /** null turns the online refresh off (tests). */
    readonly remoteCatalogUrl?: string | null;
    readonly now?: () => number;
  }) {
    this.#skillsDir = input.skillsDir;
    this.#recordsPath = path.join(input.stateDir, RECORDS_FILE);
    this.#fetch = input.fetch ?? ((url, init) => fetch(url, init));
    this.#bundled = input.bundled;
    this.#catalog = input.bundled;
    this.#remoteCatalogUrl =
      input.remoteCatalogUrl === undefined ? REMOTE_CATALOG_URL : input.remoteCatalogUrl;
    this.#now = input.now ?? Date.now;
  }

  /** One change at a time, so two clicks cannot race on the same folder or records file. */
  #serial<A>(run: () => Promise<A>): Promise<A> {
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /** The newest valid catalog: the online copy when it is newer than the bundled one. */
  async catalog(): Promise<ReadonlyArray<SkillsStoreCatalogEntry>> {
    const now = this.#now();
    if (this.#remoteCatalogUrl && now - this.#catalogCheckedAt > REMOTE_CATALOG_TTL_MS) {
      this.#catalogCheckedAt = now;
      try {
        const response = await this.#fetch(this.#remoteCatalogUrl, {
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const remote = decodeCatalog(
            JSON.parse(await readCappedText(response, SMALL_RESPONSE_BYTES)),
          );
          if (remote.version > this.#bundled.version) this.#catalog = remote;
        }
      } catch {
        // Offline or not published yet: the bundled catalog is always good enough.
      }
    }
    return this.#catalog.entries;
  }

  async #records(): Promise<Record<string, InstallRecord>> {
    try {
      const parsed = JSON.parse(await readFile(this.#recordsPath, "utf8")) as {
        installed?: Record<string, InstallRecord>;
      };
      return parsed.installed ?? {};
    } catch {
      return {};
    }
  }

  async #saveRecords(installed: Record<string, InstallRecord>): Promise<void> {
    await mkdir(path.dirname(this.#recordsPath), { recursive: true });
    const temporary = `${this.#recordsPath}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ installed }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#recordsPath);
  }

  async snapshot(): Promise<SkillsStoreSnapshot> {
    const catalog = await this.catalog();
    const records = await this.#records();
    const installed: SkillsStoreInstalledSkill[] = [];
    for (const record of Object.values(records)) {
      const folder = path.join(this.#skillsDir, record.folder);
      // Deleted by hand: forget it rather than show a skill that is not there.
      if (!existsSync(path.join(folder, "SKILL.md"))) continue;
      const entry = catalog.find((item) => item.id === record.id && !item.builtIn);
      installed.push({
        id: record.id,
        name: record.name,
        repo: record.repo,
        path: record.path,
        commit: record.commit,
        license: record.license,
        source: record.source,
        installedAt: record.installedAt,
        edited: hashSkillFolder(folder) !== record.sha256,
        updateAvailable: entry !== undefined && entry.commit !== record.commit,
      });
    }
    return { catalog, installed: installed.toSorted((a, b) => a.name.localeCompare(b.name)) };
  }

  async search(query: string): Promise<SkillsStoreSearchResult[]> {
    const key = query.trim().toLowerCase();
    const cached = this.#searchCache.get(key);
    if (cached && this.#now() - cached.at < SEARCH_TTL_MS) return cached.results;
    let response: Response;
    try {
      response = await this.#fetch(
        `https://skills.sh/api/search?q=${encodeURIComponent(key)}&limit=30`,
        { redirect: "error", signal: AbortSignal.timeout(10_000) },
      );
    } catch {
      throw new SkillsStoreError("skills.sh could not be reached");
    }
    if (!response.ok) throw new SkillsStoreError(`skills.sh answered ${response.status}`);
    const body = JSON.parse(await readCappedText(response, SMALL_RESPONSE_BYTES)) as {
      skills?: Array<{ id?: unknown; source?: unknown; name?: unknown; installs?: unknown }>;
    };
    const results = (body.skills ?? []).flatMap((skill): SkillsStoreSearchResult[] => {
      if (typeof skill.id !== "string" || typeof skill.source !== "string") return [];
      const name = typeof skill.name === "string" && skill.name ? skill.name : skill.id;
      return [
        {
          id: skill.id,
          name,
          repo: skill.source,
          installs: typeof skill.installs === "number" ? skill.installs : 0,
          // Skills hosted outside GitHub (a domain instead of owner/repo) cannot be fetched.
          installable: ID_PATTERN.test(skill.id) && skill.source.includes("/"),
        },
      ];
    });
    if (this.#searchCache.size > 100) this.#searchCache.clear();
    this.#searchCache.set(key, { at: this.#now(), results });
    return results;
  }

  /** The skill's SKILL.md, for the detail sheet. */
  async preview(id: string): Promise<string> {
    const record = (await this.#records())[id];
    if (record) {
      const local = path.join(this.#skillsDir, record.folder, "SKILL.md");
      if (existsSync(local)) return readFile(local, "utf8");
    }
    const entry = (await this.catalog()).find((item) => item.id === id);
    if (entry)
      return fetchRepoText(this.#fetch, entry.repo, entry.commit, `${entry.path}/SKILL.md`);
    const { repo, skill } = parseSkillId(id);
    const commit = await resolveHeadCommit(this.#fetch, repo);
    const skillPath = findSkillPath(await listRepoTree(this.#fetch, repo, commit), {
      skillId: skill,
    });
    if (skillPath === null)
      throw new SkillsStoreError("This skill was not found in its repository");
    return fetchRepoText(
      this.#fetch,
      repo,
      commit,
      skillPath ? `${skillPath}/SKILL.md` : "SKILL.md",
    );
  }

  /** Installs the skill, or updates it to the reviewed / latest version when installed. */
  install(input: SkillsStoreSkillInput): Promise<SkillsStoreChangeResult> {
    return this.#serial(() => this.#install(input));
  }

  async #install(input: SkillsStoreSkillInput): Promise<SkillsStoreChangeResult> {
    const { repo, skill } = parseSkillId(input.id);
    const entry = (await this.catalog()).find((item) => item.id === input.id);
    if (entry?.builtIn) throw new SkillsStoreError("This skill already comes with DJL");
    const records = await this.#records();
    const previous = records[input.id];
    const folderName = previous?.folder ?? folderNameFor(input.id);
    const target = path.join(this.#skillsDir, folderName);

    if (previous && existsSync(target) && !input.overwriteEdits) {
      if (hashSkillFolder(target) !== previous.sha256)
        return { status: "needsConsent", reason: "edits", files: [] };
    }
    if (!previous && existsSync(target))
      throw new SkillsStoreError(
        `A skill folder named "${folderName}" already exists in your skills folder`,
      );

    try {
      const commit = entry?.commit ?? (await resolveHeadCommit(this.#fetch, repo));
      const tree = await listRepoTree(this.#fetch, repo, commit);
      const skillPath = findSkillPath(tree, {
        skillId: skill,
        ...(entry ? { path: entry.path } : {}),
      });
      if (skillPath === null)
        throw new SkillsStoreError("This skill was not found in its repository");
      const plan = planSkillFiles(tree, skillPath);
      if (plan.scripts.length > 0 && !input.allowScripts)
        return { status: "needsConsent", reason: "scripts", files: [...plan.scripts] };
      if (!plan.licensePath)
        throw new SkillsStoreError("This skill has no license, so DJL cannot install it");
      const licenseText = await fetchRepoText(this.#fetch, repo, commit, plan.licensePath);
      const license = entry?.license ?? identifyLicense(licenseText);

      await mkdir(this.#skillsDir, { recursive: true });
      const staging = path.join(this.#skillsDir, `.staging-${randomBytes(6).toString("hex")}`);
      try {
        await downloadSkillFiles(this.#fetch, { repo, commit, plan }, staging);
        if (entry && hashSkillFolder(staging) !== entry.sha256)
          throw new SkillsStoreError(
            "The download does not match the version DJL reviewed, so it was not installed",
          );
        // Keep the license with the copy when it came from the repo root.
        const licenseName = path.posix.basename(plan.licensePath);
        if (!plan.licensePath.startsWith(skillPath ? `${skillPath}/` : ""))
          await writeFile(path.join(staging, licenseName), licenseText);
        const markdown = await readFile(path.join(staging, "SKILL.md"), "utf8");
        const sha256 = hashSkillFolder(staging);
        await rm(target, { recursive: true, force: true });
        await rename(staging, target);
        records[input.id] = {
          id: input.id,
          name: skillFrontmatterName(markdown) ?? skill,
          repo,
          path: skillPath,
          commit,
          license,
          source: entry ? "curated" : "search",
          installedAt: new Date(this.#now()).toISOString(),
          folder: folderName,
          sha256,
        };
        await this.#saveRecords(records);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    } catch (error) {
      if (error instanceof SkillSourceError) throw new SkillsStoreError(error.message);
      throw error;
    }
    return { status: "done", snapshot: await this.snapshot() };
  }

  /** Removes a skill DJL installed. Anything else in the skills folder is never touched. */
  remove(id: string): Promise<SkillsStoreSnapshot> {
    return this.#serial(async () => {
      const records = await this.#records();
      const record = records[id];
      if (!record) throw new SkillsStoreError("DJL did not install this skill");
      const folder = path.resolve(this.#skillsDir, record.folder);
      if (path.dirname(folder) !== path.resolve(this.#skillsDir))
        throw new SkillsStoreError("The skill's folder is outside the skills folder");
      await rm(folder, { recursive: true, force: true });
      delete records[id];
      await this.#saveRecords(records);
      return this.snapshot();
    });
  }
}
