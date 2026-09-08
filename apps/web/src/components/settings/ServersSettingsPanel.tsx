// FILE: ServersSettingsPanel.tsx
// Purpose: Settings section listing registered SSH servers with tests, stats, import and editing.
// Layer: Settings UI components
// Exports: ServersSettingsPanel

import type {
  ServerConnectionTest,
  ServerId,
  ServerImportPreviewResult,
  ServerListResult,
  ServerRecord,
} from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { PlusIcon } from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";
import { SETTINGS_CARD_ROW_CLASS_NAME } from "~/settingsPanelStyles";
import { Skeleton } from "~/components/ui/skeleton";

import { toastManager } from "../ui/toast";
import { SettingsLoadError, settingsLoadErrorDetail } from "./SettingsLoadError";
import { SettingsSection } from "./SettingsPanelPrimitives";
import { ServerEditorDialog, type ServerEditorMode } from "./servers/ServerEditorDialog";
import { ServerImportDialog } from "./servers/ServerImportDialog";
import {
  isStatsStale,
  toCreateInput,
  toUpdateInput,
  type ServerFormValues,
} from "./servers/serverPanelModel";
import { ServerRow, type ServerPendingAction } from "./servers/ServerRow";
import { ServersEmptyState } from "./servers/ServersEmptyState";

export const SERVERS_QUERY_KEY = ["servers"] as const;
const LOCAL_KEYS_QUERY_KEY = ["servers", "local-keys"] as const;

function replaceServer(list: ServerListResult | undefined, record: ServerRecord): ServerListResult {
  const servers = list?.servers ?? [];
  const exists = servers.some((server) => server.id === record.id);
  const next = exists
    ? servers.map((server) => (server.id === record.id ? record : server))
    : [...servers, record];
  return { servers: next.toSorted((a, b) => a.name.localeCompare(b.name)) };
}

function withTest(
  list: ServerListResult | undefined,
  id: ServerId,
  test: ServerConnectionTest,
): ServerListResult {
  return {
    // eslint-disable-next-line oxc/no-map-spread -- Replace one record without mutating cached query data.
    servers: (list?.servers ?? []).map((server) =>
      server.id === id ? { ...server, lastTest: test } : server,
    ),
  };
}

export function ServersSettingsPanel() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const [pendingById, setPendingById] = useState<Record<string, ServerPendingAction>>({});
  const [editor, setEditor] = useState<ServerEditorMode | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ServerImportPreviewResult | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ServerRecord | null>(null);
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(new Set());
  const autoRefreshed = useRef(false);

  const servers = useQuery({
    queryKey: SERVERS_QUERY_KEY,
    queryFn: () => ensureNativeApi().servers.list(),
    staleTime: 15_000,
  });
  const localKeys = useQuery({
    queryKey: LOCAL_KEYS_QUERY_KEY,
    queryFn: () => ensureNativeApi().servers.listLocalKeys(),
    enabled: editor !== null,
    staleTime: 60_000,
  });

  const setPending = (id: string, action: ServerPendingAction) =>
    setPendingById((current) => ({ ...current, [id]: action }));

  const testConnection = useMutation({
    mutationFn: (id: ServerId) => ensureNativeApi().servers.testConnection({ id }),
    onMutate: (id) => setPending(id, "test"),
    onSuccess: (test, id) =>
      queryClient.setQueryData<ServerListResult>(SERVERS_QUERY_KEY, (list) =>
        withTest(list, id, test),
      ),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: settingsLoadErrorDetail(error, t("servers.errors.loadFailed")),
      }),
    onSettled: (_result, _error, id) => setPending(id, null),
  });

  const trustHostKey = useMutation({
    mutationFn: (input: { id: ServerId; fingerprint: string }) =>
      ensureNativeApi().servers.trustHostKey(input),
    onMutate: ({ id }) => setPending(id, "test"),
    onSuccess: (test, { id }) => {
      queryClient.setQueryData<ServerListResult>(SERVERS_QUERY_KEY, (list) =>
        withTest(list, id, test),
      );
      toastManager.add({ type: "success", title: t("servers.toasts.trusted") });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: settingsLoadErrorDetail(error, t("servers.errors.loadFailed")),
      }),
    onSettled: (_result, _error, { id }) => setPending(id, null),
  });

  const refreshStats = useMutation({
    mutationFn: (id: ServerId) => ensureNativeApi().servers.refreshStats({ id }),
    onMutate: (id) => setPending(id, "refresh"),
    onSuccess: (result, id) =>
      queryClient.setQueryData<ServerListResult>(SERVERS_QUERY_KEY, (list) => ({
        servers: (list?.servers ?? []).map((server) =>
          server.id !== id
            ? server
            : result.ok
              ? {
                  ...server,
                  lastStats: result.stats,
                  lastTest: { at: result.stats.collectedAt, outcome: "ok" as const },
                }
              : { ...server, lastTest: result.test },
        ),
      })),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: settingsLoadErrorDetail(error, t("servers.errors.loadFailed")),
      }),
    onSettled: (_result, _error, id) => setPending(id, null),
  });

  const save = useMutation({
    mutationFn: async ({ values, mode }: { values: ServerFormValues; mode: ServerEditorMode }) =>
      mode.mode === "edit"
        ? ensureNativeApi().servers.update(toUpdateInput(mode.record.id, values, mode.record))
        : ensureNativeApi().servers.create(toCreateInput(values)),
    onSuccess: (record, { mode }) => {
      queryClient.setQueryData<ServerListResult>(SERVERS_QUERY_KEY, (list) =>
        replaceServer(list, record),
      );
      if (mode.mode === "create") {
        setJustAddedIds((current) => new Set(current).add(record.id));
        window.setTimeout(
          () =>
            setJustAddedIds((current) => {
              const next = new Set(current);
              next.delete(record.id);
              return next;
            }),
          1200,
        );
      }
      setEditor(null);
      toastManager.add({
        type: "success",
        title: t(mode.mode === "edit" ? "servers.toasts.saved" : "servers.toasts.added", {
          name: record.name,
        }),
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: settingsLoadErrorDetail(error, t("servers.errors.loadFailed")),
      }),
  });

  const remove = useMutation({
    mutationFn: (record: ServerRecord) => ensureNativeApi().servers.delete({ id: record.id }),
    onSuccess: (_void, record) => {
      queryClient.setQueryData<ServerListResult>(SERVERS_QUERY_KEY, (list) => ({
        servers: (list?.servers ?? []).filter((server) => server.id !== record.id),
      }));
      setRemoveTarget(null);
      toastManager.add({
        type: "success",
        title: t("servers.toasts.removed", { name: record.name }),
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: settingsLoadErrorDetail(error, t("servers.errors.loadFailed")),
      }),
  });

  const loadImportPreview = useMutation({
    mutationFn: () => ensureNativeApi().servers.importPreview(),
    onSuccess: (preview) => setImportPreview(preview),
    onError: (error) => {
      setImportOpen(false);
      toastManager.add({
        type: "error",
        title: settingsLoadErrorDetail(error, t("servers.errors.loadFailed")),
      });
    },
  });

  const applyImport = useMutation({
    mutationFn: (aliases: string[]) => ensureNativeApi().servers.importApply({ aliases }),
    onSuccess: ({ servers: imported }) => {
      queryClient.setQueryData<ServerListResult>(SERVERS_QUERY_KEY, (list) =>
        imported.reduce((acc, record) => replaceServer(acc, record), list ?? { servers: [] }),
      );
      setJustAddedIds(new Set(imported.map((record) => record.id)));
      window.setTimeout(() => setJustAddedIds(new Set()), 1200);
      setImportOpen(false);
      toastManager.add({
        type: "success",
        title: t("servers.toasts.imported", { count: imported.length }),
      });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: settingsLoadErrorDetail(error, t("servers.errors.loadFailed")),
      }),
  });

  // Refresh stale stats once per panel open, one server at a time, only for reachable servers.
  useEffect(() => {
    if (autoRefreshed.current || !servers.data) return;
    autoRefreshed.current = true;
    const now = Date.now();
    const stale = servers.data.servers.filter(
      (server) => server.lastTest?.outcome === "ok" && isStatsStale(server.lastStats, now),
    );
    if (stale.length === 0) return;
    void (async () => {
      for (const server of stale) {
        try {
          await refreshStats.mutateAsync(server.id);
        } catch {
          // Errors surface as toasts from the mutation; keep going.
        }
      }
    })();
  }, [servers.data, refreshStats]);

  const openImport = () => {
    setImportPreview(null);
    setImportOpen(true);
    loadImportPreview.mutate();
  };

  const list = servers.data?.servers ?? [];

  return (
    <>
      <SettingsSection title={t("servers.title")}>
        <div className={SETTINGS_CARD_ROW_CLASS_NAME} data-slot="settings-row">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">{t("servers.subtitle")}</p>
            {list.length > 0 ? (
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" className="servers-press" onClick={openImport}>
                  {t("servers.actions.import")}
                </Button>
                <Button
                  size="sm"
                  className="servers-press"
                  onClick={() => setEditor({ mode: "create" })}
                >
                  <PlusIcon />
                  {t("servers.actions.add")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {servers.isPending ? (
          <div className="space-y-3 px-4 py-4 sm:px-5">
            {[0, 1].map((index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="size-2 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2.5 w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : servers.isError ? (
          <SettingsLoadError
            summary={t("servers.errors.loadFailed")}
            detail={settingsLoadErrorDetail(servers.error, t("servers.errors.loadFailed"))}
            actionLabel={t("servers.actions.refresh")}
            onAction={() => void servers.refetch()}
          />
        ) : list.length === 0 ? (
          <ServersEmptyState onAdd={() => setEditor({ mode: "create" })} onImport={openImport} />
        ) : (
          list.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              pending={pendingById[server.id] ?? null}
              justAdded={justAddedIds.has(server.id)}
              onTest={() => testConnection.mutate(server.id)}
              onRefresh={() => refreshStats.mutate(server.id)}
              onTrust={(fingerprint) => trustHostKey.mutate({ id: server.id, fingerprint })}
              onEdit={() => setEditor({ mode: "edit", record: server })}
              onRemove={() => setRemoveTarget(server)}
            />
          ))
        )}
      </SettingsSection>

      <ServerEditorDialog
        editor={editor}
        localKeys={localKeys.data?.keys ?? []}
        saving={save.isPending}
        onClose={() => setEditor(null)}
        onSubmit={(values, mode) => save.mutate({ values, mode })}
      />

      <ServerImportDialog
        open={importOpen}
        preview={importPreview}
        loading={loadImportPreview.isPending}
        importing={applyImport.isPending}
        onClose={() => setImportOpen(false)}
        onImport={(aliases) => applyImport.mutate(aliases)}
      />

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => (!open ? setRemoveTarget(null) : undefined)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers.remove.title", { name: removeTarget?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("servers.remove.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("servers.actions.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              className="servers-press"
              disabled={remove.isPending}
              onClick={() => removeTarget && remove.mutate(removeTarget)}
            >
              {t("servers.actions.remove")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
