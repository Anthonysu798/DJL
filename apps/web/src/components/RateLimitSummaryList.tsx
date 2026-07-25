// FILE: RateLimitSummaryList.tsx
// Purpose: Renders the compact rate-limit rows shared by the local popover and
// the dedicated rate-limit panel.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TimestampFormat } from "~/appSettings";

import type { ProviderRateLimit } from "~/lib/rateLimits";
import {
  deriveVisibleRateLimitRows,
  formatRateLimitRemainingPercent,
  formatRateLimitResetTime,
  formatRateLimitWindowLabel,
} from "~/lib/rateLimits";

export function RateLimitSummaryList({
  rateLimits,
  timestampFormat = "locale",
}: {
  rateLimits: ReadonlyArray<ProviderRateLimit>;
  timestampFormat?: TimestampFormat;
}) {
  const { t, i18n } = useTranslation("settings");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const rows = useMemo(() => deriveVisibleRateLimitRows(rateLimits), [rateLimits]);

  if (rows.length === 0) {
    return (
      <p className="text-[length:var(--app-font-size-chat-meta,10px)] text-muted-foreground">
        {t("providerUsageShared.noRateLimitData")}
      </p>
    );
  }

  return (
    <>
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center justify-between text-[length:var(--app-font-size-chat,12px)]"
        >
          <span className="font-medium text-foreground">
            {formatRateLimitWindowLabel(row.label, t)}
          </span>
          <span className="flex items-center gap-2 tabular-nums text-[length:var(--app-font-size-chat-meta,10px)] text-muted-foreground">
            <span className="text-foreground">
              {formatRateLimitRemainingPercent(row.remainingPercent, locale)}
            </span>
            {row.resetsAt ? (
              <span>{formatRateLimitResetTime(row.resetsAt, locale, timestampFormat)}</span>
            ) : null}
          </span>
        </div>
      ))}
    </>
  );
}
