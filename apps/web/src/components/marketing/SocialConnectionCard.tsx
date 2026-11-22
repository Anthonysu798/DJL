import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Campaign } from "@djl/contracts";
import { SocialPlatformIcon } from "./SocialPlatformIcon";
import { Button } from "~/components/ui/button";
import { openExternalLink } from "~/lib/linkChips";
import { socialState, connectSocial, disconnectSocial } from "./socialClient";

export function SocialConnectionCard({
  campaign,
  version,
}: {
  campaign: Campaign;
  version: number;
}) {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const key = ["social-accounts", campaign.threadId, campaign.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => socialState(campaign),
    refetchInterval: (query) =>
      query.state.error
        ? 5000
        : query.state.data?.attempts.some(
              (a) => a.status === "pending" || a.status === "processing",
            )
          ? 2000
          : 15000,
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function disconnect(accountId: string) {
    setBusy(true);
    setError("");
    try {
      await disconnectSocial(campaign, version, accountId);
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({
        queryKey: ["social-publishing", campaign.threadId, campaign.id],
      });
    } catch {
      setError(
        t("social.disconnectFailed", {
          defaultValue: "Could not disconnect this account. Please try again.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }
  async function connect(provider: "instagram" | "tiktok", accountId?: string) {
    setBusy(true);
    setError("");
    try {
      const result = accountId
        ? await connectSocial(campaign, version, provider, accountId)
        : await connectSocial(campaign, version, provider);
      const url = new URL(result.authorizationUrl);
      const hosts =
        provider === "instagram"
          ? ["www.instagram.com", "instagram.com"]
          : ["www.tiktok.com", "tiktok.com"];
      if (
        url.protocol !== "https:" ||
        !hosts.includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new Error(
          t("social.invalidAuthorization", {
            defaultValue: "The authorization address is invalid. Please try again later.",
          }),
        );
      openExternalLink(url.href);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("social.failed", { defaultValue: "Connection could not be started." }),
      );
    } finally {
      setBusy(false);
    }
  }
  const latest = query.data?.attempts?.[0];
  return (
    <section
      aria-label={t("social.accounts", { defaultValue: "Social accounts" })}
      className="mt-4 rounded-xl border border-border p-4"
    >
      <h4 className="text-sm font-semibold">
        {t("social.accounts", { defaultValue: "Social accounts" })}
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("social.consent", { defaultValue: "Connecting an account does not publish anything." })}
      </p>
      {(error || query.error) && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error || query.error?.message}
        </p>
      )}
      {(["instagram", "tiktok"] as const)
        .filter((p) => campaign.platforms.includes(p))
        .map((provider) => {
          const name = provider === "instagram" ? "Instagram" : "TikTok";
          const availability = query.data?.providers.find((p) => p.provider === provider);
          const accounts =
            query.data?.accounts.filter(
              (a) => a.provider === provider && a.status === "connected",
            ) ?? [];
          return (
            <div key={provider} className="mt-3 flex flex-wrap items-center gap-2">
              <span className="publishing-platform-name text-sm">
                <SocialPlatformIcon provider={provider} />
                {name}
              </span>
              {accounts.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {a.displayName || a.username} ·{" "}
                    {t("social.connected", { defaultValue: "Connected" })}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void connect(provider, a.id)}
                  >
                    {t("social.reconnect", {
                      defaultValue: "Reconnect {{platform}}",
                      platform: a.displayName || name,
                    })}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void disconnect(a.id)}
                  >
                    {t("social.disconnect", { defaultValue: "Disconnect" })}
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !availability?.available}
                onClick={() => void connect(provider)}
              >
                {accounts.length
                  ? t("social.addAccount", {
                      defaultValue: "Add {{platform}} account",
                      platform: name,
                    })
                  : t("social.connect", { defaultValue: "Connect {{platform}}", platform: name })}
              </Button>
              {availability && !availability.available && (
                <p className="w-full text-xs text-muted-foreground">
                  {t("social.unavailable", {
                    defaultValue:
                      "{{platform}} connection is not available yet. DJL needs to finish platform setup.",
                    platform: name,
                  })}
                </p>
              )}
            </div>
          );
        })}
      {campaign.platforms.includes("red") && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("social.redUnavailable", {
            defaultValue:
              "RED direct publishing is not available. You can still export a manual publishing package.",
          })}
        </p>
      )}
      {latest && (latest.status === "pending" || latest.status === "processing") && (
        <p role="status" className="mt-3 text-xs">
          {t("social.waiting", {
            defaultValue:
              "Waiting for authorization in your browser. This card updates automatically.",
          })}
        </p>
      )}
      {latest && ["failed", "cancelled", "expired"].includes(latest.status) && (
        <p role="status" className="mt-3 text-xs">
          {t("social.retry", {
            defaultValue:
              "Authorization was not completed. Use Connect to try again, or change the campaign platforms.",
          })}
        </p>
      )}
    </section>
  );
}
