import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { writeCloudSession } from "../cloud/session";
import type { ProcessRunResult } from "../processRunner";
import {
  localSiteProblem,
  SITE_LINK_FILE,
  SitePublishError,
  SitePublisher,
  suggestSiteName,
} from "./sitePublisher";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function temp(label: string) {
  const dir = await mkdtemp(path.join(tmpdir(), `djl-site-${label}-`));
  dirs.push(dir);
  return dir;
}

async function signedIn() {
  const secrets = await temp("secrets");
  await writeCloudSession(secrets, {
    apiBaseUrl: "https://api.test",
    token: "tok",
    userId: "u1",
    email: "u@test.invalid",
    orgId: "o1",
    createdAt: new Date().toISOString(),
  });
  return secrets;
}

const site = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name,
  url: `https://${name}.slcor.site`,
  status: "active",
  liveDeploy: { id: "d1", status: "live", bytes: 1, fileCount: 1, createdAt: "", reason: null },
  pendingDeploy: null,
  createdAt: "",
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A fake DJL Cloud that records calls and keeps the uploaded zip. */
function fakeCloud(
  options: { linked?: boolean; createError?: { status: number; code: string } } = {},
) {
  const calls: string[] = [];
  let uploaded: Uint8Array | null = null;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.replace("https://api.test", "")}`);
    if (url.startsWith("https://blob.test/")) {
      uploaded = new Uint8Array(
        await new Response(init!.body as Uint8Array<ArrayBuffer>).arrayBuffer(),
      );
      return new Response(null, { status: 200 });
    }
    if (method === "GET" && url.includes("/v1/sites/11111111"))
      return options.linked
        ? json({ site: site("bakery") })
        : json({ error: { code: "not_found", message: "Not found." } }, 404);
    if (method === "POST" && url.endsWith("/v1/sites")) {
      if (options.createError)
        return json(
          { error: { code: options.createError.code, message: "No." } },
          options.createError.status,
        );
      const body = JSON.parse(String(init!.body)) as { name: string };
      return json({ site: site(body.name, { liveDeploy: null }) }, 201);
    }
    if (method === "POST" && url.endsWith("/deploys"))
      return json(
        {
          deploy: {
            id: "d2",
            status: "uploading",
            bytes: 0,
            fileCount: 0,
            createdAt: "",
            reason: null,
          },
          upload: {
            url: "https://blob.test/put",
            method: "PUT",
            headers: { "content-type": "application/zip" },
            expiresAt: "",
          },
        },
        201,
      );
    if (method === "POST" && url.endsWith("/complete")) return json({ site: site("bakery") });
    return json({ error: { code: "unexpected", message: url } }, 500);
  };
  return { fetchImpl, calls, uploaded: () => uploaded };
}

const ok = (stdout = ""): ProcessRunResult => ({
  stdout,
  stderr: "",
  code: 0,
  signal: null,
  timedOut: false,
});

describe("suggestSiteName", () => {
  it("turns folder and project names into valid site names", () => {
    expect(suggestSiteName("My Bakery!")).toBe("my-bakery");
    expect(suggestSiteName("Café  Crème")).toBe("cafe-creme");
    expect(suggestSiteName("@acme/landing-page")).toBe("acme-landing-page");
    expect(suggestSiteName("面包店")).toMatch(/^site-[0-9a-f]{6}$/);
  });
});

describe("localSiteProblem", () => {
  it("matches the cloud's rules", () => {
    expect(localSiteProblem([{ path: "about.html", size: 1 }])).toMatch(/index\.html/);
    expect(
      localSiteProblem([
        { path: "index.html", size: 1 },
        { path: "run.sh", size: 1 },
      ]),
    ).toMatch(/run\.sh/);
    expect(
      localSiteProblem([
        { path: "index.html", size: 1 },
        { path: "_djl/x.html", size: 1 },
      ]),
    ).toMatch(/reserved/);
    expect(
      localSiteProblem([
        { path: "index.html", size: 1 },
        { path: "_next/static/a.js", size: 1 },
      ]),
    ).toBeNull();
  });
});

describe("SitePublisher", () => {
  it("publishes a plain HTML folder, claiming the name, and links the project", async () => {
    const project = await temp("plain");
    await writeFile(path.join(project, "index.html"), "<h1>Hi</h1>");
    await writeFile(path.join(project, ".DS_Store"), "x");
    await mkdir(path.join(project, "img"));
    await writeFile(path.join(project, "img", "logo.png"), "png");
    const cloud = fakeCloud();
    const publisher = new SitePublisher({
      secretsDir: await signedIn(),
      fetchImpl: cloud.fetchImpl,
    });

    const result = await publisher.publish({
      projectRoot: project,
      name: "bakery",
      acceptTerms: true,
    });
    expect(result.url).toBe("https://bakery.slcor.site");
    expect(cloud.calls).toEqual([
      "POST /v1/sites",
      "POST /v1/sites/11111111-1111-4111-8111-111111111111/deploys",
      "PUT https://blob.test/put",
      "POST /v1/sites/11111111-1111-4111-8111-111111111111/deploys/d2/complete",
    ]);
    const zip = await JSZip.loadAsync(cloud.uploaded()!);
    expect(
      Object.keys(zip.files)
        .filter((n) => !zip.files[n]!.dir)
        .toSorted(),
    ).toEqual(["img/logo.png", "index.html"]);
    const link = JSON.parse(await readFile(path.join(project, SITE_LINK_FILE), "utf8"));
    expect(link).toEqual({
      siteId: "11111111-1111-4111-8111-111111111111",
      name: "bakery",
      url: "https://bakery.slcor.site",
    });
  });

  it("republishes to the linked site without asking for a name", async () => {
    const project = await temp("linked");
    await writeFile(path.join(project, "index.html"), "<h1>v2</h1>");
    await writeFile(
      path.join(project, SITE_LINK_FILE),
      JSON.stringify({ siteId: "11111111-1111-4111-8111-111111111111", name: "bakery", url: "x" }),
    );
    const cloud = fakeCloud({ linked: true });
    const publisher = new SitePublisher({
      secretsDir: await signedIn(),
      fetchImpl: cloud.fetchImpl,
    });
    await publisher.publish({ projectRoot: project });
    expect(cloud.calls[0]).toBe("GET /v1/sites/11111111-1111-4111-8111-111111111111");
    expect(cloud.calls).not.toContain("POST /v1/sites");
  });

  it("builds with the project's package manager and uploads the export folder", async () => {
    const project = await temp("next");
    await writeFile(
      path.join(project, "package.json"),
      JSON.stringify({ name: "Shop Site", scripts: { build: "next build" } }),
    );
    await writeFile(path.join(project, "pnpm-lock.yaml"), "");
    await mkdir(path.join(project, "node_modules"));
    const runs: string[] = [];
    const publisher = new SitePublisher({
      secretsDir: await signedIn(),
      fetchImpl: fakeCloud().fetchImpl,
      run: async (command, args, cwd) => {
        runs.push(`${command} ${args.join(" ")}`);
        await mkdir(path.join(cwd, "out"), { recursive: true });
        await writeFile(path.join(cwd, "out", "index.html"), "<h1>Built</h1>");
        return ok();
      },
    });
    const prepared = await publisher.prepare(project);
    expect(runs).toEqual(["pnpm run build"]);
    expect(prepared).toMatchObject({ outputDir: "out", built: true, suggestedName: "shop-site" });
    expect(prepared.files.map((f) => f.path)).toEqual(["index.html"]);
  });

  it("explains a failed build with the end of its output", async () => {
    const project = await temp("broken");
    await writeFile(
      path.join(project, "package.json"),
      JSON.stringify({ scripts: { build: "next build" } }),
    );
    await mkdir(path.join(project, "node_modules"));
    const publisher = new SitePublisher({
      secretsDir: await signedIn(),
      run: async () => ({ ...ok("Compiling..."), code: 1, stderr: "Type error: x is not defined" }),
    });
    const error = (await publisher.prepare(project).catch((e: unknown) => e)) as SitePublishError;
    expect(error).toBeInstanceOf(SitePublishError);
    expect(error.code).toBe("build_failed");
    expect(error.log).toContain("Type error");
  });

  it("asks for Next.js static export when a build makes no index.html", async () => {
    const project = await temp("noexport");
    await writeFile(
      path.join(project, "package.json"),
      JSON.stringify({ scripts: { build: "next build" } }),
    );
    await mkdir(path.join(project, "node_modules"));
    const publisher = new SitePublisher({ secretsDir: await signedIn(), run: async () => ok() });
    const error = (await publisher.prepare(project).catch((e: unknown) => e)) as SitePublishError;
    expect(error.code).toBe("no_site");
    expect(error.message).toContain('output: "export"');
  });

  it("needs a signed-in account, a name and accepted terms for the first publish", async () => {
    const project = await temp("first");
    await writeFile(path.join(project, "index.html"), "<h1>Hi</h1>");
    const signedOut = new SitePublisher({ secretsDir: await temp("nosecrets") });
    expect(
      (
        (await signedOut
          .publish({ projectRoot: project })
          .catch((e: unknown) => e)) as SitePublishError
      ).code,
    ).toBe("not_signed_in");
    const publisher = new SitePublisher({
      secretsDir: await signedIn(),
      fetchImpl: fakeCloud().fetchImpl,
    });
    expect(
      (
        (await publisher
          .publish({ projectRoot: project })
          .catch((e: unknown) => e)) as SitePublishError
      ).code,
    ).toBe("name_required");
    expect(
      (
        (await publisher
          .publish({ projectRoot: project, name: "bakery" })
          .catch((e: unknown) => e)) as SitePublishError
      ).code,
    ).toBe("terms_required");
  });

  it("keeps the cloud's error code, such as the site limit", async () => {
    const project = await temp("limit");
    await writeFile(path.join(project, "index.html"), "<h1>Hi</h1>");
    const publisher = new SitePublisher({
      secretsDir: await signedIn(),
      fetchImpl: fakeCloud({ createError: { status: 403, code: "site_limit_reached" } }).fetchImpl,
    });
    const error = (await publisher
      .publish({ projectRoot: project, name: "bakery", acceptTerms: true })
      .catch((e: unknown) => e)) as SitePublishError;
    expect(error.code).toBe("site_limit_reached");
  });
});
