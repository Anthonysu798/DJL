// FILE: composerPluginSuggestions.ts
// Purpose: Which DJL catalog plugins the composer's "@" menu offers in a chat: the ones that
//          would actually work there right now.
// Layer: Web data helper

import {
  BUILT_IN_PLUGINS,
  DJL_PLUGIN_MENTION_PREFIX,
  type PluginsSnapshot,
  type ProviderMentionReference,
  type ProviderPluginDescriptor,
} from "@djl/contracts";

// Every agent is handed the user's plugins, so the same plugins are offered in every chat.
export function composerPluginSuggestions(
  snapshot: PluginsSnapshot,
): Array<{ plugin: ProviderPluginDescriptor; mention: ProviderMentionReference }> {
  // MultiPost and Computer Use are already in the menu under their own mention paths.
  const alreadyListed = new Set(BUILT_IN_PLUGINS.map((entry) => entry.plugin.id));
  return snapshot.sources
    .flatMap((source) => source.plugins)
    .filter((plugin) => {
      if (alreadyListed.has(plugin.id)) return false;
      if (plugin.builtIn) return true;
      const installed = snapshot.installed.find((item) => item.pluginId === plugin.id);
      return (
        installed?.enabled === true &&
        plugin.apps.every((app) =>
          snapshot.connections.some(
            (connection) =>
              connection.pluginId === plugin.id &&
              connection.appId === app.id &&
              connection.state === "connected",
          ),
        )
      );
    })
    .map((plugin) => {
      const path = `${DJL_PLUGIN_MENTION_PREFIX}${plugin.id}`;
      // The menu draws a plugin's logo from this site's icon.
      const logoSite = plugin.websiteUrl ?? plugin.iconDomain;
      return {
        plugin: {
          id: plugin.id,
          name: plugin.name,
          source: { type: "local", path },
          installed: true,
          enabled: true,
          installPolicy: "AVAILABLE",
          authPolicy: "ON_USE",
          interface: {
            displayName: plugin.displayName,
            shortDescription: plugin.shortDescription,
            ...(plugin.brandColor ? { brandColor: plugin.brandColor } : {}),
            ...(logoSite ? { websiteUrl: logoSite } : {}),
          },
        },
        mention: { name: plugin.name, path },
      };
    });
}
