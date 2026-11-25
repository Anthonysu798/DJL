// FILE: CliAccountUsage.tsx
// Purpose: What one AI account (Settings → AI accounts) has left, as limit meters. Shared by
//          the AI accounts and Usage pages; kept apart so the Usage page stays light.

import type { CliAccountUsage } from "@djl/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ProviderUsageLimitRows } from "~/components/ProviderUsageLimitRows";
import { Skeleton } from "~/components/ui/skeleton";
import { deriveProviderUsageDisplayRows } from "~/lib/providerUsageDisplay";
import { normalizeServerProviderUsageRateLimit } from "~/lib/providerUsageSnapshot";

export function AccountUsage({ usage }: { usage: CliAccountUsage | undefined }) {
  const { t, i18n } = useTranslation("settings");
  const rows = useMemo(() => {
    const limit = normalizeServerProviderUsageRateLimit(usage?.snapshot ?? null);
    return limit
      ? deriveProviderUsageDisplayRows([limit], {
          t,
          locale: i18n.resolvedLanguage ?? i18n.language,
        })
      : [];
  }, [i18n.language, i18n.resolvedLanguage, t, usage?.snapshot]);
  if (usage === undefined) return <Skeleton className="h-10 w-full rounded-lg" />;
  if (rows.length > 0) return <ProviderUsageLimitRows rows={rows} surface="settings" />;
  return (
    <p className="text-xs text-muted-foreground">
      {(usage.snapshot?.status ?? "ok") === "ok"
        ? t("aiAccounts.noUsage")
        : t("aiAccounts.usageUnavailable")}
    </p>
  );
}
