// FILE: ProviderHealthBanner.tsx
// Purpose: Surfaces provider availability warnings above the active chat.
// Layer: Chat status presentation
// Exports: ProviderHealthBanner

import { PROVIDER_DISPLAY_NAMES, type ServerProviderStatus } from "@synara/contracts";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { IconButton } from "../ui/icon-button";
import {
  EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME,
  NOTIFICATION_ICON_CLASS_NAME,
} from "../ui/notificationSurface";
import { CircleAlertIcon, TriangleAlertIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { classifyProviderFailure } from "~/lib/providerFailurePresentation";
import { ChatColumnBannerFrame } from "./ChatColumnBannerFrame";
import { TechnicalDetailsDisclosure } from "./TechnicalDetailsDisclosure";

export const ProviderHealthBanner = memo(function ProviderHealthBanner({
  onDismiss,
  status,
}: {
  onDismiss?: () => void;
  status: ServerProviderStatus | null;
}) {
  const { t } = useTranslation("chat");
  if (!status || status.status === "ready") {
    return null;
  }

  const providerLabel = PROVIDER_DISPLAY_NAMES[status.provider] ?? status.provider;
  const defaultMessage =
    status.status === "error"
      ? t("health.unavailable", { provider: providerLabel })
      : t("health.limited", { provider: providerLabel });
  const title = t("health.providerStatus", { provider: providerLabel });
  const Icon = status.status === "error" ? CircleAlertIcon : TriangleAlertIcon;
  const failureKind = classifyProviderFailure(status.message);

  return (
    <ChatColumnBannerFrame>
      <Alert
        className={cn(EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME, "pr-10")}
        variant={status.status === "error" ? "error" : "warning"}
      >
        <Icon className={NOTIFICATION_ICON_CLASS_NAME} />
        <AlertTitle className="font-normal text-[var(--notification-fg)]">
          {status.status === "error"
            ? t("health.providerNeedsAttention", { provider: providerLabel })
            : title}
        </AlertTitle>
        <AlertDescription className="text-[var(--notification-fg)]/72">
          <span>
            {status.status === "error"
              ? t(`errors.providerFailure.${failureKind}.action`)
              : defaultMessage}
          </span>
          <TechnicalDetailsDisclosure detail={status.message} />
        </AlertDescription>
        {onDismiss ? (
          <AlertAction className="absolute top-2 right-2">
            <IconButton
              className="size-6 rounded-full text-[var(--notification-fg)]/65 hover:bg-[var(--notification-fg)]/10 hover:text-[var(--notification-fg)] focus-visible:ring-[var(--notification-fg)]/35 sm:size-6"
              label={t("health.dismissProvider")}
              title={t("health.dismissProvider")}
              onClick={onDismiss}
            >
              <XIcon className="size-3.5" />
            </IconButton>
          </AlertAction>
        ) : null}
      </Alert>
    </ChatColumnBannerFrame>
  );
});
