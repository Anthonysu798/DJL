import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PluginSource, isPluginInstalled, findPluginCatalogEntry } from "@djl/contracts";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { DJL_PLUGIN_SOURCE } from "./catalog";
import { HOSTED_PLUGINS } from "./hostedPlugins";
import { PluginConnections, type PluginSecrets } from "./PluginConnections";
import { PluginStore } from "./PluginStore";

function memorySecrets(): PluginSecrets & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => void values.set(name, value),
    remove: async (name) => void values.delete(name),
  };
}
const connections = () => new PluginConnections(memorySecrets());

const temporaryDirectories: string[] = [];

async function makeStateDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "djl-plugins-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("bundled plugin catalog", () => {
  it("matches the contract and has unique ids and mention names", () => {
    Schema.decodeUnknownSync(PluginSource)(DJL_PLUGIN_SOURCE);
    const ids = DJL_PLUGIN_SOURCE.plugins.map((plugin) => plugin.id);
    const names = DJL_PLUGIN_SOURCE.plugins.map((plugin) => plugin.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only points hosted apps at https servers, and tells the user where to make a token", () => {
    const hosted = DJL_PLUGIN_SOURCE.plugins.filter((plugin) => !plugin.builtIn);
    expect(hosted.length).toBeGreaterThan(0);
    for (const plugin of hosted) {
      expect(plugin.examplePrompts).toHaveLength(3);
      for (const app of plugin.apps) {
        expect(["oauth", "none", "apiKey"]).toContain(app.auth);
        expect(app.transport.type === "http" && app.transport.url.startsWith("https://")).toBe(
          true,
        );
        if (app.auth === "apiKey") {
          expect(app.tokenUrl?.startsWith("https://")).toBe(true);
          expect(app.tokenScopes?.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("offers GitHub through its remote server with a GitHub sign-in, not a pasted token", () => {
    const github = DJL_PLUGIN_SOURCE.plugins.find((plugin) => plugin.id === "github");
    expect(github?.apps).toEqual([
      expect.objectContaining({
        auth: "oauth",
        transport: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      }),
    ]);
    expect(github?.apps[0]).not.toHaveProperty("tokenUrl");
    expect(HOSTED_PLUGINS.find((plugin) => plugin.id === "github")?.oauthClient?.scopes).toEqual([
      "repo",
      "read:org",
      "read:user",
    ]);
  });

  it("ships DJL's own GitHub OAuth app, so GitHub sign-in is set up in every build", () => {
    // GitHub OAuth app client ids: "Ov23" + 16 characters, or 20 hex digits for older apps.
    expect(HOSTED_PLUGINS.find((plugin) => plugin.id === "github")?.oauthClient?.clientId).toMatch(
      /^(Ov23[0-9A-Za-z]{16}|[0-9a-f]{20})$/,
    );
  });

  it("keeps the built-in plugins but not the retired social plugin", () => {
    const builtIn = DJL_PLUGIN_SOURCE.plugins.filter((plugin) => plugin.builtIn);
    expect(builtIn.map((plugin) => plugin.id).toSorted()).toEqual([
      "djl-computer-use",
      "djl-excel",
      "djl-multipost",
      "djl-pdf",
      "djl-powerpoint",
      "djl-word",
    ]);
  });
});

describe("PluginStore", () => {
  it("starts with nothing added and treats built-in plugins as installed", async () => {
    const snapshot = await new PluginStore(await makeStateDir(), connections()).snapshot();
    expect(snapshot.installed).toEqual([]);
    expect(snapshot.connections).toEqual([]);
    expect(isPluginInstalled(snapshot, findPluginCatalogEntry(snapshot, "djl-multipost")!)).toBe(
      true,
    );
    expect(isPluginInstalled(snapshot, findPluginCatalogEntry(snapshot, "linear")!)).toBe(false);
  });

  it("adds a plugin, reports its app as not connected, and survives a restart", async () => {
    const stateDir = await makeStateDir();
    const added = await new PluginStore(stateDir, connections()).install("linear");
    expect(added.installed.map((item) => [item.pluginId, item.enabled])).toEqual([
      ["linear", true],
    ]);
    expect(added.connections).toEqual([
      { pluginId: "linear", appId: "linear", state: "not_connected" },
    ]);

    const reloaded = await new PluginStore(stateDir, connections()).snapshot();
    expect(reloaded.installed).toEqual(added.installed);
  });

  it("adding twice or adding a built-in plugin changes nothing", async () => {
    const store = new PluginStore(await makeStateDir(), connections());
    const first = await store.install("linear");
    expect(await store.install("linear")).toEqual(first);
    expect((await store.install("djl-multipost")).installed).toEqual(first.installed);
  });

  it("offers a plugin that needs no sign-in to agents as soon as it is added", async () => {
    const store = new PluginStore(await makeStateDir(), connections());
    const snapshot = await store.install("context7");
    expect(snapshot.connections).toEqual([
      { pluginId: "context7", appId: "context7", state: "connected" },
    ]);
    expect(await store.gatewayApps()).toEqual([
      { key: "context7", pluginId: "context7", url: "https://mcp.context7.com/mcp" },
    ]);
  });

  it("rejects a plugin that is not in the catalog", async () => {
    const store = new PluginStore(await makeStateDir(), connections());
    await expect(store.install("not-a-plugin")).rejects.toThrow("Unknown plugin: not-a-plugin");
  });

  it("disables and uninstalls", async () => {
    const stateDir = await makeStateDir();
    const store = new PluginStore(stateDir, connections());
    await store.install("linear");
    await store.install("notion");
    expect((await store.setEnabled("linear", false)).installed[0]).toMatchObject({
      pluginId: "linear",
      enabled: false,
    });
    await expect(store.setEnabled("sentry", false)).rejects.toThrow("Plugin is not added: sentry");

    const afterUninstall = await store.uninstall("linear");
    expect(afterUninstall.installed.map((item) => item.pluginId)).toEqual(["notion"]);
    expect(afterUninstall.connections.map((item) => item.pluginId)).toEqual(["notion"]);
    const onDisk = JSON.parse(await readFile(join(stateDir, "plugins.json"), "utf8")) as {
      installed: Array<{ pluginId: string }>;
    };
    expect(onDisk.installed.map((item) => item.pluginId)).toEqual(["notion"]);
  });

  it("offers agents only apps that are added, enabled and connected", async () => {
    const app = (id: string, auth: "none" | "oauth") => ({
      id,
      name: id,
      transport: { type: "http" as const, url: `https://${id}.example/mcp` },
      auth,
    });
    const plugin = (id: string, apps: ReturnType<typeof app>[]) => ({
      ...DJL_PLUGIN_SOURCE.plugins.find((item) => item.id === "linear")!,
      id,
      name: id,
      apps,
    });
    const store = new PluginStore(await makeStateDir(), connections(), [
      {
        id: "test",
        kind: "djl",
        name: "Test",
        plugins: [
          plugin("open", [app("open", "none")]),
          plugin("suite", [app("docs", "none"), app("mail", "oauth")]),
          plugin("unused", [app("unused", "none")]),
        ],
      },
    ]);
    expect(await store.gatewayApps()).toEqual([]);

    await store.install("open");
    await store.install("suite");
    expect(await store.gatewayApps()).toEqual([
      { key: "open", pluginId: "open", url: "https://open.example/mcp" },
      { key: "suite_docs", pluginId: "suite", url: "https://docs.example/mcp" },
    ]);

    await store.setEnabled("open", false);
    expect((await store.gatewayApps()).map((item) => item.key)).toEqual(["suite_docs"]);
  });

  it("surfaces an unreadable state file instead of overwriting it", async () => {
    const stateDir = await makeStateDir();
    await writeFile(join(stateDir, "plugins.json"), "{ not json");
    const store = new PluginStore(stateDir, connections());
    await expect(store.snapshot()).rejects.toThrow();
    await expect(store.install("linear")).rejects.toThrow();
    expect(await readFile(join(stateDir, "plugins.json"), "utf8")).toBe("{ not json");
  });
});

describe("PluginStore custom servers", () => {
  const initialized = () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "x" } } }), {
      status: 200,
    });
  // Only the call itself is used, not the extras a runtime hangs on `fetch`.
  const fake = (handler: (url: unknown, init?: RequestInit) => Promise<Response>) =>
    handler as unknown as typeof fetch;
  const openServer = fake(async () => initialized());
  /** Answers only when the request carries the right bearer token. */
  const tokenServer = (token: string) =>
    fake(async (_url, init) =>
      new Headers(init?.headers).get("authorization") === `Bearer ${token}`
        ? initialized()
        : new Response("", { status: 401 }),
    );

  it("adds an open server as a personal plugin that agents can use at once", async () => {
    const stateDir = await makeStateDir();
    const store = new PluginStore(stateDir, connections());
    const snapshot = await store.addCustomServer(
      { name: "My Tools", url: "https://tools.example/mcp" },
      openServer,
    );
    const personal = snapshot.sources.find((source) => source.kind === "personal");
    expect(personal?.plugins.map((plugin) => [plugin.id, plugin.displayName])).toEqual([
      ["custom-my-tools", "My Tools"],
    ]);
    expect(snapshot.connections).toEqual([
      { pluginId: "custom-my-tools", appId: "custom-my-tools", state: "connected" },
    ]);
    expect(await store.gatewayApps()).toEqual([
      { key: "custom-my-tools", pluginId: "custom-my-tools", url: "https://tools.example/mcp" },
    ]);

    const reloaded = await new PluginStore(stateDir, connections()).snapshot();
    expect(reloaded.sources.find((source) => source.kind === "personal")?.plugins).toHaveLength(1);
  });

  it("keeps a typed-in access token out of the state file and sends it to the server", async () => {
    const stateDir = await makeStateDir();
    const secrets = memorySecrets();
    const store = new PluginStore(stateDir, new PluginConnections(secrets));
    await store.addCustomServer(
      { name: "Private", url: "https://private.example/mcp", accessToken: " secret-token " },
      tokenServer("secret-token"),
    );
    expect(await readFile(join(stateDir, "plugins.json"), "utf8")).not.toContain("secret-token");
    const [app] = await store.gatewayApps();
    expect(await app?.headers?.()).toEqual({ authorization: "Bearer secret-token" });

    const after = await store.uninstall("custom-private");
    expect(after.sources.some((source) => source.kind === "personal")).toBe(false);
    expect(secrets.values.size).toBe(0);
  });

  it("refuses a server it cannot use, with the reason", async () => {
    const store = new PluginStore(await makeStateDir(), connections());
    const add = (url: string, fetchFn: typeof fetch, accessToken?: string) =>
      store.addCustomServer({ name: "X", url, ...(accessToken ? { accessToken } : {}) }, fetchFn);
    await expect(add("http://tools.example/mcp", openServer)).rejects.toThrow("https://");
    await expect(add("not a url", openServer)).rejects.toThrow("full address");
    await expect(add("https://a.example/mcp", tokenServer("right"), "wrong")).rejects.toThrow(
      "refused this access token",
    );
    await expect(add("https://a.example/mcp", tokenServer("right"))).rejects.toThrow(
      "needs an access token",
    );
    await expect(
      add(
        "https://a.example/mcp",
        fake(async () => {
          throw new Error("offline");
        }),
      ),
    ).rejects.toThrow("could not reach");
    await expect(add("https://mcp.linear.app/mcp", openServer)).rejects.toThrow("already");
    expect((await store.snapshot()).installed).toEqual([]);
  });

  it("accepts a server on this computer over plain http and gives clashing names their own id", async () => {
    const store = new PluginStore(await makeStateDir(), connections());
    await store.addCustomServer({ name: "Local", url: "http://localhost:8123/mcp" }, openServer);
    const snapshot = await store.addCustomServer(
      { name: "Local", url: "http://127.0.0.1:9000/mcp" },
      openServer,
    );
    expect(snapshot.installed.map((item) => item.pluginId)).toEqual([
      "custom-local",
      "custom-local-2",
    ]);
  });
});

// Only the call itself is used, not the extras a runtime hangs on `fetch`.
const fakeFetch = (handler: (url: string, init?: RequestInit) => Promise<Response>) =>
  (async (url: unknown, init?: RequestInit) =>
    handler(String(url), init)) as unknown as typeof fetch;
const initializeResult = () =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "x" } } }));
/** Open servers answer; `oauth.` hosts want a sign-in DJL can register for; `token.` hosts
 * answer only with the bearer "right"; `down.` hosts are unreachable. */
const toolServers = fakeFetch(async (url, init) => {
  const { hostname, pathname } = new URL(url);
  if (hostname.startsWith("down.")) throw new Error("offline");
  if (
    pathname.startsWith("/.well-known/oauth-authorization-server") &&
    hostname.startsWith("oauth.")
  ) {
    return Response.json({
      authorization_endpoint: `https://${hostname}/authorize`,
      token_endpoint: `https://${hostname}/token`,
      registration_endpoint: `https://${hostname}/register`,
    });
  }
  if (pathname.startsWith("/.well-known/")) return new Response("", { status: 404 });
  if (hostname.startsWith("oauth.")) return new Response("", { status: 401 });
  if (hostname.startsWith("token.")) {
    return new Headers(init?.headers).get("authorization") === "Bearer right"
      ? initializeResult()
      : new Response("", { status: 401 });
  }
  return initializeResult();
});

describe("PluginStore GitHub sign-in", () => {
  /** GitHub as DJL meets it: metadata, then a device code, then "still waiting" on every poll. */
  function fakeGitHub() {
    const requests: Array<{ url: string; body: string }> = [];
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const body = init?.body;
      requests.push({
        url,
        body: typeof body === "string" || body instanceof URLSearchParams ? String(body) : "",
      });
      if (url === "https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp") {
        return json({ authorization_servers: ["https://github.com/login/oauth"] });
      }
      if (url === "https://github.com/.well-known/oauth-authorization-server/login/oauth") {
        return json({
          authorization_endpoint: "https://github.com/login/oauth/authorize",
          token_endpoint: "https://github.com/login/oauth/access_token",
          device_authorization_endpoint: "https://github.com/login/device/code",
        });
      }
      if (url === "https://github.com/login/device/code") {
        return json({
          device_code: "device-1",
          user_code: "WDJB-MJHT",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      }
      if (url === "https://github.com/login/oauth/access_token") {
        return json({ error: "authorization_pending" });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    return { fetchFn, requests };
  }

  it("starts on github.com with DJL's own client: a code to confirm, no token, no secret", async () => {
    const github = fakeGitHub();
    // Polling waits forever here: the test is about how sign-in starts.
    const store = new PluginStore(
      await makeStateDir(),
      new PluginConnections(memorySecrets(), github.fetchFn, () => new Promise(() => {})),
    );
    await store.install("github");

    const started = await store.connect("github", "github", "http://127.0.0.1:1/oauth/callback");

    expect(started).toEqual({
      authorizeUrl: "https://github.com/login/device",
      userCode: "WDJB-MJHT",
    });
    const deviceRequest = github.requests.find((request) =>
      request.url.endsWith("/login/device/code"),
    );
    const sent = Object.fromEntries(new URLSearchParams(deviceRequest?.body));
    expect(sent).toEqual({
      client_id: HOSTED_PLUGINS.find((plugin) => plugin.id === "github")?.oauthClient?.clientId,
      scope: "repo read:org read:user",
    });
    expect(sent.client_id).toBeTruthy();
    expect(github.requests.some((request) => request.body.includes("client_secret"))).toBe(false);
    const snapshot = await store.snapshot();
    expect(snapshot.connections).toContainEqual(
      expect.objectContaining({ pluginId: "github", appId: "github", state: "connecting" }),
    );
  });
});

describe("PluginStore access-token apps", () => {
  it("refuses a token for an app that signs in, or a plugin that is not added", async () => {
    const store = new PluginStore(await makeStateDir(), connections());
    await expect(
      store.saveAppToken({ pluginId: "github", appId: "github", token: "x" }, toolServers),
    ).rejects.toThrow("not added");
    for (const pluginId of ["linear", "github"]) {
      await store.install(pluginId);
      await expect(
        store.saveAppToken({ pluginId, appId: pluginId, token: "x" }, toolServers),
      ).rejects.toThrow("does not take an access token");
    }
  });
});

const manifest = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "acme",
    name: "acme",
    displayName: "Acme",
    shortDescription: "Work with Acme",
    category: "Design",
    examplePrompts: ["List my Acme items"],
    mcpServers: [
      { name: "Docs", url: "https://open.acme.example/mcp" },
      { name: "Mail", url: "https://oauth.acme.example/mcp" },
      { name: "Admin", url: "https://token.acme.example/mcp" },
    ],
    skills: [{ name: "Acme report", description: "Weekly report", instructions: "Write it." }],
    ...overrides,
  });

describe("PluginStore uploaded plugins", () => {
  it("adds a manifest as a personal plugin, probing each server for how it signs in", async () => {
    const stateDir = await makeStateDir();
    const skillsDir = join(stateDir, "skills");
    const store = new PluginStore(stateDir, connections(), undefined, skillsDir);
    const { snapshot, pluginId } = await store.importManifest(manifest(), toolServers);
    expect(pluginId).toBe("personal-acme");
    const personal = snapshot.sources.find((source) => source.kind === "personal");
    const plugin = personal?.plugins.find((item) => item.id === pluginId);
    expect(plugin).toMatchObject({ displayName: "Acme", category: "Personal", name: "acme" });
    expect(plugin?.apps.map((app) => [app.id, app.auth])).toEqual([
      ["docs", "none"],
      ["mail", "oauth"],
      ["admin", "apiKey"],
    ]);
    expect(plugin?.skills).toEqual([{ name: "acme-report", description: "Weekly report" }]);
    expect(await readFile(join(skillsDir, "acme-report", "SKILL.md"), "utf8")).toContain(
      "Write it.",
    );
    // Only the open server is usable until the others are connected.
    expect(await store.gatewayApps()).toEqual([
      {
        key: "personal-acme_docs",
        pluginId: "personal-acme",
        url: "https://open.acme.example/mcp",
      },
    ]);

    const reloaded = await new PluginStore(stateDir, connections()).snapshot();
    expect(findPluginCatalogEntry(reloaded, pluginId)?.apps).toHaveLength(3);

    const after = await store.uninstall(pluginId);
    expect(findPluginCatalogEntry(after, pluginId)).toBeUndefined();
    await expect(readFile(join(skillsDir, "acme-report", "SKILL.md"), "utf8")).rejects.toThrow();
  });

  it("leaves a skill the user already had in place, even on uninstall", async () => {
    const stateDir = await makeStateDir();
    const skillsDir = join(stateDir, "skills");
    await mkdir(join(skillsDir, "acme-report"), { recursive: true });
    await writeFile(join(skillsDir, "acme-report", "SKILL.md"), "mine");
    const store = new PluginStore(stateDir, connections(), undefined, skillsDir);
    const { pluginId } = await store.importManifest(manifest(), toolServers);
    await store.uninstall(pluginId);
    expect(await readFile(join(skillsDir, "acme-report", "SKILL.md"), "utf8")).toBe("mine");
  });

  it("refuses invalid JSON, invalid manifests, duplicates and unreachable servers", async () => {
    const store = new PluginStore(await makeStateDir(), connections());
    await expect(store.importManifest("{", toolServers)).rejects.toThrow("not valid JSON");
    await expect(store.importManifest(manifest({ id: "Bad id" }), toolServers)).rejects.toThrow(
      /not valid[\s\S]*id: Use up to 63/,
    );
    await expect(
      store.importManifest(
        manifest({ mcpServers: [{ name: "X", url: "https://down.acme.example/mcp" }] }),
        toolServers,
      ),
    ).rejects.toThrow("X: DJL could not reach that address.");
    expect((await store.snapshot()).installed).toEqual([]);

    await store.importManifest(manifest(), toolServers);
    await expect(store.importManifest(manifest(), toolServers)).rejects.toThrow("already");
  });
});

const marketplaceFetch = (files: Record<string, unknown>) =>
  fakeFetch(async (url, init) =>
    url in files
      ? new Response(JSON.stringify(files[url]))
      : (toolServers as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init),
  );
const MARKET_URL = "https://market.example/plugins.json";
const listing = (plugins: unknown[]) => ({ name: "Acme Market", plugins });

describe("PluginStore marketplaces", () => {
  it("adds a marketplace as its own source, skipping invalid manifests", async () => {
    const store = new PluginStore(await makeStateDir(), connections());
    const result = await store.addMarketplace(
      { url: MARKET_URL },
      marketplaceFetch({
        [MARKET_URL]: listing([
          JSON.parse(manifest()),
          { id: "broken" },
          JSON.parse(manifest({ id: "linear", name: "linear", displayName: "Fake Linear" })),
        ]),
      }),
    );
    expect(result).toMatchObject({ sourceId: "market-acme-market", added: 2, skipped: 1 });
    const source = result.snapshot.sources.find((item) => item.kind === "marketplace");
    expect(source).toMatchObject({
      id: "market-acme-market",
      name: "Acme Market",
      url: MARKET_URL,
    });
    expect(source?.plugins.map((plugin) => plugin.id)).toEqual([
      "market-acme-market--acme",
      "market-acme-market--linear",
    ]);
    // A marketplace cannot stand in for a catalog plugin.
    expect(findPluginCatalogEntry(result.snapshot, "linear")?.displayName).toBe("Linear");
    expect(result.snapshot.installed).toEqual([]);
  });

  it("probes servers when a marketplace plugin is added, and keeps what was added on refresh", async () => {
    const stateDir = await makeStateDir();
    const store = new PluginStore(stateDir, connections(), undefined, join(stateDir, "skills"));
    await store.addMarketplace(
      { url: MARKET_URL },
      marketplaceFetch({ [MARKET_URL]: listing([JSON.parse(manifest())]) }),
    );
    const id = "market-acme-market--acme";
    const installed = await store.install(id, toolServers);
    expect(findPluginCatalogEntry(installed, id)?.apps.map((app) => app.auth)).toEqual([
      "none",
      "oauth",
      "apiKey",
    ]);
    expect(await store.gatewayApps()).toEqual([
      { key: `${id}_docs`, pluginId: id, url: "https://open.acme.example/mcp" },
    ]);

    // The listing now points the plugin somewhere else; what the user added does not follow.
    const moved = JSON.parse(
      manifest({ mcpServers: [{ name: "Docs", url: "https://open.elsewhere.example/mcp" }] }),
    );
    const refreshed = await store.refreshMarketplace(
      { sourceId: "market-acme-market" },
      marketplaceFetch({ [MARKET_URL]: listing([moved, { id: "x" }]) }),
    );
    expect(refreshed).toMatchObject({ added: 1, skipped: 1 });
    expect(await store.gatewayApps()).toEqual([
      { key: `${id}_docs`, pluginId: id, url: "https://open.acme.example/mcp" },
    ]);

    const removed = await store.removeMarketplace({ sourceId: "market-acme-market" });
    expect(removed.sources.some((source) => source.kind === "marketplace")).toBe(false);
    expect(removed.installed).toEqual([]);
  });

  it("refuses an address it cannot use and a marketplace added twice", async () => {
    const store = new PluginStore(await makeStateDir(), connections());
    const files = marketplaceFetch({
      [MARKET_URL]: listing([]),
      "https://market.example/bad.json": { plugins: [] },
    });
    await expect(store.addMarketplace({ url: "http://market.example/x" }, files)).rejects.toThrow(
      "https://",
    );
    await expect(
      store.addMarketplace({ url: "https://market.example/bad.json" }, files),
    ).rejects.toThrow("needs a name and a list of plugins");
    await store.addMarketplace({ url: MARKET_URL }, files);
    await expect(store.addMarketplace({ url: MARKET_URL }, files)).rejects.toThrow("already");
  });
});
