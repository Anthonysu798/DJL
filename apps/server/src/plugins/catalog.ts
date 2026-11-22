// FILE: catalog.ts
// Purpose: The plugin catalog bundled with the app. Nothing here is fetched at runtime, so a
//          release is the only thing that can change which tool servers DJL offers.

import { BUILT_IN_PLUGINS, type PluginCatalogEntry, type PluginSource } from "@synara/contracts";

import { DOCUMENT_PLUGIN_ENTRIES } from "./documentPlugins";
import { HOSTED_PLUGINS, type HostedPlugin } from "./hostedPlugins";

const hostedEntry = (plugin: HostedPlugin): PluginCatalogEntry => ({
  id: plugin.id,
  name: plugin.id,
  displayName: plugin.displayName,
  shortDescription: plugin.shortDescription,
  longDescription: plugin.longDescription,
  category: plugin.category,
  featured: plugin.featured ?? false,
  builtIn: false,
  developer: plugin.displayName,
  version: "1.0.0",
  websiteUrl: plugin.websiteUrl,
  ...(plugin.privacyPolicyUrl ? { privacyPolicyUrl: plugin.privacyPolicyUrl } : {}),
  ...(plugin.termsOfServiceUrl ? { termsOfServiceUrl: plugin.termsOfServiceUrl } : {}),
  capabilities: plugin.capabilities,
  examplePrompts: plugin.examplePrompts,
  apps: [
    {
      id: plugin.id,
      name: plugin.displayName,
      description: plugin.shortDescription,
      transport: { type: "http", url: plugin.url },
      auth: plugin.auth ?? "oauth",
      ...(plugin.tokenUrl ? { tokenUrl: plugin.tokenUrl } : {}),
      ...(plugin.tokenScopes ? { tokenScopes: plugin.tokenScopes } : {}),
    },
  ],
  skills: [],
});

// The social plugin stays out of the directory, as it did before; multipost replaced it.
const builtInEntries: ReadonlyArray<PluginCatalogEntry> = BUILT_IN_PLUGINS.filter(
  ({ plugin }) => plugin.id !== "djl-social",
).map(({ plugin, skills, mcpServers }) => ({
  id: plugin.id,
  name: plugin.name,
  displayName: plugin.interface?.displayName ?? plugin.name,
  shortDescription: plugin.interface?.shortDescription ?? plugin.name,
  ...(plugin.interface?.longDescription
    ? { longDescription: plugin.interface.longDescription }
    : {}),
  category: plugin.interface?.category ?? "DJL",
  featured: true,
  builtIn: true,
  developer: plugin.interface?.developerName ?? "DJL",
  version: "1.0.0",
  ...(plugin.interface?.brandColor ? { brandColor: plugin.interface.brandColor } : {}),
  capabilities: plugin.interface?.capabilities ?? [],
  examplePrompts: plugin.interface?.defaultPrompt ?? [],
  apps: mcpServers.map((name) => ({
    id: name,
    name,
    transport: { type: "builtin" as const },
    auth: "none" as const,
  })),
  skills: skills.map((skill) => ({
    name: skill.name,
    ...(skill.description ? { description: skill.description } : {}),
  })),
}));

export const DJL_PLUGIN_SOURCE: PluginSource = {
  id: "djl",
  kind: "djl",
  name: "DJL",
  plugins: [...builtInEntries, ...DOCUMENT_PLUGIN_ENTRIES, ...HOSTED_PLUGINS.map(hostedEntry)],
};
