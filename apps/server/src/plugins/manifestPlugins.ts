// FILE: manifestPlugins.ts
// Purpose: Plugins described by a manifest (uploaded by the user, or listed by a marketplace):
//          how they are stored in plugins.json and how they appear in the snapshot.

import {
  PluginAppAuthType,
  PluginManifest,
  type PluginApp,
  type PluginCatalogEntry,
} from "@djl/contracts";
import { Schema } from "effect";

export const PERSONAL_SOURCE_ID = "personal";

/** Ids of uploaded plugins; catalog ids never start with this. */
export const personalPluginId = (manifestId: string) => `personal-${manifestId}`;
/** Ids of marketplace plugins: namespaced so a listing cannot stand in for another plugin. */
export const marketplacePluginId = (marketplaceId: string, manifestId: string) =>
  `${marketplaceId}--${manifestId}`;

export const slugify = (value: string, fallback: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || fallback;

/** One tool server of a manifest plugin, as it was when the user added the plugin. */
export const ManifestApp = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  auth: PluginAppAuthType,
});
export type ManifestApp = typeof ManifestApp.Type;

/**
 * An added manifest plugin. Its servers and their sign-in type are fixed when it is added, so a
 * later marketplace refresh cannot point an existing connection (and its token) at a new host.
 */
export const ManifestPluginRecord = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  manifest: PluginManifest,
  apps: Schema.Array(ManifestApp),
  /** Skills DJL wrote for this plugin; only these are removed with it. */
  createdSkills: Schema.Array(Schema.String),
});
export type ManifestPluginRecord = typeof ManifestPluginRecord.Type;

export const MarketplaceRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  plugins: Schema.Array(PluginManifest),
  skipped: Schema.Number,
});
export type MarketplaceRecord = typeof MarketplaceRecord.Type;

/** App ids from server names, unique within the plugin. */
export function manifestApps(
  manifest: PluginManifest,
): Array<{ id: string; name: string; url: string }> {
  const taken = new Set<string>();
  return manifest.mcpServers.map((server) => {
    const base = slugify(server.name, "server");
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    return { id, name: server.name, url: server.url };
  });
}

/** A skill folder name the way createSkill derives it. */
export const skillFolderName = (name: string) => slugify(name, "").slice(0, 64);

export function manifestEntry(input: {
  id: string;
  manifest: PluginManifest;
  /** Personal plugins are grouped together; marketplace ones keep their own category. */
  personal: boolean;
  sourceName: string;
  /** Left out before the plugin is added: how its servers sign in is not known yet. */
  apps?: ReadonlyArray<ManifestApp>;
}): PluginCatalogEntry {
  const { manifest } = input;
  const apps: PluginApp[] = (
    input.apps ?? manifestApps(manifest).map((app) => ({ ...app, auth: "none" as const }))
  ).map((app) => ({
    id: app.id,
    name: app.name,
    description: new URL(app.url).host,
    transport: { type: "http", url: app.url },
    auth: app.auth,
  }));
  return {
    id: input.id,
    name: manifest.name,
    displayName: manifest.displayName,
    shortDescription: manifest.shortDescription,
    ...(manifest.longDescription ? { longDescription: manifest.longDescription } : {}),
    category: input.personal ? "Personal" : (manifest.category ?? input.sourceName),
    featured: false,
    builtIn: false,
    developer: manifest.websiteUrl ? new URL(manifest.websiteUrl).host : input.sourceName,
    version: "1.0.0",
    ...(manifest.websiteUrl ? { websiteUrl: manifest.websiteUrl } : {}),
    ...(manifest.brandColor ? { brandColor: manifest.brandColor } : {}),
    capabilities: [],
    examplePrompts: manifest.examplePrompts ?? [],
    apps,
    skills: (manifest.skills ?? []).map((skill) => ({
      name: skillFolderName(skill.name) || skill.name,
      description: skill.description,
    })),
  };
}
