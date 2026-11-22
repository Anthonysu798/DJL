// FILE: pluginsReactQuery.ts
// Purpose: React Query access to the DJL plugin snapshot and the calls that change it.
// Layer: Web data helper

import {
  findPluginCatalogEntry,
  type PluginAppInput,
  type PluginAppTokenInput,
  type PluginCreateSkillInput,
  type PluginCustomServerInput,
  type PluginSetEnabledInput,
  type PluginsSnapshot,
} from "@djl/contracts";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

import { rememberPluginLogos } from "./pluginLogos";

export const PLUGINS_QUERY_KEY = ["plugins"] as const;

export function pluginsSnapshotQueryOptions() {
  return queryOptions<PluginsSnapshot>({
    queryKey: PLUGINS_QUERY_KEY,
    queryFn: async () => {
      const snapshot = await ensureNativeApi().plugins.getSnapshot();
      rememberPluginLogos(snapshot);
      return snapshot;
    },
    staleTime: 30_000,
    // Sign-in finishes in the user's browser, so watch for it only while one is under way.
    refetchInterval: (query) =>
      query.state.data?.connections.some((connection) => connection.state === "connecting")
        ? 1_500
        : false,
  });
}

/** Every plugin call returns the new snapshot, so the cache is replaced rather than refetched. */
export function usePluginActions() {
  const queryClient = useQueryClient();
  const apply = (snapshot: PluginsSnapshot) => {
    queryClient.setQueryData(PLUGINS_QUERY_KEY, snapshot);
  };
  const connect = useMutation({
    mutationFn: async (input: PluginAppInput) => {
      const api = ensureNativeApi();
      const result = await api.plugins.connectApp(input);
      apply(result.snapshot);
      // A device sign-in asks for a code on the vendor's page; copy it before the page opens.
      if (result.userCode) {
        await navigator.clipboard.writeText(result.userCode).catch(() => undefined);
      }
      await api.shell.openExternal(result.authorizeUrl);
      return { ...input, authorizeUrl: result.authorizeUrl, userCode: result.userCode };
    },
    // A failed start is recorded on the connection itself; pick it up.
    onError: () => void queryClient.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY }),
  });
  const disconnect = useMutation({
    mutationFn: (input: PluginAppInput) => ensureNativeApi().plugins.disconnectApp(input),
    onSuccess: apply,
  });
  const install = useMutation({
    mutationFn: (pluginId: string) => ensureNativeApi().plugins.install({ pluginId }),
    onSuccess: (snapshot, pluginId) => {
      apply(snapshot);
      // Adding a plugin goes straight on to signing in to it.
      const app = findPluginCatalogEntry(snapshot, pluginId)?.apps.find(
        (item) => item.auth === "oauth",
      );
      if (app) connect.mutate({ pluginId, appId: app.id });
    },
  });
  const uninstall = useMutation({
    mutationFn: (pluginId: string) => ensureNativeApi().plugins.uninstall({ pluginId }),
    onSuccess: apply,
  });
  const setEnabled = useMutation({
    mutationFn: (input: PluginSetEnabledInput) => ensureNativeApi().plugins.setEnabled(input),
    onSuccess: apply,
  });
  const addCustomServer = useMutation({
    mutationFn: (input: PluginCustomServerInput) =>
      ensureNativeApi().plugins.addCustomServer(input),
    onSuccess: (snapshot, input) => {
      apply(snapshot);
      // A server that signs in through the browser goes straight on to that, like a catalog one.
      const added = snapshot.sources
        .flatMap((source) => source.plugins)
        .find((plugin) => plugin.displayName === input.name && plugin.id.startsWith("custom-"));
      const app = added?.apps.find((item) => item.auth === "oauth");
      if (added && app) connect.mutate({ pluginId: added.id, appId: app.id });
    },
  });
  const createSkill = useMutation({
    mutationFn: (input: PluginCreateSkillInput) => ensureNativeApi().plugins.createSkill(input),
    // Skill lists are cached per folder; the new skill belongs in all of them.
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["provider-discovery", "skills-catalog"] }),
  });
  const saveAppToken = useMutation({
    mutationFn: (input: PluginAppTokenInput) => ensureNativeApi().plugins.saveAppToken(input),
    onSuccess: apply,
  });
  const importManifest = useMutation({
    mutationFn: (manifest: string) => ensureNativeApi().plugins.importManifest({ manifest }),
    onSuccess: ({ snapshot, pluginId }) => {
      apply(snapshot);
      // Plugin skills are written to the shared skills folder.
      void queryClient.invalidateQueries({ queryKey: ["provider-discovery", "skills-catalog"] });
      const app = findPluginCatalogEntry(snapshot, pluginId)?.apps.find(
        (item) => item.auth === "oauth",
      );
      if (app) connect.mutate({ pluginId, appId: app.id });
    },
  });
  const addMarketplace = useMutation({
    mutationFn: (url: string) => ensureNativeApi().plugins.addMarketplace({ url }),
    onSuccess: (result) => apply(result.snapshot),
  });
  const refreshMarketplace = useMutation({
    mutationFn: (sourceId: string) => ensureNativeApi().plugins.refreshMarketplace({ sourceId }),
    onSuccess: (result) => apply(result.snapshot),
  });
  const removeMarketplace = useMutation({
    mutationFn: (sourceId: string) => ensureNativeApi().plugins.removeMarketplace({ sourceId }),
    onSuccess: apply,
  });
  return {
    install,
    uninstall,
    connect,
    disconnect,
    setEnabled,
    addCustomServer,
    createSkill,
    saveAppToken,
    importManifest,
    addMarketplace,
    refreshMarketplace,
    removeMarketplace,
  };
}
