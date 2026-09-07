import type { HarnessLoginInput } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ensureNativeApi } from "~/nativeApi";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { Button } from "../ui/button";
import { SettingsSection } from "./SettingsPanelPrimitives";
import { SettingsLoadError, settingsLoadErrorDetail } from "./SettingsLoadError";

// IDs come from the official OpenCode provider catalog. Regional subscriptions
// are distinct credentials; never fall back to a metered/general API provider.
const PLANS = [
  {
    id: "zai-coding-plan",
    name: "Z.AI Coding Plan",
    region: "international",
    auth: "planKey",
    docs: "https://docs.z.ai/devpack/tool/opencode",
  },
  {
    id: "zhipuai-coding-plan",
    name: "Zhipu AI Coding Plan",
    region: "china",
    auth: "planKey",
    docs: "https://docs.bigmodel.cn/cn/guide/develop/opencode",
  },
  {
    id: "kimi-for-coding",
    name: "Kimi For Coding",
    region: null,
    auth: "planKey",
    docs: "https://www.kimi.com/code/docs/en/third-party-tools/opencode.html",
  },
  {
    id: "minimax-coding-plan",
    name: "MiniMax Token Plan",
    region: "international",
    auth: "planKey",
    docs: "https://platform.minimax.io/docs/token-plan/other-tools",
  },
  {
    id: "minimax-cn-coding-plan",
    name: "MiniMax Token Plan (China)",
    region: "china",
    auth: "planKey",
    docs: "https://platform.minimaxi.com/docs/token-plan/other-tools",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    region: null,
    auth: "providerLogin",
    docs: "https://opencode.ai/docs/providers/#github-copilot",
  },
  {
    id: "gitlab",
    name: "GitLab Duo",
    region: null,
    auth: "providerLogin",
    docs: "https://opencode.ai/docs/providers/#gitlab-duo",
  },
] as const;

export function SubscriptionPlansPanel({
  enabled,
  disabled,
  onConnect,
}: {
  enabled: boolean;
  disabled: boolean;
  onConnect: (request: HarnessLoginInput) => void;
}) {
  const { t } = useTranslation("settings");
  const catalog = useQuery({
    queryKey: providerDiscoveryQueryKeys.openCodeModelProviders(),
    queryFn: () => ensureNativeApi().provider.listModelProviders({}),
    enabled,
    staleTime: 15_000,
  });
  return (
    <SettingsSection title={t("subscriptions.title")}>
      <p className="px-4 py-4 text-sm text-muted-foreground">{t("accounts.subscriptionNote")}</p>
      {catalog.isError && enabled ? (
        <div className="px-4 py-3">
          <SettingsLoadError
            summary={t("accounts.loadError")}
            detail={settingsLoadErrorDetail(catalog.error, t("accounts.loadError"))}
            actionLabel={t("accounts.refresh")}
            onAction={() => void catalog.refetch()}
          />
        </div>
      ) : null}
      {PLANS.map((plan) => {
        const provider = catalog.data?.providers.find((item) => item.id === plan.id);
        const available = enabled && !!provider && !catalog.isError && !provider.error;
        const status = !enabled
          ? t("subscriptions.runtimeRequired")
          : catalog.isError || provider?.error
            ? t("accounts.status.unknown")
            : catalog.isPending
              ? t("accounts.checking")
              : !provider
                ? t("subscriptions.unavailable")
                : t(provider.connected ? "accounts.status.ready" : "accounts.status.required");
        return (
          <div
            key={plan.id}
            role="group"
            aria-label={plan.name}
            className="flex flex-wrap items-center gap-3 px-4 py-4"
          >
            <div className="min-w-40 flex-1">
              <div className="text-sm font-medium">{plan.name}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {plan.region ? <span>{t(`subscriptions.${plan.region}`)}</span> : null}
                <span>{t(`subscriptions.${plan.auth}`)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{status}</p>
              {available && provider.connected ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("subscriptions.models", { count: provider.modelCount })}
                </p>
              ) : null}
            </div>
            <a
              href={plan.docs}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              {t("accounts.setup")}
            </a>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !available || catalog.isFetching}
              onClick={() => onConnect({ harness: "opencode", modelProviderId: plan.id })}
            >
              {t("subscriptions.connect")}
            </Button>
          </div>
        );
      })}
      <p className="px-4 py-3 text-xs text-muted-foreground">{t("subscriptions.modelPicker")}</p>
    </SettingsSection>
  );
}
