// FILE: _chat.plugins.$pluginId.index.tsx
// Purpose: One plugin's detail page.
// Layer: Route
// Exports: Route

import { findPluginCatalogEntry } from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PluginDetailView } from "~/components/plugins/PluginDetail";
import { PluginPageShell } from "~/components/plugins/PluginPageShell";
import { usePluginConnect } from "~/components/plugins/usePluginConnect";
import { useTryPlugin } from "~/components/plugins/useTryPlugin";
import { pluginsSnapshotQueryOptions, usePluginActions } from "~/lib/pluginsReactQuery";
import { ensureNativeApi } from "~/nativeApi";

export const Route = createFileRoute("/_chat/plugins/$pluginId/")({
  component: PluginDetailRoute,
});

function PluginDetailRoute() {
  const { t } = useTranslation("shell");
  const { pluginId } = Route.useParams();
  const navigate = useNavigate();
  const snapshot = useQuery(pluginsSnapshotQueryOptions());
  const actions = usePluginActions();
  const { install, uninstall, connect, disconnect } = actions;
  const { connectApp, promptAfterInstall, dialog } = usePluginConnect(snapshot.data, actions);
  const { tryPlugin, error: tryError } = useTryPlugin();
  const plugin = snapshot.data ? findPluginCatalogEntry(snapshot.data, pluginId) : undefined;

  return (
    <PluginPageShell>
      {dialog}
      {snapshot.data && plugin ? (
        <PluginDetailView
          snapshot={snapshot.data}
          plugin={plugin}
          pending={
            install.isPending || uninstall.isPending || connect.isPending || disconnect.isPending
          }
          error={
            tryError ??
            (install.error ?? uninstall.error ?? connect.error ?? disconnect.error)?.message
          }
          onBack={() => void navigate({ to: "/plugins" })}
          onAdd={() =>
            install.mutate(plugin.id, {
              onSuccess: (next) => promptAfterInstall(next, plugin.id),
            })
          }
          onUninstall={() => uninstall.mutate(plugin.id)}
          onManage={() =>
            void navigate({ to: "/plugins/$pluginId/manage", params: { pluginId: plugin.id } })
          }
          onConnect={connectApp}
          onDisconnect={(input) => disconnect.mutate(input)}
          onUse={(prompt) => tryPlugin(plugin, prompt)}
          onOpenLink={(url) => void ensureNativeApi().shell.openExternal(url)}
        />
      ) : (
        <p
          role={snapshot.error ? "alert" : "status"}
          className="mx-auto max-w-[900px] px-10 pt-10 text-sm text-muted-foreground"
        >
          {snapshot.error?.message ??
            (snapshot.data ? t("pluginLibrary.notFound") : t("pluginLibrary.loading"))}
        </p>
      )}
    </PluginPageShell>
  );
}
