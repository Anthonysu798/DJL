import type { HarnessToolId } from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ensureNativeApi } from "~/nativeApi";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsSection } from "./SettingsPanelPrimitives";
import { SettingsLoadError, settingsLoadErrorDetail } from "./SettingsLoadError";

const TOOLS_KEY = ["harness-tools"] as const;
const TOOLS = [
  { id: "codex", label: "Codex", docs: "https://developers.openai.com/codex/cli/" },
  { id: "claudeAgent", label: "Claude Code", docs: "https://code.claude.com/docs/en/setup" },
  { id: "opencode", label: "OpenCode", docs: "https://opencode.ai/docs/" },
  { id: "grok", label: "Grok Build", docs: "https://docs.x.ai/build/overview" },
  {
    id: "kimi",
    label: "Kimi Code",
    docs: "https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html",
  },
  { id: "cursor", label: "Cursor", docs: "https://cursor.com/docs/cli/installation" },
] as const;

export function HarnessToolsPanel({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation("settings");
  const client = useQueryClient();
  const serverSettings = useQuery(serverSettingsQueryOptions());
  const saveAutomaticUpdates = useMutation({
    mutationFn: (enabled: boolean) =>
      ensureNativeApi().server.updateSettings({ enableAutomaticProviderUpdates: enabled }),
    onSuccess: (settings) => client.setQueryData(serverQueryKeys.settings(), settings),
  });
  const [active, setActive] = useState<HarnessToolId | null>(null);
  const [results, setResults] = useState<
    Partial<Record<HarnessToolId, { ok: boolean; message: string }>>
  >({});
  const tools = useQuery({
    queryKey: TOOLS_KEY,
    queryFn: () => ensureNativeApi().harnesses.listTools(),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const maintain = useMutation({
    mutationFn: async (ids: HarnessToolId[]) => {
      setResults({});
      for (const id of ids) {
        setActive(id);
        try {
          await ensureNativeApi().harnesses.maintainTool({ harness: id });
          setResults((previous) => ({ ...previous, [id]: { ok: true, message: t("tools.done") } }));
        } catch (error) {
          setResults((previous) => ({
            ...previous,
            [id]: { ok: false, message: settingsLoadErrorDetail(error, t("tools.failed")) },
          }));
        }
      }
    },
    onSettled: async () => {
      setActive(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: TOOLS_KEY }),
        client.invalidateQueries({ queryKey: ["harness-accounts"] }),
        client.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all }),
        client.invalidateQueries({ queryKey: serverQueryKeys.config() }),
      ]);
    },
  });
  const busy =
    disabled ||
    maintain.isPending ||
    (tools.data?.tools.some((tool) => tool.maintenanceStatus === "running") ?? false);
  const updates =
    tools.data?.tools
      .filter((tool) => tool.installed && tool.canUpdate && tool.status === "behind_latest")
      .map((tool) => tool.id) ?? [];
  return (
    <SettingsSection title={t("tools.title")}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <p className="max-w-md text-sm text-muted-foreground">{t("tools.description")}</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || tools.isFetching}
            onClick={() => void tools.refetch()}
          >
            {tools.isFetching ? t("tools.checking") : t("tools.check")}
          </Button>
          <Button
            size="sm"
            disabled={busy || updates.length === 0}
            onClick={() => maintain.mutate(updates)}
          >
            {t("tools.updateAll")}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-4 px-4 py-4">
        <div className="flex-1">
          <p className="text-sm font-medium">{t("tools.automatic")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("tools.automaticDescription")}</p>
          {serverSettings.data && !serverSettings.data.enableProviderUpdateChecks ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("tools.automaticChecksRequired")}
            </p>
          ) : null}
        </div>
        <Switch
          aria-label={t("tools.automatic")}
          checked={serverSettings.data?.enableAutomaticProviderUpdates ?? false}
          disabled={
            busy ||
            saveAutomaticUpdates.isPending ||
            !serverSettings.data ||
            serverSettings.isError ||
            (!serverSettings.data.enableProviderUpdateChecks &&
              !serverSettings.data.enableAutomaticProviderUpdates)
          }
          onCheckedChange={(enabled) => saveAutomaticUpdates.mutate(enabled)}
        />
      </div>
      {serverSettings.isError || saveAutomaticUpdates.isError ? (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">
          {t("tools.automaticError")}
        </p>
      ) : null}
      {tools.isError ? (
        <div className="px-4 py-3">
          <SettingsLoadError
            summary={t("tools.loadError")}
            detail={settingsLoadErrorDetail(tools.error, t("tools.loadError"))}
            actionLabel={t("tools.check")}
            onAction={() => void tools.refetch()}
          />
        </div>
      ) : null}
      {TOOLS.map(({ id, label, docs }) => {
        const tool = tools.data?.tools.find((item) => item.id === id);
        const result =
          results[id] ??
          (tool?.maintenanceStatus && tool.maintenanceStatus !== "running"
            ? {
                ok: tool.maintenanceStatus === "succeeded",
                message: t(tool.maintenanceStatus === "succeeded" ? "tools.done" : "tools.failed"),
              }
            : undefined);
        return (
          <div
            key={id}
            className="flex flex-wrap items-center gap-3 px-4 py-4"
            aria-label={label}
            role="group"
          >
            <div className="min-w-44 flex-1">
              <div className="text-sm font-medium">{label}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {t("tools.installed")}:{" "}
                  {tool
                    ? (tool.currentVersion ?? t(tool.installed ? "tools.unknown" : "tools.missing"))
                    : t("tools.checking")}
                </span>
                <span>
                  {t("tools.latest")}: {tool?.latestVersion ?? t("tools.unknown")}
                </span>
              </div>
              {id === "opencode" ? (
                <p className="mt-2 max-w-lg text-xs text-muted-foreground">
                  {t("tools.bundledNote")}
                </p>
              ) : null}
              {tool?.installed && tool.compatible !== undefined ? (
                <p
                  className={`mt-2 max-w-lg text-xs ${tool.compatible ? "text-muted-foreground" : "text-destructive"}`}
                  role={tool.compatible ? undefined : "alert"}
                >
                  {t(tool.compatible ? "tools.compatible" : "tools.incompatible")}
                </p>
              ) : null}
              {result ? (
                <p
                  role={result.ok ? "status" : "alert"}
                  className={`mt-2 max-w-lg text-xs ${result.ok ? "text-muted-foreground" : "text-destructive"}`}
                >
                  {result.message}
                </p>
              ) : null}
              {tool && !tool.installed && !tool.canInstall ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t(
                    ["grok", "kimi", "cursor"].includes(id)
                      ? "tools.nativeSetupRequired"
                      : "tools.setupRequired",
                  )}
                </p>
              ) : null}
            </div>
            <a
              href={docs}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              {t("accounts.setup")}
            </a>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                !tool ||
                (tool.installed
                  ? !tool.canUpdate || (tool.status === "current" && tool.compatible !== false)
                  : !tool.canInstall)
              }
              onClick={() => maintain.mutate([id])}
            >
              {active === id || tool?.maintenanceStatus === "running"
                ? t("tools.working")
                : !tool?.installed
                  ? t("tools.install")
                  : tool.status === "current" && tool.compatible !== false
                    ? t("tools.current")
                    : t("tools.update")}
            </Button>
          </div>
        );
      })}
      <p className="px-4 py-3 text-xs text-muted-foreground">{t("tools.accessNote")}</p>
    </SettingsSection>
  );
}
