// FILE: _chat.plugins.index.tsx
// Purpose: The plugin directory route.
// Layer: Route
// Exports: Route

import type { PluginMarketplaceResult } from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AddCustomServerDialog } from "~/components/plugins/AddCustomServerDialog";
import { AddMarketplaceDialog } from "~/components/plugins/AddMarketplaceDialog";
import { CreateSkillDialog } from "~/components/plugins/CreateSkillDialog";
import { PluginDirectoryView } from "~/components/plugins/PluginDirectory";
import { PluginLibraryTabs, type PluginLibraryView } from "~/components/plugins/PluginLibraryTabs";
import { PluginPageShell } from "~/components/plugins/PluginPageShell";
import { SkillsStoreView } from "~/components/plugins/SkillsStore";
import { UploadPluginDialog } from "~/components/plugins/UploadPluginDialog";
import { usePluginConnect } from "~/components/plugins/usePluginConnect";
import { pluginsSnapshotQueryOptions, usePluginActions } from "~/lib/pluginsReactQuery";

export const Route = createFileRoute("/_chat/plugins/")({
  component: PluginDirectoryRoute,
});

// Coming back from a plugin's page lands on the tab the user left.
let lastLibraryView: PluginLibraryView = "plugins";

function PluginDirectoryRoute() {
  const { t } = useTranslation("shell");
  const navigate = useNavigate();
  const snapshot = useQuery(pluginsSnapshotQueryOptions());
  const actions = usePluginActions();
  const {
    install,
    uninstall,
    connect,
    addCustomServer,
    createSkill,
    importManifest,
    addMarketplace,
    refreshMarketplace,
    removeMarketplace,
  } = actions;
  const { promptAfterInstall, dialog } = usePluginConnect(snapshot.data, actions);
  const [addingServer, setAddingServer] = useState(false);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [addingMarketplace, setAddingMarketplace] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [view, setViewState] = useState<PluginLibraryView>(lastLibraryView);
  const setView = (next: PluginLibraryView) => {
    lastLibraryView = next;
    setViewState(next);
  };
  const heading = <PluginLibraryTabs value={view} onChange={setView} />;
  if (view === "skills")
    return (
      <PluginPageShell>
        <SkillsStoreView heading={heading} />
      </PluginPageShell>
    );
  const noteSkipped = (result: PluginMarketplaceResult) => setSkipped(result.skipped);
  return (
    <PluginPageShell>
      {dialog}
      {/* Mounted only while open, so a typed-in token never lingers in the form. */}
      {addingServer ? (
        <AddCustomServerDialog
          open
          pending={addCustomServer.isPending}
          error={addCustomServer.error?.message}
          onOpenChange={(open) => {
            addCustomServer.reset();
            setAddingServer(open);
          }}
          onSubmit={(input) =>
            addCustomServer.mutate(input, { onSuccess: () => setAddingServer(false) })
          }
        />
      ) : null}
      {creatingSkill ? (
        <CreateSkillDialog
          open
          pending={createSkill.isPending}
          error={createSkill.error?.message}
          onOpenChange={(open) => {
            createSkill.reset();
            setCreatingSkill(open);
          }}
          onSubmit={(input) =>
            createSkill.mutate(input, { onSuccess: () => setCreatingSkill(false) })
          }
        />
      ) : null}
      {uploading ? (
        <UploadPluginDialog
          open
          pending={importManifest.isPending}
          error={importManifest.error?.message}
          onOpenChange={(open) => {
            importManifest.reset();
            setUploading(open);
          }}
          onSubmit={(manifest) =>
            importManifest.mutate(manifest, {
              onSuccess: (result) => {
                setUploading(false);
                promptAfterInstall(result.snapshot, result.pluginId);
              },
            })
          }
        />
      ) : null}
      {addingMarketplace ? (
        <AddMarketplaceDialog
          open
          pending={addMarketplace.isPending}
          error={addMarketplace.error?.message}
          onOpenChange={(open) => {
            addMarketplace.reset();
            setAddingMarketplace(open);
          }}
          onSubmit={(url) =>
            addMarketplace.mutate(url, {
              onSuccess: (result) => {
                setAddingMarketplace(false);
                noteSkipped(result);
              },
            })
          }
        />
      ) : null}
      <PluginDirectoryView
        heading={heading}
        snapshot={snapshot.data}
        loading={snapshot.isFetching}
        error={
          (
            install.error ??
            uninstall.error ??
            connect.error ??
            refreshMarketplace.error ??
            removeMarketplace.error ??
            snapshot.error
          )?.message
        }
        pendingPluginId={install.isPending ? install.variables : undefined}
        onOpen={(pluginId) => void navigate({ to: "/plugins/$pluginId", params: { pluginId } })}
        onAdd={(pluginId) =>
          install.mutate(pluginId, { onSuccess: (next) => promptAfterInstall(next, pluginId) })
        }
        onUninstall={(pluginId) => uninstall.mutate(pluginId)}
        onRefresh={() => void snapshot.refetch()}
        onAddServer={() => setAddingServer(true)}
        onCreateSkill={() => setCreatingSkill(true)}
        onAddMarketplace={() => setAddingMarketplace(true)}
        onUploadPlugin={() => setUploading(true)}
        notice={skipped > 0 ? t("pluginLibrary.marketplaceSkipped", { count: skipped }) : undefined}
        onRefreshMarketplace={(sourceId) =>
          refreshMarketplace.mutate(sourceId, { onSuccess: noteSkipped })
        }
        onRemoveMarketplace={(sourceId) =>
          removeMarketplace.mutate(sourceId, { onSuccess: () => setSkipped(0) })
        }
        onOpenSettings={() => void navigate({ to: "/settings", search: { section: "plugins" } })}
      />
    </PluginPageShell>
  );
}
