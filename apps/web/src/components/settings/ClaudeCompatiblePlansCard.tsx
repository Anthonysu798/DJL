import {
  PROVIDER_DISPLAY_NAMES,
  type ClaudeCompatibleProviderId,
  type ClaudeCompatibleSetKeyInput,
} from "@djl/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "~/appSettings";
import { ProviderIcon } from "~/components/ProviderIcon";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusChip } from "~/components/ui/status-chip";
import { ExternalLinkIcon } from "~/lib/icons";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import {
  SETTINGS_ACCOUNT_ROW_ACTIONS_CLASS_NAME,
  SETTINGS_ACCOUNT_ROW_ACTIONS_INDENT_CLASS_NAME,
  SETTINGS_ACCOUNT_ROW_CLASS_NAME,
} from "~/settingsPanelStyles";
import { ensureNativeApi } from "~/nativeApi";
import { SettingsSection } from "./SettingsPanelPrimitives";
import { settingsLoadErrorDetail } from "./SettingsLoadError";

const CLAUDE_COMPATIBLE_KEYS_QUERY_KEY = ["claude-compatible-keys"] as const;
const PLANS: { id: ClaudeCompatibleProviderId; docs: string }[] = [
  { id: "doubao", docs: "https://www.volcengine.com/docs/82379/1928261" },
  { id: "deepseek", docs: "https://api-docs.deepseek.com/guides/anthropic_api" },
];

/**
 * Doubao and DeepSeek coding plans run on Claude Code with the vendor's API key, so they
 * have no sign-in of their own: the key is saved on the server and is never read back.
 */
export function ClaudeCompatiblePlansCard() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useAppSettings();
  const [drafts, setDrafts] = useState<Partial<Record<ClaudeCompatibleProviderId, string>>>({});
  const keys = useQuery({
    queryKey: CLAUDE_COMPATIBLE_KEYS_QUERY_KEY,
    queryFn: () => ensureNativeApi().harnesses.listClaudeCompatibleKeys(),
    staleTime: 15_000,
  });
  const refreshProviders = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: serverConfigQueryOptions().queryKey }),
      queryClient.invalidateQueries({ queryKey: serverQueryKeys.allProviderUsage().slice(0, 2) }),
      queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all }),
    ]);
  const saveKey = useMutation({
    mutationFn: (input: ClaudeCompatibleSetKeyInput) =>
      ensureNativeApi().harnesses.setClaudeCompatibleKey(input),
    onSuccess: async (next, { provider }) => {
      queryClient.setQueryData(CLAUDE_COMPATIBLE_KEYS_QUERY_KEY, next);
      setDrafts((current) => ({ ...current, [provider]: "" }));
      await refreshProviders();
    },
  });
  const saveRegion = useMutation({
    mutationFn: (region: "china" | "international") =>
      ensureNativeApi().server.updateSettings({ providers: { doubao: { region } } }),
    onSuccess: async (next) => {
      queryClient.setQueryData(serverQueryKeys.settings(), next);
      await refreshProviders();
    },
  });
  const busy = saveKey.isPending || saveRegion.isPending;

  return (
    <SettingsSection title={t("accounts.claudeCompatible.title")}>
      <p className="px-4 py-3 text-xs text-muted-foreground">
        {t("accounts.claudeCompatible.description")}
      </p>
      {PLANS.map((plan) => {
        const label = PROVIDER_DISPLAY_NAMES[plan.id];
        const configured = keys.data?.keys.find((key) => key.provider === plan.id)?.configured;
        const draft = drafts[plan.id] ?? "";
        return (
          <div key={plan.id} className="space-y-3 px-4 py-3.5">
            <div className={cn(SETTINGS_ACCOUNT_ROW_CLASS_NAME, "p-0")}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--color-background-elevated-secondary)]">
                <ProviderIcon provider={plan.id} className="size-[1.125rem]" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                {configured === undefined ? (
                  <Skeleton className="mt-1.5 h-3.5 w-24" />
                ) : (
                  <StatusChip
                    className={cn(
                      "mt-1 text-xs",
                      configured ? "text-foreground/80" : "text-muted-foreground",
                    )}
                    dotClassName={configured ? "bg-emerald-500" : "hidden"}
                  >
                    {t(
                      configured
                        ? "accounts.claudeCompatible.keySaved"
                        : "accounts.claudeCompatible.keyMissing",
                    )}
                  </StatusChip>
                )}
              </div>
              <div
                className={cn(
                  SETTINGS_ACCOUNT_ROW_ACTIONS_CLASS_NAME,
                  SETTINGS_ACCOUNT_ROW_ACTIONS_INDENT_CLASS_NAME,
                )}
              >
                {plan.id === "doubao" ? (
                  <select
                    aria-label={t("accounts.claudeCompatible.region")}
                    className="h-8 max-w-52 rounded-lg border bg-background px-2 text-xs sm:h-7"
                    value={settings.doubaoRegion ?? "china"}
                    disabled={busy}
                    onChange={(event) =>
                      saveRegion.mutate(event.target.value as "china" | "international")
                    }
                  >
                    <option value="china">{t("accounts.claudeCompatible.regionChina")}</option>
                    <option value="international">
                      {t("accounts.claudeCompatible.regionInternational")}
                    </option>
                  </select>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  render={<a href={plan.docs} target="_blank" rel="noreferrer" />}
                >
                  {t("accounts.claudeCompatible.getKey")}
                  <ExternalLinkIcon />
                </Button>
              </div>
            </div>
            <form
              className={cn(
                "flex flex-wrap items-center gap-2",
                SETTINGS_ACCOUNT_ROW_ACTIONS_INDENT_CLASS_NAME,
              )}
              onSubmit={(event) => {
                event.preventDefault();
                const apiKey = draft.trim();
                if (apiKey) saveKey.mutate({ provider: plan.id, apiKey });
              }}
            >
              <Input
                type="password"
                size="sm"
                className="min-w-0 basis-full @md:basis-0 @md:flex-1"
                aria-label={t("accounts.claudeCompatible.keyLabel", {
                  provider: label,
                })}
                placeholder={t(
                  configured
                    ? "accounts.claudeCompatible.replacePlaceholder"
                    : "accounts.claudeCompatible.keyPlaceholder",
                )}
                value={draft}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [plan.id]: event.target.value,
                  }))
                }
              />
              <Button type="submit" size="sm" disabled={busy || draft.trim() === ""}>
                {t("accounts.claudeCompatible.save")}
              </Button>
              {configured ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => saveKey.mutate({ provider: plan.id, apiKey: "" })}
                >
                  {t("accounts.claudeCompatible.remove")}
                </Button>
              ) : null}
              {/* Like the CLI harnesses, a plan is chosen for new chats here. */}
              {configured ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || settings.defaultProvider === plan.id}
                  onClick={() => updateSettings({ defaultProvider: plan.id })}
                >
                  {settings.defaultProvider === plan.id
                    ? t("accounts.default")
                    : t("accounts.useForNewChats")}
                </Button>
              ) : null}
            </form>
          </div>
        );
      })}
      {keys.isError || saveKey.isError || saveRegion.isError ? (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">
          {keys.isError
            ? settingsLoadErrorDetail(keys.error, t("accounts.claudeCompatible.loadError"))
            : settingsLoadErrorDetail(
                saveKey.error ?? saveRegion.error,
                t("accounts.claudeCompatible.saveError"),
              )}
        </p>
      ) : null}
    </SettingsSection>
  );
}
