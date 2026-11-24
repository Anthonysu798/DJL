// FILE: SubscriptionPlansPanel.tsx
// Purpose: Connect API-key coding plans on the provider's own site. DJL validates the pasted key,
// keeps it in its own secret store, and runs the plan's models through Claude Code.

import {
  CODING_PLANS,
  type CodingPlanConnectError,
  type CodingPlanConnectResult,
  type CodingPlanDefinition,
} from "@djl/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { SETTINGS_TARGETS } from "~/settingsNavigation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsLoadError, settingsLoadErrorDetail } from "./SettingsLoadError";
import { SettingsSection } from "./SettingsPanelPrimitives";

export const CODING_PLANS_QUERY_KEY = ["coding-plans"] as const;

function openExternal(url: string): void {
  void ensureNativeApi()
    .shell.openExternal(url)
    .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}

type PlanOutcome = { kind: "saved" } | { kind: "error"; error: CodingPlanConnectError };

function PlanRow(props: {
  plan: CodingPlanDefinition;
  showRegion: boolean;
  connected: boolean;
  keyHint: string | undefined;
  openCodeKeyAvailable: boolean;
  busy: boolean;
  onSave: (apiKey: string) => Promise<CodingPlanConnectResult>;
  onImport: () => Promise<CodingPlanConnectResult>;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation("settings");
  const { plan } = props;
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [outcome, setOutcome] = useState<PlanOutcome | null>(null);
  const [checking, setChecking] = useState(false);
  const provider = plan.name;

  const finish = (result: CodingPlanConnectResult) => {
    if (result.connected) {
      setApiKey("");
      setOpen(false);
      setOutcome({ kind: "saved" });
    } else setOutcome({ kind: "error", error: result.error ?? "unknown" });
  };
  const run = async (action: () => Promise<CodingPlanConnectResult>) => {
    setChecking(true);
    setOutcome(null);
    try {
      finish(await action());
    } catch {
      setOutcome({ kind: "error", error: "network" });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div role="group" aria-label={`${plan.name} ${t(`subscriptions.${plan.region}`)}`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-4">
        <div className="min-w-40 flex-1">
          <div className="text-sm font-medium">{plan.name}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {props.showRegion ? <span>{t(`subscriptions.${plan.region}`)}</span> : null}
            <span>{t("subscriptions.planKey")}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {props.connected
              ? t("subscriptions.connected", { hint: props.keyHint ?? "" })
              : t("subscriptions.notConnected")}
          </p>
        </div>
        <a
          href={plan.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          {t("accounts.setup")}
        </a>
        {props.openCodeKeyAvailable && !props.connected ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={props.busy || checking}
            onClick={() => void run(props.onImport)}
          >
            {t("subscriptions.importFromOpenCode")}
          </Button>
        ) : null}
        {props.connected ? (
          <Button
            size="sm"
            variant="destructive-outline"
            disabled={props.busy || checking}
            onClick={() => {
              setOutcome(null);
              props.onDisconnect();
            }}
          >
            {t("subscriptions.disconnect")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={props.busy || checking}
          onClick={() => {
            openExternal(plan.keyUrl);
            setOutcome(null);
            setOpen(true);
          }}
        >
          {t(props.connected ? "subscriptions.replaceKey" : "subscriptions.connect")}
        </Button>
      </div>
      {open ? (
        <form
          className="mx-4 mb-4 space-y-3 rounded-lg border border-border/70 bg-muted/30 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const key = apiKey.trim();
            if (key) void run(() => props.onSave(key));
          }}
        >
          <ol className="list-decimal space-y-1 ps-5 text-xs text-muted-foreground">
            <li>{t("subscriptions.steps.signIn", { provider })}</li>
            <li>{t("subscriptions.steps.copyKey")}</li>
            <li>{t("subscriptions.steps.paste", { provider })}</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              size="sm"
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="min-w-56 flex-1"
              aria-label={t("subscriptions.keyAriaLabel", { provider })}
              placeholder={t("subscriptions.keyPlaceholder")}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <Button size="sm" type="submit" disabled={!apiKey.trim() || checking || props.busy}>
              {checking ? t("subscriptions.checking") : t("subscriptions.save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={checking}
              onClick={() => {
                setOpen(false);
                setApiKey("");
                setOutcome(null);
              }}
            >
              {t("subscriptions.cancel")}
            </Button>
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-4"
            onClick={() => openExternal(plan.keyUrl)}
          >
            {t("subscriptions.openSite", { provider })}
          </button>
        </form>
      ) : null}
      {outcome ? (
        <p
          role={outcome.kind === "error" ? "alert" : "status"}
          className={
            outcome.kind === "error"
              ? "mx-4 mb-4 text-xs text-destructive"
              : "mx-4 mb-4 text-xs text-muted-foreground"
          }
        >
          {outcome.kind === "saved"
            ? t("subscriptions.saved", { provider })
            : t(`subscriptions.errors.${outcome.error}`, { provider })}
        </p>
      ) : null}
    </div>
  );
}

export function SubscriptionPlansPanel(props: { reveal?: boolean }) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const plans = useQuery({
    queryKey: CODING_PLANS_QUERY_KEY,
    queryFn: () => ensureNativeApi().codingPlans.list(),
    staleTime: 15_000,
  });
  useEffect(() => {
    if (props.reveal) sectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [props.reveal]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CODING_PLANS_QUERY_KEY }),
      // Connected plans add or remove Claude Code picker models.
      queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all }),
    ]);
  };
  const afterChange = async (result: CodingPlanConnectResult) => {
    if (result.connected) await refresh();
    return result;
  };
  const disconnect = useMutation({
    mutationFn: (planId: string) => ensureNativeApi().codingPlans.disconnect({ planId }),
    onSettled: refresh,
  });
  const regionalNames = new Set(
    CODING_PLANS.filter(
      (plan, _index, all) => all.filter((other) => other.name === plan.name).length > 1,
    ).map((plan) => plan.name),
  );

  return (
    <div ref={sectionRef} id={SETTINGS_TARGETS.modelProviders}>
      <SettingsSection title={t("subscriptions.title")}>
        <p className="px-4 py-4 text-sm text-muted-foreground">{t("subscriptions.description")}</p>
        {plans.isError ? (
          <div className="px-4 py-3">
            <SettingsLoadError
              summary={t("accounts.loadError")}
              detail={settingsLoadErrorDetail(plans.error, t("accounts.loadError"))}
              actionLabel={t("accounts.refresh")}
              onAction={() => void plans.refetch()}
            />
          </div>
        ) : null}
        {CODING_PLANS.map((plan) => {
          const status = plans.data?.plans.find((item) => item.planId === plan.id);
          return (
            <PlanRow
              key={plan.id}
              plan={plan}
              showRegion={regionalNames.has(plan.name) || plan.region === "china"}
              connected={status?.connected ?? false}
              keyHint={status?.keyHint}
              openCodeKeyAvailable={status?.openCodeKeyAvailable ?? false}
              busy={disconnect.isPending}
              onSave={(apiKey) =>
                ensureNativeApi().codingPlans.connect({ planId: plan.id, apiKey }).then(afterChange)
              }
              onImport={() =>
                ensureNativeApi()
                  .codingPlans.importFromOpenCode({ planId: plan.id })
                  .then(afterChange)
              }
              onDisconnect={() => disconnect.mutate(plan.id)}
            />
          );
        })}
        <p className="px-4 py-3 text-xs text-muted-foreground">{t("subscriptions.modelPicker")}</p>
      </SettingsSection>
    </div>
  );
}
