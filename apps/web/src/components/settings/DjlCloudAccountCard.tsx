import type {
  CloudAccountStatus,
  CloudBrowserSignInCompleteInput,
  CloudSignInStartResult,
} from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "~/appSettings";
import { Button } from "~/components/ui/button";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { cloudSignInUrl, type CloudSignInMethod } from "~/lib/cloudSignInUrl";
import { SettingsSection } from "./SettingsPanelPrimitives";
import { settingsLoadErrorDetail } from "./SettingsLoadError";
import { UsageProgressTrack } from "~/components/UsageProgressTrack";
import { formatRateLimitResetCountdown } from "~/lib/rateLimits";

export const CLOUD_ACCOUNT_QUERY_KEY = ["cloud-account"] as const;

function openExternalLink(url: string): void {
  void ensureNativeApi()
    .shell.openExternal(url)
    .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}
const BILLING_URL = `${(import.meta.env.VITE_DJL_CLOUD_WEB_URL ?? "https://app.slcor.com").replace(/\/+$/, "")}/billing`;

type SignInPhase =
  | { kind: "idle" }
  | { kind: "browser"; authorizeUrl: string }
  | { kind: "waiting"; start: CloudSignInStartResult }
  | { kind: "failed"; reason: "denied" | "expired" };

/**
 * DJL Cloud account: sign in through the browser (the page hands the app a
 * one-time code over the djl:// deep link), or with the OAuth device flow (a
 * short code approved in the browser) as the fallback; show credits; choose it
 * for new chats. Rendered above the CLI harness accounts because it is the
 * first-party provider.
 */
export function DjlCloudAccountCard({ showUsage = false }: { showUsage?: boolean }) {
  const { t, i18n } = useTranslation("settings");
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
    await queryClient.cancelQueries({ queryKey: CLOUD_ACCOUNT_QUERY_KEY });
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

  const completeBrowserSignIn = useMutation({
    mutationFn: (callback: CloudBrowserSignInCompleteInput) =>
      ensureNativeApi().cloud.completeBrowserSignIn(callback),
    onSuccess: async (next) => {
      setPhase({ kind: "idle" });
      await afterAccountChange(next);
    },
    onError: () => setPhase({ kind: "idle" }),
  });
  const { mutate: completeWithCallback } = completeBrowserSignIn;
  useEffect(() => {
    if (phase.kind !== "browser") return;
    return window.desktopBridge?.onCloudAuthCallback?.((callback) =>
      completeWithCallback(callback),
    );
  }, [completeWithCallback, phase.kind]);

  const browserSignIn = useMutation({
    mutationFn: (_method: CloudSignInMethod) => ensureNativeApi().cloud.startBrowserSignIn(),
    onSuccess: ({ authorizeUrl }, method) => {
      const selectedUrl = cloudSignInUrl(authorizeUrl, method);
      stopPolling();
      completeBrowserSignIn.reset();
      setPhase({ kind: "browser", authorizeUrl: selectedUrl });
      openExternalLink(selectedUrl);
    },
  });

  const signIn = useMutation({
    mutationFn: (_method: CloudSignInMethod) => ensureNativeApi().cloud.startSignIn(),
    onSuccess: (start, method) => {
      setPhase({ kind: "waiting", start });
      openExternalLink(
        cloudSignInUrl(start.verificationUriComplete ?? start.verificationUri, method),
      );
      poll(start, Math.max(start.intervalSeconds, 3));
    },
  });
  const signOut = useMutation({
    onMutate: () => queryClient.cancelQueries({ queryKey: CLOUD_ACCOUNT_QUERY_KEY }),
    mutationFn: () => ensureNativeApi().cloud.signOut(),
    onSuccess: async (next) => {
      stopPolling();
      setPhase({ kind: "idle" });
      await afterAccountChange(next);
    },
  });
  const cancel = () => {
    completeBrowserSignIn.reset();
    stopPolling();
    setPhase({ kind: "idle" });
  };

  const data = status.data;
  // Unpackaged macOS/Linux apps cannot reliably receive OS URL callbacks.
  const development = window.desktopBridge?.getBuildInfo?.().kind === "development";
  const startSelectedSignIn = (method: CloudSignInMethod) =>
    development ? signIn.mutate(method) : browserSignIn.mutate(method);
  const signingIn =
    browserSignIn.isPending ||
    signIn.isPending ||
    completeBrowserSignIn.isPending ||
    phase.kind === "browser" ||
    phase.kind === "waiting";
  const signedIn = Boolean(data?.signedIn && data.problem !== "session_expired");
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
          {showUsage && (
            <Button
              size="sm"
              variant="outline"
              disabled={status.isFetching}
              onClick={() => void status.refetch()}
            >
              {t("actions.refresh", { ns: "common" })}
            </Button>
          )}
          {signedIn ? (
            <>
              <Button size="sm" variant="outline" onClick={() => openExternalLink(BILLING_URL)}>
                {t("cloud.buyCredits")}
              </Button>
              {!showUsage && (
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
              )}
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
            <>
              <Button
                size="sm"
                disabled={signingIn || status.isPending}
                onClick={() => startSelectedSignIn("email")}
              >
                {browserSignIn.isPending || completeBrowserSignIn.isPending
                  ? t("accounts.checking")
                  : t("cloud.signInWithEmail")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={signingIn || status.isPending}
                onClick={() => startSelectedSignIn("google")}
              >
                <img src="/google-sign-in.png" alt="" className="size-4" />
                {t("cloud.signInWithGoogle")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={signIn.isPending || phase.kind === "waiting" || status.isLoading}
                onClick={() => signIn.mutate("email")}
              >
                {t("cloud.useCodeInstead")}
              </Button>
            </>
          )}
        </div>
        {showUsage && signedIn && !data?.problem && (
          <div className="space-y-4 border-t pt-4">
            {data?.usage ? (
              <>
                <div className="text-xs text-muted-foreground">{data.usage.planId}</div>
                {[data.usage.windows.fiveHour, data.usage.windows.week].map((window) => {
                  const label = t(
                    window.kind === "five_hour"
                      ? "usage.rateLimits.fiveHours"
                      : "usage.rateLimits.weekly",
                  );
                  const limit = Number(window.limit);
                  const remaining = Number(window.remaining);
                  const percent =
                    limit > 0 && Number.isFinite(limit) && Number.isFinite(remaining)
                      ? Math.min(100, Math.max(0, (remaining / limit) * 100))
                      : null;
                  const remainingLabel =
                    percent === null
                      ? null
                      : new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, {
                          style: "percent",
                          maximumFractionDigits: 0,
                        }).format(percent / 100);
                  return (
                    <div key={window.kind} className="space-y-2">
                      <div className="text-xs font-medium">{label}</div>
                      {percent !== null && remainingLabel ? (
                        <>
                          <UsageProgressTrack
                            label={t("usage.remainingAriaLabel", {
                              label,
                              remaining: remainingLabel,
                            })}
                            remainingPercent={percent}
                            fillClassName="bg-emerald-500"
                            markerClassName="bg-emerald-500"
                          />
                          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                            <span>{t("usage.left", { remaining: remainingLabel })}</span>
                            {window.resetsAt && (
                              <span>{formatRateLimitResetCountdown(window.resetsAt, t)}</span>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">{t("usage.noData")}</p>
                      )}
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  {t("cloud.bankedResets", { count: data.usage.banks.count })}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t("cloud.usageUnavailable")}</p>
            )}
          </div>
        )}
        {phase.kind === "browser" ? (
          <div className="space-y-2 rounded-lg border px-4 py-3" role="status">
            <p className="text-sm text-muted-foreground">{t("cloud.finishInBrowser")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openExternalLink(phase.authorizeUrl)}
              >
                {t("cloud.openBrowser")}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel}>
                {t("cloud.cancel")}
              </Button>
            </div>
          </div>
        ) : null}
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
        {completeBrowserSignIn.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("cloud.browserFailed")}
          </p>
        ) : null}
        {status.isError || signIn.isError || browserSignIn.isError || signOut.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {settingsLoadErrorDetail(
              status.error ?? signIn.error ?? browserSignIn.error ?? signOut.error,
              t("cloud.error"),
            )}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("cloud.description")}</p>
      </div>
    </SettingsSection>
  );
}
