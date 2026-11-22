// FILE: PluginStore.ts
// Purpose: Which plugins the user has added, persisted in <stateDir>/plugins.json, and the
//          snapshot the UI renders from.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  InstalledPlugin,
  PluginAppAuthType,
  findPluginCatalogEntry,
  pluginAppKey,
  type PluginAppConnection,
  type PluginAppTokenInput,
  type PluginCatalogEntry,
  type PluginCustomServerInput,
  type PluginImportResult,
  type PluginManifest,
  type PluginMarketplaceInput,
  type PluginMarketplaceResult,
  type PluginSource,
  type PluginSourceInput,
  type PluginsSnapshot,
} from "@djl/contracts";
import { Schema } from "effect";

import { DJL_PLUGIN_SOURCE } from "./catalog";
import { createSkill, SkillExistsError } from "./createSkill";
import { parseCustomServerUrl, probeCustomServer, probeServerAuth } from "./customServer";
import {
  ManifestPluginRecord,
  MarketplaceRecord,
  PERSONAL_SOURCE_ID,
  manifestApps,
  manifestEntry,
  marketplacePluginId,
  personalPluginId,
  slugify,
} from "./manifestPlugins";
import { HOSTED_PLUGINS } from "./hostedPlugins";
import { fetchMarketplace, parseManifestText, parseMarketplaceUrl } from "./marketplace";
import type { PluginConnections } from "./PluginConnections";
import type { GatewayApp } from "./PluginGateway";

/** A tool server the user added by address. It shows up as a plugin of its own. */
const CustomServer = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  auth: PluginAppAuthType,
});
type CustomServer = typeof CustomServer.Type;

const PluginStoreFile = Schema.Struct({
  installed: Schema.Array(InstalledPlugin),
  customServers: Schema.optional(Schema.Array(CustomServer)),
  manifestPlugins: Schema.optional(Schema.Array(ManifestPluginRecord)),
  marketplaces: Schema.optional(Schema.Array(MarketplaceRecord)),
});
interface StoreState {
  readonly installed: ReadonlyArray<InstalledPlugin>;
  readonly customServers: ReadonlyArray<CustomServer>;
  readonly manifestPlugins: ReadonlyArray<ManifestPluginRecord>;
  readonly marketplaces: ReadonlyArray<MarketplaceRecord>;
}

const recordEntry = (record: ManifestPluginRecord, sourceName: string) =>
  manifestEntry({
    id: record.id,
    manifest: record.manifest,
    personal: record.sourceId === PERSONAL_SOURCE_ID,
    sourceName,
    apps: record.apps,
  });

/** A marketplace's listing, with the plugins the user added shown as they were added. */
const marketplaceSource = (
  marketplace: MarketplaceRecord,
  records: ReadonlyArray<ManifestPluginRecord>,
): PluginSource => {
  const added = records.filter((record) => record.sourceId === marketplace.id);
  const listed = marketplace.plugins.map((manifest) => {
    const id = marketplacePluginId(marketplace.id, manifest.id);
    const record = added.find((item) => item.id === id);
    return record
      ? recordEntry(record, marketplace.name)
      : manifestEntry({ id, manifest, personal: false, sourceName: marketplace.name });
  });
  // Added plugins the listing dropped stay visible, so they can still be uninstalled.
  const dropped = added
    .filter((record) => !listed.some((entry) => entry.id === record.id))
    .map((record) => recordEntry(record, marketplace.name));
  return {
    id: marketplace.id,
    kind: "marketplace",
    name: marketplace.name,
    url: marketplace.url,
    plugins: [...listed, ...dropped],
  };
};

const customServerEntry = (server: CustomServer): PluginCatalogEntry => {
  const url = new URL(server.url);
  return {
    id: server.id,
    name: server.id,
    displayName: server.name,
    shortDescription: url.host,
    category: "Personal",
    featured: false,
    builtIn: false,
    developer: url.host,
    version: "1.0.0",
    capabilities: [],
    examplePrompts: [],
    apps: [
      {
        id: server.id,
        name: server.name,
        description: url.host,
        transport: { type: "http", url: server.url },
        auth: server.auth,
      },
    ],
    skills: [],
  };
};

export class PluginStoreError extends Error {}

export class PluginStore {
  readonly #path: string;
  readonly #sources: ReadonlyArray<PluginSource>;
  #state: StoreState | null = null;
  #write = Promise.resolve();

  readonly #connections: PluginConnections;
  /** Where plugin skills are written; without it, plugin skills are not installed. */
  readonly #skillsDir: string | undefined;

  constructor(
    stateDir: string,
    connections: PluginConnections,
    sources: ReadonlyArray<PluginSource> = [DJL_PLUGIN_SOURCE],
    skillsDir?: string,
  ) {
    this.#path = join(stateDir, "plugins.json");
    this.#connections = connections;
    this.#sources = sources;
    this.#skillsDir = skillsDir;
  }

  /** The tool servers an agent may call right now: added, enabled, and connected. */
  async gatewayApps(): Promise<ReadonlyArray<GatewayApp>> {
    const snapshot = await this.snapshot();
    const apps: GatewayApp[] = [];
    for (const { pluginId, enabled } of snapshot.installed) {
      if (!enabled) continue;
      for (const app of findPluginCatalogEntry(snapshot, pluginId)?.apps ?? []) {
        const connected = snapshot.connections.some(
          (connection) =>
            connection.pluginId === pluginId &&
            connection.appId === app.id &&
            connection.state === "connected",
        );
        if (connected && app.transport.type === "http") {
          const connections = this.#connections;
          apps.push({
            key: pluginAppKey(pluginId, app.id),
            pluginId,
            url: app.transport.url,
            ...(app.auth === "oauth"
              ? {
                  headers: async () => ({
                    authorization: `Bearer ${await connections.accessToken(pluginId, app.id)}`,
                  }),
                  refresh: () => connections.refreshAfterUnauthorized(pluginId, app.id),
                  expire: () => connections.markExpired(pluginId, app.id),
                }
              : app.auth === "apiKey"
                ? {
                    headers: async () => ({
                      authorization: `Bearer ${await connections.staticToken(pluginId, app.id)}`,
                    }),
                  }
                : {}),
          });
        }
      }
    }
    return apps;
  }

  async snapshot(): Promise<PluginsSnapshot> {
    const { installed, customServers, manifestPlugins, marketplaces } = await this.#load();
    const personal = [
      ...customServers.map(customServerEntry),
      ...manifestPlugins
        .filter((record) => record.sourceId === PERSONAL_SOURCE_ID)
        .map((record) => recordEntry(record, "Personal")),
    ];
    const sources: ReadonlyArray<PluginSource> = [
      ...this.#sources,
      ...(personal.length
        ? [
            {
              id: PERSONAL_SOURCE_ID,
              kind: "personal" as const,
              name: "Personal",
              plugins: personal,
            },
          ]
        : []),
      ...marketplaces.map((marketplace) => marketplaceSource(marketplace, manifestPlugins)),
    ];
    const connections: PluginAppConnection[] = [];
    for (const { pluginId } of installed) {
      for (const app of findPluginCatalogEntry({ sources, installed, connections }, pluginId)
        ?.apps ?? []) {
        connections.push(
          app.auth === "oauth"
            ? await this.#connections.describe(pluginId, app.id)
            : {
                pluginId,
                appId: app.id,
                state:
                  app.auth === "none" || (await this.#connections.staticToken(pluginId, app.id))
                    ? "connected"
                    : "not_connected",
              },
        );
      }
    }
    return { sources, installed, connections };
  }

  async install(pluginId: string, fetchFn: typeof fetch = fetch): Promise<PluginsSnapshot> {
    const snapshot = await this.snapshot();
    const entry = findPluginCatalogEntry(snapshot, pluginId);
    if (!entry) throw new PluginStoreError(`Unknown plugin: ${pluginId}`);
    if (entry.builtIn || snapshot.installed.some((item) => item.pluginId === pluginId)) {
      return snapshot;
    }
    const marketplace = (await this.#load()).marketplaces.find((item) =>
      pluginId.startsWith(`${item.id}--`),
    );
    const manifest = marketplace?.plugins.find(
      (item) => marketplacePluginId(marketplace.id, item.id) === pluginId,
    );
    // A marketplace plugin's servers are asked how they sign in now, not taken from the listing.
    const record =
      marketplace && manifest
        ? await this.#addManifestPlugin(pluginId, marketplace.id, manifest, fetchFn)
        : undefined;
    const state = await this.#load();
    await this.#save({
      ...state,
      installed: [
        ...state.installed,
        { pluginId, enabled: true, installedAt: new Date().toISOString() },
      ],
      manifestPlugins: record ? [...state.manifestPlugins, record] : state.manifestPlugins,
    });
    return this.snapshot();
  }

  /** Adds an uploaded or pasted manifest as a personal plugin. */
  async importManifest(text: string, fetchFn: typeof fetch = fetch): Promise<PluginImportResult> {
    const manifest = parseManifestText(text);
    const pluginId = personalPluginId(manifest.id);
    if (findPluginCatalogEntry(await this.snapshot(), pluginId)) {
      throw new PluginStoreError(
        `A plugin with the id "${manifest.id}" is already in your plugins. Uninstall it first.`,
      );
    }
    const record = await this.#addManifestPlugin(pluginId, PERSONAL_SOURCE_ID, manifest, fetchFn);
    const state = await this.#load();
    await this.#save({
      ...state,
      installed: [
        ...state.installed,
        { pluginId, enabled: true, installedAt: new Date().toISOString() },
      ],
      manifestPlugins: [...state.manifestPlugins, record],
    });
    return { snapshot: await this.snapshot(), pluginId };
  }

  async addMarketplace(
    input: PluginMarketplaceInput,
    fetchFn: typeof fetch = fetch,
  ): Promise<PluginMarketplaceResult> {
    const url = parseMarketplaceUrl(input.url).toString();
    if ((await this.#load()).marketplaces.some((item) => item.url === url)) {
      throw new PluginStoreError("That marketplace is already added.");
    }
    const fetched = await fetchMarketplace(fetchFn, url);
    const state = await this.#load();
    const base = `market-${slugify(fetched.name, "marketplace")}`;
    let id = base;
    for (let n = 2; state.marketplaces.some((item) => item.id === id); n += 1) id = `${base}-${n}`;
    await this.#save({
      ...state,
      marketplaces: [
        ...state.marketplaces,
        { id, name: fetched.name, url, plugins: fetched.plugins, skipped: fetched.skipped },
      ],
    });
    return {
      snapshot: await this.snapshot(),
      sourceId: id,
      added: fetched.plugins.length,
      skipped: fetched.skipped,
    };
  }

  /** Re-reads a marketplace's list. Plugins already added keep the servers they were added with. */
  async refreshMarketplace(
    input: PluginSourceInput,
    fetchFn: typeof fetch = fetch,
  ): Promise<PluginMarketplaceResult> {
    const existing = (await this.#load()).marketplaces.find((item) => item.id === input.sourceId);
    if (!existing) throw new PluginStoreError(`Unknown marketplace: ${input.sourceId}`);
    const fetched = await fetchMarketplace(fetchFn, existing.url);
    const state = await this.#load();
    await this.#save({
      ...state,
      marketplaces: state.marketplaces.map((item) =>
        item.id === existing.id
          ? { ...item, name: fetched.name, plugins: fetched.plugins, skipped: fetched.skipped }
          : item,
      ),
    });
    return {
      snapshot: await this.snapshot(),
      sourceId: existing.id,
      added: fetched.plugins.length,
      skipped: fetched.skipped,
    };
  }

  /** Removes a marketplace and uninstalls the plugins added from it. */
  async removeMarketplace(input: PluginSourceInput): Promise<PluginsSnapshot> {
    for (const record of (await this.#load()).manifestPlugins) {
      if (record.sourceId === input.sourceId) await this.uninstall(record.id);
    }
    const state = await this.#load();
    await this.#save({
      ...state,
      marketplaces: state.marketplaces.filter((item) => item.id !== input.sourceId),
    });
    return this.snapshot();
  }

  /** Checks a pasted access token with the app's server, then keeps it as that app's secret. */
  async saveAppToken(
    input: PluginAppTokenInput,
    fetchFn: typeof fetch = fetch,
  ): Promise<PluginsSnapshot> {
    const snapshot = await this.snapshot();
    const app = findPluginCatalogEntry(snapshot, input.pluginId)?.apps.find(
      (item) => item.id === input.appId,
    );
    if (!app || !snapshot.installed.some((item) => item.pluginId === input.pluginId)) {
      throw new PluginStoreError(`Plugin is not added: ${input.pluginId}`);
    }
    if (app.auth !== "apiKey" || app.transport.type !== "http") {
      throw new PluginStoreError(`${app.name} does not take an access token.`);
    }
    const token = input.token.trim();
    await probeCustomServer(fetchFn, app.transport.url, token);
    await this.#connections.setStaticToken(input.pluginId, input.appId, token);
    return this.snapshot();
  }

  async #addManifestPlugin(
    id: string,
    sourceId: string,
    manifest: PluginManifest,
    fetchFn: typeof fetch,
  ): Promise<ManifestPluginRecord> {
    const apps = [];
    for (const app of manifestApps(manifest)) {
      try {
        apps.push({ ...app, auth: await probeServerAuth(fetchFn, app.url) });
      } catch (cause) {
        throw new PluginStoreError(
          `${app.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
    const createdSkills: string[] = [];
    if (this.#skillsDir) {
      try {
        for (const skill of manifest.skills ?? []) {
          try {
            createdSkills.push((await createSkill(this.#skillsDir, skill)).name);
          } catch (cause) {
            // The user already has a skill by that name: keep theirs and never remove it.
            if (!(cause instanceof SkillExistsError)) throw cause;
          }
        }
      } catch (cause) {
        await this.#removeSkills(createdSkills);
        throw cause;
      }
    }
    return { id, sourceId, manifest, apps, createdSkills };
  }

  async #removeSkills(names: ReadonlyArray<string>): Promise<void> {
    const skillsDir = this.#skillsDir;
    if (!skillsDir) return;
    for (const name of names) {
      // Names come from createSkill, so they are plain folder names inside the skills folder.
      if (/^[a-z0-9-]+$/.test(name))
        await rm(join(skillsDir, name), { recursive: true, force: true });
    }
  }

  /** Adds a tool server by address, after checking that it answers. */
  async addCustomServer(
    input: PluginCustomServerInput,
    fetchFn: typeof fetch = fetch,
  ): Promise<PluginsSnapshot> {
    const url = parseCustomServerUrl(input.url).toString();
    const accessToken = input.accessToken?.trim() || undefined;
    const snapshot = await this.snapshot();
    const taken = new Set(snapshot.sources.flatMap((source) => source.plugins.map((p) => p.id)));
    if (snapshot.sources.some((source) => source.plugins.some((p) => serverUrlOf(p) === url))) {
      throw new PluginStoreError("That server is already in your plugins.");
    }
    const auth = await probeCustomServer(fetchFn, url, accessToken);
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let id = `custom-${slug || "server"}`;
    for (let n = 2; taken.has(id); n += 1) id = `custom-${slug || "server"}-${n}`;
    if (accessToken) await this.#connections.setStaticToken(id, id, accessToken);
    const state = await this.#load();
    await this.#save({
      ...state,
      installed: [
        ...state.installed,
        { pluginId: id, enabled: true, installedAt: new Date().toISOString() },
      ],
      customServers: [...state.customServers, { id, name: input.name, url, auth }],
    });
    return this.snapshot();
  }

  /**
   * Starts a sign-in for one app. Returns the page to open in the browser and, for a device
   * sign-in, the code the user confirms on that page.
   */
  async connect(
    pluginId: string,
    appId: string,
    redirectUri: string,
  ): Promise<{ authorizeUrl: string; userCode?: string }> {
    const snapshot = await this.snapshot();
    const entry = findPluginCatalogEntry(snapshot, pluginId);
    const app = entry?.apps.find((item) => item.id === appId);
    if (!app || !snapshot.installed.some((item) => item.pluginId === pluginId)) {
      throw new PluginStoreError(`Plugin is not added: ${pluginId}`);
    }
    if (app.auth !== "oauth" || app.transport.type !== "http") {
      throw new PluginStoreError(`${app.name} does not use browser sign-in.`);
    }
    // Only DJL's own catalog carries a client of DJL's.
    const fromDjl = snapshot.sources.some(
      (source) => source.kind === "djl" && source.plugins.some((plugin) => plugin === entry),
    );
    const client = fromDjl
      ? HOSTED_PLUGINS.find((plugin) => plugin.id === pluginId)?.oauthClient
      : undefined;
    if (client) {
      if (!client.clientId) {
        throw new PluginStoreError(`${app.name} sign-in is not set up in this build of DJL yet.`);
      }
      const device = await this.#connections.beginDevice({
        pluginId,
        appId,
        serverUrl: app.transport.url,
        clientId: client.clientId,
        scopes: client.scopes,
      });
      return { authorizeUrl: device.verificationUri, userCode: device.userCode };
    }
    const authorizeUrl = await this.#connections.begin({
      pluginId,
      appId,
      serverUrl: app.transport.url,
      redirectUri,
    });
    return { authorizeUrl };
  }

  async disconnect(pluginId: string, appId: string): Promise<PluginsSnapshot> {
    await this.#connections.disconnect(pluginId, appId);
    return this.snapshot();
  }

  async uninstall(pluginId: string): Promise<PluginsSnapshot> {
    const state = await this.#load();
    // Credentials go with the plugin: nothing should keep working after an uninstall.
    for (const app of findPluginCatalogEntry(await this.snapshot(), pluginId)?.apps ?? []) {
      await this.#connections.disconnect(pluginId, app.id);
    }
    const record = state.manifestPlugins.find((item) => item.id === pluginId);
    if (record) await this.#removeSkills(record.createdSkills);
    // A server or manifest the user added exists only as this plugin, so uninstalling removes it.
    await this.#save({
      ...state,
      installed: state.installed.filter((item) => item.pluginId !== pluginId),
      customServers: state.customServers.filter((server) => server.id !== pluginId),
      manifestPlugins: state.manifestPlugins.filter((item) => item.id !== pluginId),
    });
    return this.snapshot();
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<PluginsSnapshot> {
    const state = await this.#load();
    if (!state.installed.some((item) => item.pluginId === pluginId)) {
      throw new PluginStoreError(`Plugin is not added: ${pluginId}`);
    }
    await this.#save({
      ...state,
      installed: state.installed.map((item) =>
        item.pluginId === pluginId ? { ...item, enabled } : item,
      ),
    });
    return this.snapshot();
  }

  async #load(): Promise<StoreState> {
    if (this.#state) return this.#state;
    let raw: string;
    try {
      raw = await readFile(this.#path, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      return (this.#state = {
        installed: [],
        customServers: [],
        manifestPlugins: [],
        marketplaces: [],
      });
    }
    // A file we cannot read is surfaced, not replaced: the next save would silently drop
    // every plugin the user had added.
    const file = Schema.decodeUnknownSync(PluginStoreFile)(JSON.parse(raw) as unknown);
    return (this.#state = {
      installed: file.installed,
      customServers: file.customServers ?? [],
      manifestPlugins: file.manifestPlugins ?? [],
      marketplaces: file.marketplaces ?? [],
    });
  }

  async #save(state: StoreState): Promise<void> {
    const payload = `${JSON.stringify(
      {
        installed: state.installed,
        ...(state.customServers.length ? { customServers: state.customServers } : {}),
        ...(state.manifestPlugins.length ? { manifestPlugins: state.manifestPlugins } : {}),
        ...(state.marketplaces.length ? { marketplaces: state.marketplaces } : {}),
      },
      null,
      2,
    )}\n`;
    this.#write = this.#write
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
        const temporaryPath = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporaryPath, payload, { mode: 0o600 });
        await rename(temporaryPath, this.#path);
      });
    await this.#write;
    this.#state = state;
  }
}

const serverUrlOf = (plugin: PluginCatalogEntry) =>
  plugin.apps.flatMap((app) => (app.transport.type === "http" ? [app.transport.url] : []))[0];
