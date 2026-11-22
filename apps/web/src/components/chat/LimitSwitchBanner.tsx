// FILE: LimitSwitchBanner.tsx
// Purpose: The chat's rate-limit banner, extended with a low-quota notice and a
// "Continue with <agent>" handoff to the signed-in agent with the most quota left.
// Nothing switches until the user clicks.

import { PROVIDER_DISPLAY_NAMES, type ServerProviderStatus } from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useThreadHandoff } from "~/hooks/useThreadHandoff";
import {
  isRateLimitError,
  limitSwitchNoticeKey,
  pickLimitSwitchTarget,
  selectLowLimitRow,
} from "~/lib/limitSwitch";
import { createAccountRateLimitsSelector } from "~/lib/rateLimits";
import {
  serverAllProviderUsageQueryOptions,
  serverConfigQueryOptions,
} from "~/lib/serverReactQuery";
import { deriveUsageRingEntries } from "~/lib/usageRing";
import { useStore } from "~/store";
import type { Thread } from "~/types";

import { toastManager } from "../ui/toast";
import { RateLimitBanner, type RateLimitStatus } from "./RateLimitBanner";

const EMPTY_PROVIDER_STATUSES: ReadonlyArray<ServerProviderStatus> = [];
// Dismissed low-limit notices for this app session; keys name the window and its reset.
const dismissedNoticeKeys = new Set<string>();

export function LimitSwitchBanner(props: {
  thread: Thread;
  handoffDisabled: boolean;
  rateLimitStatus: RateLimitStatus | null;
  onDismiss: () => void;
}) {
  const { thread, rateLimitStatus } = props;
  const { t, i18n } = useTranslation("chat");
  const { t: tSettings } = useTranslation("settings");
  // Same queries as the sidebar usage ring, so they share its cache.
  const usage = useQuery(serverAllProviderUsageQueryOptions());
  const config = useQuery(serverConfigQueryOptions());
  const liveRateLimits = useStore(useMemo(() => createAccountRateLimitsSelector(), []));
  const { createThreadHandoff, isCreatingHandoff } = useThreadHandoff();
  const [, setDismissCount] = useState(0);
  const providerStatuses = config.data?.providers ?? EMPTY_PROVIDER_STATUSES;
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const entries = useMemo(
    () =>
      deriveUsageRingEntries({
        snapshots: usage.data ?? [],
        providerStatuses,
        cloud: null,
        liveRateLimits,
        t: tSettings,
        locale,
      }),
    [liveRateLimits, locale, providerStatuses, tSettings, usage.data],
  );

  const current = thread.session?.provider ?? thread.modelSelection.provider;
  const agent = PROVIDER_DISPLAY_NAMES[current];
  const lowRow = selectLowLimitRow(entries.find((entry) => entry.provider === current));
  const limitedByError = isRateLimitError(thread.error);
  const noticeKey = lowRow
    ? limitSwitchNoticeKey(lowRow)
    : limitedByError
      ? `${current}|error|${thread.error}`
      : null;
  const notice =
    noticeKey === null || dismissedNoticeKeys.has(noticeKey)
      ? null
      : lowRow
        ? [
            t("health.rateLimit.lowLimit", {
              agent,
              remaining: lowRow.remainingLabel,
              window: lowRow.label,
            }),
            lowRow.resetText,
          ]
            .filter(Boolean)
            .join(" ")
        : t("health.rateLimit.agentLimited", { agent });
  const needsSwitch = Boolean(
    (notice || rateLimitStatus) &&
    (lowRow || limitedByError || rateLimitStatus?.status === "rejected"),
  );
  const target = needsSwitch ? pickLimitSwitchTarget({ current, entries, providerStatuses }) : null;

  return (
    <RateLimitBanner
      rateLimitStatus={rateLimitStatus}
      notice={notice}
      onDismiss={() => {
        props.onDismiss();
        if (noticeKey) dismissedNoticeKeys.add(noticeKey);
        setDismissCount((count) => count + 1);
      }}
      switchAction={
        target
          ? {
              label: t("health.rateLimit.continueWith", { agent: target.name }),
              disabled: props.handoffDisabled || isCreatingHandoff,
              onClick: () => {
                void createThreadHandoff(thread, target.provider, {
                  prompt: t("commandMenu.continueTask"),
                })
                  .then(() => {
                    toastManager.add({
                      type: "success",
                      title: t("commandMenu.handoffReady"),
                      description: t("commandMenu.handoffReadyDescription"),
                    });
                  })
                  .catch((error: unknown) => {
                    toastManager.add({
                      type: "error",
                      title: t("errors.createHandoff"),
                      description:
                        error instanceof Error ? error.message : t("errors.createHandoffFallback"),
                    });
                  });
              },
            }
          : null
      }
    />
  );
}
