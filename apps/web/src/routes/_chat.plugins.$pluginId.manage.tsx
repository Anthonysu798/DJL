// FILE: _chat.plugins.$pluginId.manage.tsx
// Purpose: An added plugin's settings page.
// Layer: Route
// Exports: Route

import { findPluginCatalogEntry } from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PluginManageView } from "~/components/plugins/PluginManage";
import { PluginPageShell } from "~/components/plugins/PluginPageShell";
import { usePluginConnect } from "~/components/plugins/usePluginConnect";
import { pluginsSnapshotQueryOptions, usePluginActions } from "~/lib/pluginsReactQuery";
import { ensureNativeApi } from "~/nativeApi";

export const Route = createFileRoute("/_chat/plugins/$pluginId/manage")({
  component: PluginManageRoute,
});

function PluginManageRoute() {
  const { t } = useTranslation("shell");
  const { pluginId } = Route.useParams();
  const navigate = useNavigate();
  const snapshot = useQuery(pluginsSnapshotQueryOptions());
  const actions = usePluginActions();
  const { uninstall, connect, disconnect } = actions;
  const { connectApp, dialog } = usePluginConnect(snapshot.data, actions);
  const plugin = snapshot.data ? findPluginCatalogEntry(snapshot.data, pluginId) : undefined;
  const installed = snapshot.data?.installed.find((item) => item.pluginId === pluginId);

  return (
    <PluginPageShell>
      {dialog}
      {snapshot.data && plugin && installed ? (
        <PluginManageView
          snapshot={snapshot.data}
          plugin={plugin}
          installed={installed}
          pending={uninstall.isPending || connect.isPending || disconnect.isPending}
          error={(uninstall.error ?? connect.error ?? disconnect.error)?.message}
          onBack={() => void navigate({ to: "/plugins" })}
          onViewDetails={() =>
            void navigate({ to: "/plugins/$pluginId", params: { pluginId: plugin.id } })
          }
          onUninstall={() =>
            uninstall.mutate(plugin.id, { onSuccess: () => void navigate({ to: "/plugins" }) })
          }
          onConnect={connectApp}
          onDisconnect={(input) => disconnect.mutate(input)}
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
