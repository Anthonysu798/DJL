// FILE: sitePublisher.ts
// Purpose: Publishes a project as a static site on slcor.site: builds it with the project's
//          own build script, finds the output folder, checks it the way DJL Cloud will,
//          zips it, uploads it through the signed-in DJL Cloud account, and remembers the
//          site in `djl.site.json` so the next publish goes to the same address.
// Layer: Server service (wired in wsRpc.ts and the Work tools).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CLOUD_SITE_FILE_TYPES,
  CLOUD_SITE_MAX_FILES,
  CLOUD_SITE_MAX_UNZIPPED_BYTES,
  CLOUD_SITE_MAX_ZIP_BYTES,
  CLOUD_SITE_NAME_PATTERN,
  type CloudCreateSiteDeployResponse,
  type CloudSite,
  type CloudSiteListResponse,
  type CloudSiteNameAvailability,
} from "@djl/contracts/cloud";
import JSZip from "jszip";

import { CloudApiError, createCloudClient, type FetchLike } from "../cloud/api";
import { readCloudSession, type CloudSession } from "../cloud/session";
import { runProcess, type ProcessRunResult } from "../processRunner";

export const SITE_LINK_FILE = "djl.site.json";
const BUILD_TIMEOUT_MS = 5 * 60_000;
const OUTPUT_DIRS = ["out", "dist", "build"] as const;
const SKIPPED_DIRS = new Set(["node_modules", ".git", ".next", ".turbo", ".vercel", ".cache"]);
const EXTENSIONS = new Set(Object.keys(CLOUD_SITE_FILE_TYPES));

export type SitePublishErrorCode =
  | "not_signed_in"
  | "no_site"
  | "build_failed"
  | "site_invalid"
  | "name_required"
  | "cloud_error";

/** A failure the publish card can explain; `log` is the end of the build output. */
export class SitePublishError extends Error {
  constructor(
    readonly code: SitePublishErrorCode | string,
    message: string,
    readonly log?: string,
  ) {
    super(message);
  }
}

export interface SiteLink {
  readonly siteId: string;
  readonly name: string;
  readonly url: string;
}

export interface PreparedSite {
  readonly projectRoot: string;
  /** Folder that will be uploaded, relative to the project. "" means the project itself. */
  readonly outputDir: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly absolute: string;
    readonly size: number;
  }>;
  readonly bytes: number;
  readonly built: boolean;
  readonly link: SiteLink | null;
  readonly suggestedName: string;
}

export interface SitePublisherDeps {
  readonly secretsDir: string;
  readonly fetchImpl?: FetchLike;
  /** Runs `command args` in `cwd`; replaced in tests. */
  readonly run?: (
    command: string,
    args: readonly string[],
    cwd: string,
  ) => Promise<ProcessRunResult>;
}

/** The package manager a project uses, from its lockfile. */
export function packageManagerFor(projectRoot: string): "bun" | "pnpm" | "yarn" | "npm" {
  if (
    existsSync(path.join(projectRoot, "bun.lock")) ||
    existsSync(path.join(projectRoot, "bun.lockb"))
  )
    return "bun";
  if (existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

/** A valid site name from a folder or project title: "My Bakery!" → "my-bakery". */
export function suggestSiteName(source: string): string {
  const slug = source
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (CLOUD_SITE_NAME_PATTERN.test(slug)) return slug;
  return `site-${createHash("sha256").update(source).digest("hex").slice(0, 6)}`;
}

async function listFiles(
  root: string,
  relative = "",
): Promise<Array<{ path: string; absolute: string; size: number }>> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files: Array<{ path: string; absolute: string; size: number }> = [];
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    // Hidden files (.DS_Store, .env) are never published.
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      files.push(...(await listFiles(root, rel)));
    } else if (entry.isFile()) {
      const absolute = path.join(root, rel);
      files.push({ path: rel, absolute, size: (await stat(absolute)).size });
    }
  }
  return files;
}

/** Why these files cannot be published, in plain words, or null. Mirrors the cloud's checks. */
export function localSiteProblem(
  files: ReadonlyArray<{ path: string; size: number }>,
): string | null {
  if (!files.some((f) => f.path === "index.html"))
    return "The site has no index.html at its top level.";
  if (files.length > CLOUD_SITE_MAX_FILES)
    return `A site can have up to ${CLOUD_SITE_MAX_FILES} files; this one has ${files.length}.`;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > CLOUD_SITE_MAX_UNZIPPED_BYTES)
    return `A site can hold up to ${CLOUD_SITE_MAX_UNZIPPED_BYTES / 1024 ** 2} MB; this one has ${Math.ceil(total / 1024 ** 2)} MB.`;
  const blocked = files.filter((f) => {
    const name = f.path.split("/").at(-1)!;
    const dot = name.lastIndexOf(".");
    return dot <= 0 || !EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
  });
  if (blocked.length > 0)
    return `These files can't be on a website: ${blocked
      .slice(0, 5)
      .map((f) => f.path)
      .join(", ")}${blocked.length > 5 ? ` and ${blocked.length - 5} more` : ""}.`;
  if (files.some((f) => f.path.toLowerCase().startsWith("_djl/")))
    return 'The folder "_djl" is reserved by DJL. Rename it.';
  return null;
}

async function readLink(projectRoot: string): Promise<SiteLink | null> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(projectRoot, SITE_LINK_FILE), "utf8"),
    ) as Partial<SiteLink>;
    return typeof raw.siteId === "string" &&
      typeof raw.name === "string" &&
      typeof raw.url === "string"
      ? { siteId: raw.siteId, name: raw.name, url: raw.url }
      : null;
  } catch {
    return null;
  }
}

const tail = (result: ProcessRunResult) => `${result.stdout}\n${result.stderr}`.trim().slice(-4000);

export class SitePublisher {
  private readonly run: NonNullable<SitePublisherDeps["run"]>;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly deps: SitePublisherDeps) {
    this.run =
      deps.run ??
      ((command, args, cwd) =>
        runProcess(command, args, {
          cwd,
          timeoutMs: BUILD_TIMEOUT_MS,
          allowNonZeroExit: true,
          outputMode: "truncate",
          env: { ...process.env, CI: "1", NEXT_TELEMETRY_DISABLED: "1" },
        }));
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  /** Build the project if it has a build script, then find and check what would be uploaded. */
  async prepare(projectRoot: string): Promise<PreparedSite> {
    const link = await readLink(projectRoot);
    let manifest: { name?: string; scripts?: Record<string, string> } = {};
    try {
      manifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
    } catch {
      /* A plain HTML folder has no package.json. */
    }
    let built = false;
    if (typeof manifest.scripts?.build === "string") {
      const pm = packageManagerFor(projectRoot);
      if (!existsSync(path.join(projectRoot, "node_modules"))) {
        const install = await this.run(pm, ["install"], projectRoot);
        if (install.code !== 0 || install.timedOut)
          throw new SitePublishError(
            "build_failed",
            "Installing the site's packages failed.",
            tail(install),
          );
      }
      const build = await this.run(pm, ["run", "build"], projectRoot);
      if (build.code !== 0 || build.timedOut)
        throw new SitePublishError(
          "build_failed",
          build.timedOut ? "The build took longer than 5 minutes." : "The site's build failed.",
          tail(build),
        );
      built = true;
    }
    const outputDir =
      OUTPUT_DIRS.find((dir) => existsSync(path.join(projectRoot, dir, "index.html"))) ??
      (existsSync(path.join(projectRoot, "index.html")) ? "" : null);
    if (outputDir === null)
      throw new SitePublishError(
        "no_site",
        built
          ? 'The build finished but made no index.html. For Next.js set output: "export" in next.config.'
          : "This project has no index.html and no build script.",
      );
    const files = await listFiles(path.join(projectRoot, outputDir));
    const problem = localSiteProblem(files);
    if (problem) throw new SitePublishError("site_invalid", problem);
    return {
      projectRoot,
      outputDir,
      files,
      bytes: files.reduce((sum, f) => sum + f.size, 0),
      built,
      link,
      suggestedName: link?.name ?? suggestSiteName(manifest.name ?? path.basename(projectRoot)),
    };
  }

  async list(): Promise<
    (typeof CloudSiteListResponse.Type & { readonly signedIn: true }) | { readonly signedIn: false }
  > {
    const session = await readCloudSession(this.deps.secretsDir);
    if (!session) return { signedIn: false };
    return {
      ...(await this.client(session).get<typeof CloudSiteListResponse.Type>(
        "/v1/sites",
        session.token,
      )),
      signedIn: true,
    };
  }

  async nameAvailable(name: string): Promise<typeof CloudSiteNameAvailability.Type> {
    const session = await this.session();
    return this.client(session).get(
      `/v1/sites/name-available?name=${encodeURIComponent(name)}`,
      session.token,
    );
  }

  /** The project's linked site, if it still belongs to this account. */
  async linkedSite(projectRoot: string): Promise<typeof CloudSite.Type | null> {
    const link = await readLink(projectRoot);
    const session = await readCloudSession(this.deps.secretsDir);
    if (!link || !session) return null;
    try {
      return (
        await this.client(session).get<{ site: typeof CloudSite.Type }>(
          `/v1/sites/${link.siteId}`,
          session.token,
        )
      ).site;
    } catch (error) {
      if (error instanceof CloudApiError && error.detail.status === 404) return null;
      throw error;
    }
  }

  /**
   * Publish the project. The first publish claims `name` (and needs `acceptTerms`); later
   * publishes go to the linked site. Returns the site, whose `pendingDeploy` is set when
   * DJL held this version for review.
   */
  async publish(input: {
    readonly projectRoot: string;
    readonly name?: string;
    readonly acceptTerms?: boolean;
  }): Promise<typeof CloudSite.Type> {
    const session = await this.session();
    const client = this.client(session);
    const prepared = await this.prepare(input.projectRoot);
    const zip = await this.zip(prepared);
    if (zip.byteLength > CLOUD_SITE_MAX_ZIP_BYTES)
      throw new SitePublishError(
        "site_invalid",
        `The site is ${Math.ceil(zip.byteLength / 1024 ** 2)} MB zipped; the limit is 25 MB.`,
      );

    const site = (await this.linkedSite(input.projectRoot)) ?? (await this.claim(session, input));
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const created = await this.call(() =>
      client.post<typeof CloudCreateSiteDeployResponse.Type>(
        `/v1/sites/${site.id}/deploys`,
        { size: zip.byteLength, sha256 },
        session.token,
      ),
    );
    const upload = await this.fetchImpl(created.upload.url, {
      method: "PUT",
      headers: created.upload.headers,
      body: zip as Uint8Array<ArrayBuffer>,
      redirect: "error",
      signal: AbortSignal.timeout(5 * 60_000),
    });
    if (!upload.ok)
      throw new SitePublishError("cloud_error", `Uploading the site failed (${upload.status}).`);
    const done = await this.call(() =>
      client.post<{ site: typeof CloudSite.Type }>(
        `/v1/sites/${site.id}/deploys/${created.deploy.id}/complete`,
        {},
        session.token,
        2 * 60_000,
      ),
    );
    await writeFile(
      path.join(input.projectRoot, SITE_LINK_FILE),
      `${JSON.stringify({ siteId: done.site.id, name: done.site.name, url: done.site.url }, null, 2)}\n`,
    );
    return done.site;
  }

  async unpublish(siteId: string): Promise<typeof CloudSite.Type> {
    const session = await this.session();
    return (
      await this.call(() =>
        this.client(session).delete<{ site: typeof CloudSite.Type }>(
          `/v1/sites/${siteId}`,
          session.token,
        ),
      )
    ).site;
  }

  // ---- internals ------------------------------------------------------------------

  private async claim(
    session: CloudSession,
    input: { readonly name?: string; readonly acceptTerms?: boolean },
  ) {
    if (!input.name) throw new SitePublishError("name_required", "Choose a name for the site.");
    if (input.acceptTerms !== true)
      throw new SitePublishError("terms_required", "Accept the hosting terms to publish.");
    return (
      await this.call(() =>
        this.client(session).post<{ site: typeof CloudSite.Type }>(
          "/v1/sites",
          { name: input.name, acceptTerms: true },
          session.token,
        ),
      )
    ).site;
  }

  private async zip(prepared: PreparedSite): Promise<Uint8Array> {
    const zip = new JSZip();
    for (const file of prepared.files) zip.file(file.path, await readFile(file.absolute));
    return zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  private async session(): Promise<CloudSession> {
    const session = await readCloudSession(this.deps.secretsDir);
    if (!session) throw new SitePublishError("not_signed_in", "Sign in to DJL to publish sites.");
    return session;
  }

  private client(session: CloudSession) {
    return createCloudClient(session.apiBaseUrl, this.fetchImpl);
  }

  /** Cloud errors keep their code (site_name_taken, site_limit_reached, ...) for the card. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof CloudApiError) {
        if (error.detail.status === 401)
          throw new SitePublishError("not_signed_in", "Sign in to DJL again to publish.");
        throw new SitePublishError(error.detail.code, error.detail.message);
      }
      throw error;
    }
  }
}
