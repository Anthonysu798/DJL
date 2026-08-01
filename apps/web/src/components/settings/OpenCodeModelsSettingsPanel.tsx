// FILE: OpenCodeModelsSettingsPanel.tsx
// Purpose: Manage DJL-owned OpenCode API credentials and the authenticated model catalog.

import type { OpenCodeModelProviderConnection } from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import englishCatalog from "../../i18n/locales/en.json";

import { useAppSettings } from "~/appSettings";
import { Button } from "~/components/ui/button";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { SettingsLoadError, settingsLoadErrorDetail } from "./SettingsLoadError";
import { Input } from "~/components/ui/input";
import { Select, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { toastManager } from "~/components/ui/toast";
import {
  openCodeModelProvidersQueryOptions,
  providerDiscoveryQueryKeys,
  providerModelsQueryOptions,
} from "~/lib/providerDiscoveryReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";
import { SETTINGS_TARGETS } from "~/settingsNavigation";
import {
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
  SETTINGS_INSET_LIST_CLASS_NAME,
} from "~/settingsPanelStyles";
import { SettingsSection, SettingsSelectPopup } from "./SettingsPanelPrimitives";

export function modelProviderStatusText(
  providerCount: number,
  modelCount: number,
  t?: TFunction,
): string {
  if (providerCount === 0) {
    return (
      t?.("models.addKeyPrompt", { ns: "settings" }) ?? englishCatalog.settings.models.addKeyPrompt
    );
  }
  const translate =
    t ??
    ((key: string, options: Record<string, unknown>) => {
      const template = key.endsWith("providerCount")
        ? providerCount === 1
          ? englishCatalog.settings.models.providerCount_one
          : englishCatalog.settings.models.providerCount_other
        : modelCount === 1
          ? englishCatalog.settings.models.modelCount_one
          : englishCatalog.settings.models.modelCount_other;
      return template.replace("{{count}}", String(options.count));
    });
  return `${translate("models.providerCount", { ns: "settings", count: providerCount })} · ${translate("models.modelCount", { ns: "settings", count: modelCount })}`;
}

export function resolveAuthenticatedModelSelection(
  current: string | undefined,
  models: ReadonlyArray<{ slug: string }>,
): string | undefined {
  if (current && models.some((model) => model.slug === current)) return current;
  return models[0]?.slug;
}

export function resolveGuidedProviderId(
  providers: ReadonlyArray<Pick<OpenCodeModelProviderConnection, "connected" | "id">>,
): string | null {
  return providers.find((provider) => !provider.connected)?.id ?? providers[0]?.id ?? null;
}

function ProviderCredentialRow(props: {
  provider: OpenCodeModelProviderConnection;
  models: ReadonlyArray<{ slug: string; name: string }>;
  apiKey: string;
  open: boolean;
  busy: boolean;
  onApiKeyChange: (value: string) => void;
  onToggle: () => void;
  onSave: () => void;
  onDisconnect: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  return (
    <div>
      <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={props.onToggle}
          aria-expanded={props.open}
        >
          <DisclosureChevron open={props.open} className="size-3.5 opacity-60" />
          <span className={cn(SETTINGS_CARD_ROW_TITLE_CLASS_NAME, "min-w-0 flex-1 truncate")}>
            {props.provider.name}
          </span>
          <span
            className={cn(
              "text-[11px]",
              props.provider.connected ? "text-success-foreground" : "text-muted-foreground",
            )}
          >
            {props.provider.connected
              ? t("models.modelCount", { count: props.provider.modelCount })
              : t("models.notConnected")}
          </span>
        </button>
      </div>
      <DisclosureRegion open={props.open}>
        <div className="border-t border-[color:var(--color-border)] px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              size="sm"
              variant="soft"
              value={props.apiKey}
              onChange={(event) => props.onApiKeyChange(event.target.value)}
              placeholder={
                props.provider.connected
                  ? t("models.replacementKeyPlaceholder")
                  : t("models.keyPlaceholder")
              }
              aria-label={t("models.keyAriaLabel", { provider: props.provider.name })}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={props.busy || props.apiKey.trim().length === 0}
              onClick={props.onSave}
            >
              {props.provider.connected
                ? t("models.replace", { ns: "settings" })
                : t("actions.save", { ns: "common" })}
            </Button>
            {props.provider.connected ? (
              <>
                <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onTest}>
                  {t("models.test")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={props.busy}
                  onClick={props.onDisconnect}
                >
                  {t("models.disconnect")}
                </Button>
              </>
            ) : null}
          </div>
          <p className={cn(SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME, "mt-2")}>
            {t("models.keyPrivacy")}
          </p>
          {props.provider.connected && props.models.length > 0 ? (
            <div className={cn(SETTINGS_INSET_LIST_CLASS_NAME, "mt-3 max-h-44 overflow-y-auto")}>
              {props.models.map((model) => (
                <div
                  key={model.slug}
                  className="flex items-center justify-between gap-3 border-t border-[color:var(--color-border)] px-3 py-2 first:border-t-0"
                >
                  <span className="min-w-0 truncate text-xs text-foreground">{model.name}</span>
                  <code className="shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                    {model.slug}
                  </code>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </DisclosureRegion>
    </div>
  );
}

export function OpenCodeModelsSettingsPanel(props: {
  cwd?: string | null;
  revealProviderAccess?: boolean;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const cwd = props.cwd ?? null;
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useAppSettings();
  const [openProviderIds, setOpenProviderIds] = useState<ReadonlySet<string>>(() => new Set());
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const providerAccessRef = useRef<HTMLDivElement | null>(null);
  const connectionsQuery = useQuery(openCodeModelProvidersQueryOptions(cwd));
  const connectedCount = connectionsQuery.data?.configuredProviderCount ?? 0;
  const modelsQuery = useQuery(
    providerModelsQueryOptions({
      provider: "opencode",
      cwd,
      enabled: connectedCount > 0,
    }),
  );
  const models = modelsQuery.data?.models ?? [];

  useEffect(() => {
    const providerData = connectionsQuery.data;
    if (!props.revealProviderAccess || !connectionsQuery.isSuccess || !providerData) return;
    const providerId = resolveGuidedProviderId(providerData.providers);
    if (providerId) {
      setOpenProviderIds((current) => new Set(current).add(providerId));
    }
    providerAccessRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [connectionsQuery.data, connectionsQuery.isSuccess, props.revealProviderAccess]);

  const refreshCatalog = async () => {
    const api = ensureNativeApi();
    const [providers, modelCatalog] = await Promise.all([
      api.provider.listModelProviders({ forceReload: true }),
      api.provider.listModels({ provider: "opencode", forceReload: true }),
    ]);
    queryClient.setQueryData(providerDiscoveryQueryKeys.openCodeModelProviders(cwd), providers);
    queryClient.setQueryData(
      providerDiscoveryQueryKeys.models("opencode", null, null, null, null),
      modelCatalog,
    );
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: providerDiscoveryQueryKeys.openCodeModelProviders(cwd),
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: providerDiscoveryQueryKeys.models("opencode", null, null, null, null),
        refetchType: "none",
      }),
    ]);
  };

  const setKeyMutation = useMutation({
    mutationFn: (input: { providerId: string; apiKey: string }) =>
      ensureNativeApi().provider.setApiKey({ ...input, ...(cwd ? { cwd } : {}) }),
    onSuccess: async (result) => {
      setApiKeys((current) => ({ ...current, [result.providerId]: "" }));
      await refreshCatalog();
      toastManager.add({ type: "success", title: t("models.toasts.keySaved") });
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: t("models.toasts.keySaveFailed"),
        description: t("models.toasts.keySaveFailedWithDetail", {
          detail: error instanceof Error ? error.message : t("models.toasts.keyRejected"),
        }),
      }),
  });

  const removeMutation = useMutation({
    mutationFn: (providerId: string) =>
      ensureNativeApi().provider.removeCredential({ providerId, ...(cwd ? { cwd } : {}) }),
    onSuccess: async () => {
      await refreshCatalog();
      toastManager.add({ type: "success", title: t("models.toasts.disconnected") });
    },
  });

  const modelsByProvider = useMemo(() => {
    const result = new Map<string, Array<{ slug: string; name: string }>>();
    for (const model of models) {
      const providerId = model.upstreamProviderId ?? model.slug.split("/", 1)[0] ?? "";
      const entries = result.get(providerId) ?? [];
      entries.push({ slug: model.slug, name: model.name });
      result.set(providerId, entries);
    }
    return result;
  }, [models]);

  const selectedGitModel =
    settings.textGenerationProvider === "opencode" ? settings.textGenerationModel : undefined;
  const resolvedGitModel = resolveAuthenticatedModelSelection(selectedGitModel, models);

  useEffect(() => {
    const catalogSettled =
      connectionsQuery.isSuccess && (connectedCount === 0 || modelsQuery.isSuccess);
    if (!catalogSettled || resolvedGitModel === selectedGitModel) return;
    updateSettings({
      textGenerationProvider: "opencode",
      textGenerationModel: resolvedGitModel,
    });
  }, [
    connectedCount,
    connectionsQuery.isSuccess,
    modelsQuery.isSuccess,
    resolvedGitModel,
    selectedGitModel,
    updateSettings,
  ]);

  return (
    <div className="space-y-6">
      <div id={SETTINGS_TARGETS.modelProviders} ref={providerAccessRef}>
        <SettingsSection title={t("models.accessTitle")}>
          <div className="px-4 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>
                  {t("models.configuredTitle")}
                </div>
                <p className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
                  {modelProviderStatusText(
                    connectionsQuery.data?.configuredProviderCount ?? 0,
                    connectionsQuery.data?.modelCount ?? 0,
                    t,
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={connectionsQuery.isFetching}
                onClick={() => void refreshCatalog()}
              >
                {t("actions.refresh", { ns: "common" })}
              </Button>
            </div>
          </div>
          {(connectionsQuery.data?.providers ?? []).map((provider) => (
            <ProviderCredentialRow
              key={provider.id}
              provider={provider}
              models={modelsByProvider.get(provider.id) ?? []}
              apiKey={apiKeys[provider.id] ?? ""}
              open={openProviderIds.has(provider.id)}
              busy={setKeyMutation.isPending || removeMutation.isPending}
              onApiKeyChange={(value) =>
                setApiKeys((current) => ({ ...current, [provider.id]: value }))
              }
              onToggle={() =>
                setOpenProviderIds((current) => {
                  const next = new Set(current);
                  if (next.has(provider.id)) next.delete(provider.id);
                  else next.add(provider.id);
                  return next;
                })
              }
              onSave={() =>
                setKeyMutation.mutate({
                  providerId: provider.id,
                  apiKey: apiKeys[provider.id] ?? "",
                })
              }
              onDisconnect={() => removeMutation.mutate(provider.id)}
              onTest={() => {
                void refreshCatalog().then(() =>
                  toastManager.add({
                    type: "success",
                    title: t("models.toasts.connectionRefreshed", { provider: provider.name }),
                  }),
                );
              }}
            />
          ))}
          {connectionsQuery.isError ? (
            <SettingsLoadError
              summary={t("models.runtimeUnavailable")}
              detail={settingsLoadErrorDetail(
                connectionsQuery.error,
                t("modelsRuntimeUnavailableDetail"),
              )}
              actionLabel={t("actions.refresh", { ns: "common" })}
              onAction={() => void refreshCatalog()}
            />
          ) : null}
        </SettingsSection>
      </div>

      <SettingsSection title={t("models.generationDefaultsTitle")}>
        <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>{t("models.gitWritingTitle")}</div>
            <p className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
              {t("models.gitWritingDescription")}
            </p>
          </div>
          <Select
            value={selectedGitModel}
            disabled={models.length === 0}
            onValueChange={(model) => {
              if (!model) return;
              updateSettings({ textGenerationProvider: "opencode", textGenerationModel: model });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-56"
              aria-label={t("models.gitWritingAriaLabel")}
            >
              <SelectValue>
                {models.find((model) => model.slug === selectedGitModel)?.name ??
                  (models.length > 0 ? t("models.chooseModel") : t("models.configureFirst"))}
              </SelectValue>
            </SelectTrigger>
            <SettingsSelectPopup>
              {models.map((model) => (
                <SelectItem hideIndicator key={model.slug} value={model.slug}>
                  {model.name}
                </SelectItem>
              ))}
            </SettingsSelectPopup>
          </Select>
        </div>
      </SettingsSection>
    </div>
  );
}
