import type { CloudAccountStatus, CloudSignInStartResult } from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "~/appSettings";
import { Button } from "~/components/ui/button";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { SettingsSection } from "./SettingsPanelPrimitives";
import { settingsLoadErrorDetail } from "./SettingsLoadError";

export const CLOUD_ACCOUNT_QUERY_KEY = ["cloud-account"] as const;

function openExternalLink(url: string): void {
  void ensureNativeApi()
    .shell.openExternal(url)
    .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}
const BILLING_URL = "https://app.slcor.com/billing";

type SignInPhase =
  | { kind: "idle" }
  | { kind: "waiting"; start: CloudSignInStartResult }
  | { kind: "failed"; reason: "denied" | "expired" };

/**
 * DJL Cloud account: sign in with the OAuth device flow (a short code approved
 * in the browser), show credits, and choose it for new chats. Rendered above the
 * CLI harness accounts because it is the first-party provider.
 */
export function DjlCloudAccountCard() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useAppSettings();
  const [phase, setPhase] = useState<SignInPhase>({ kind: "idle" });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const status = useQuery({
    queryKey: CLOUD_ACCOUNT_QUERY_KEY,
    queryFn: () => ensureNativeApi().cloud.getStatus(),
    staleTime: 15_000,
  });

  const afterAccountChange = async (next: CloudAccountStatus) => {
    queryClient.setQueryData(CLOUD_ACCOUNT_QUERY_KEY, next);
    await Promise.all([
      ensureNativeApi()
        .server.refreshProviders()
        .then(() =>
          queryClient.invalidateQueries({ queryKey: serverConfigQueryOptions().queryKey }),
        )
        .catch(() => undefined),
      queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all }),
    ]);
  };

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const poll = (start: CloudSignInStartResult, intervalSeconds: number) => {
    stopPolling();
    pollTimer.current = setTimeout(async () => {
      try {
        const result = await ensureNativeApi().cloud.pollSignIn({ deviceCode: start.deviceCode });
        if (result.state === "complete") {
          setPhase({ kind: "idle" });
          await afterAccountChange(result.status);
          return;
        }
        if (result.state === "denied" || result.state === "expired") {
          setPhase({ kind: "failed", reason: result.state });
          return;
        }
        poll(start, result.state === "slow_down" ? result.intervalSeconds : intervalSeconds);
      } catch {
        poll(start, Math.min(intervalSeconds * 2, 30));
      }
    }, intervalSeconds * 1000);
  };

  useEffect(() => stopPolling, []);

  const signIn = useMutation({
    mutationFn: () => ensureNativeApi().cloud.startSignIn(),
    onSuccess: (start) => {
      setPhase({ kind: "waiting", start });
      openExternalLink(start.verificationUriComplete ?? start.verificationUri);
      poll(start, Math.max(start.intervalSeconds, 3));
    },
  });
  const signOut = useMutation({
    mutationFn: () => ensureNativeApi().cloud.signOut(),
    onSuccess: async (next) => {
      await afterAccountChange(next);
    },
  });
  const cancel = () => {
    stopPolling();
    setPhase({ kind: "idle" });
  };

  const data = status.data;
  const signedIn = Boolean(data?.signedIn && !data.problem);
  const statusLine = !data
    ? t("accounts.checking")
    : data.problem === "session_expired"
      ? t("cloud.sessionExpired")
      : data.problem === "unreachable"
        ? t("cloud.unreachable")
        : data.problem === "suspended"
          ? t("cloud.suspended")
          : data.signedIn
            ? t("cloud.signedInAs", { email: data.email ?? "" })
            : t("cloud.signedOut");

  return (
    <SettingsSection title={t("cloud.title")}>
      <div className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-40 flex-1">
            <div className="text-sm font-medium">{t("cloud.name")}</div>
            <div className="mt-1 text-xs text-muted-foreground">{statusLine}</div>
            {signedIn && data?.credits ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {t("cloud.credits", { credits: data.credits.display.total })}
              </div>
            ) : null}
          </div>
          {signedIn ? (
            <>
              <Button size="sm" variant="outline" onClick={() => openExternalLink(BILLING_URL)}>
                {t("cloud.buyCredits")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={settings.defaultProvider === "djlCloud"}
                onClick={() => updateSettings({ defaultProvider: "djlCloud" })}
              >
                {settings.defaultProvider === "djlCloud"
                  ? t("accounts.default")
                  : t("accounts.useForNewChats")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate()}
              >
                {t("cloud.signOut")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={signIn.isPending || phase.kind === "waiting" || status.isLoading}
              onClick={() => signIn.mutate()}
            >
              {signIn.isPending ? t("accounts.checking") : t("cloud.signIn")}
            </Button>
          )}
        </div>
        {phase.kind === "waiting" ? (
          <div className="space-y-2 rounded-lg border px-4 py-3" role="status">
            <p className="text-sm text-muted-foreground">{t("cloud.enterCode")}</p>
            <p className="font-mono text-lg tracking-widest">{phase.start.userCode}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  openExternalLink(
                    phase.start.verificationUriComplete ?? phase.start.verificationUri,
                  )
                }
              >
                {t("cloud.openBrowser")}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel}>
                {t("cloud.cancel")}
              </Button>
            </div>
          </div>
        ) : null}
        {phase.kind === "failed" ? (
          <p role="alert" className="text-sm text-destructive">
            {phase.reason === "denied" ? t("cloud.denied") : t("cloud.expired")}
          </p>
        ) : null}
        {status.isError || signIn.isError || signOut.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {settingsLoadErrorDetail(
              status.error ?? signIn.error ?? signOut.error,
              t("cloud.error"),
            )}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("cloud.description")}</p>
      </div>
    </SettingsSection>
  );
}
