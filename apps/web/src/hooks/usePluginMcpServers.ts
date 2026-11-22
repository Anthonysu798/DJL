import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  mcpMention,
  BUILT_IN_PLUGINS,
  type ProviderKind,
  type ProviderListPluginsResult,
  type ProviderReadPluginResult,
} from "@djl/contracts";
import { providerReadPluginQueryOptions } from "~/lib/providerDiscoveryReactQuery";
import { isInstalledProviderPlugin } from "~/lib/providerDiscovery";

const combineDetails = (results: UseQueryResult<ProviderReadPluginResult, Error>[]) => ({
  details: results.map((result) => result.data),
  isLoading: results.some((result) => result.isLoading),
  errors: results.flatMap((result) => (result.error ? [result.error.message] : [])),
});

export function usePluginMcpServers(
  provider: ProviderKind,
  data: ProviderListPluginsResult | undefined,
  cwd: string | null,
  threadId: string | null,
  enabled = true,
) {
  const entries = useMemo(
    () =>
      (data?.marketplaces ?? []).flatMap((marketplace) =>
        marketplace.plugins.filter(isInstalledProviderPlugin).map((plugin) => ({
          plugin,
          marketplace,
          mention: { name: plugin.name, path: `plugin://${plugin.name}@${marketplace.name}` },
        })),
      ),
    [data],
  );
  const results = useQueries({
    queries: entries.map(({ plugin, marketplace }) =>
      providerReadPluginQueryOptions({
        provider,
        marketplacePath: marketplace.path,
        pluginName: plugin.name,
        cwd,
        threadId,
        enabled,
      }),
    ),
    combine: combineDetails,
  });
  const servers = useMemo(
    () => [
      ...BUILT_IN_PLUGINS.flatMap((entry) =>
        entry.mcpServers.map((name) => ({
          name,
          plugin: entry.plugin,
          mention: mcpMention(name, entry.mention),
        })),
      ),
      ...entries.flatMap((entry, index) =>
        (results.details[index]?.plugin.mcpServers ?? []).map((name) => ({
          name,
          plugin: entry.plugin,
          mention: mcpMention(name, entry.mention),
        })),
      ),
    ],
    [entries, results.details],
  );
  return { servers, isLoading: results.isLoading, errors: results.errors };
}
