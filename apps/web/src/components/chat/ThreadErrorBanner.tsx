// FILE: ThreadErrorBanner.tsx
// Purpose: Shows dismissible thread-level runtime errors above the transcript.
// Layer: Chat status presentation
// Exports: ThreadErrorBanner

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { IconButton } from "../ui/icon-button";
import { CircleAlertIcon, XIcon } from "~/lib/icons";
import { classifyProviderFailure } from "~/lib/providerFailurePresentation";
import { ChatColumnBannerFrame } from "./ChatColumnBannerFrame";
import { TechnicalDetailsDisclosure } from "./TechnicalDetailsDisclosure";

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation("chat");
  if (!error) return null;
  const failureKind = classifyProviderFailure(error);
  return (
    <ChatColumnBannerFrame>
      <Alert variant="error">
        <CircleAlertIcon />
        <AlertTitle>{t(`errors.providerFailure.${failureKind}.title`)}</AlertTitle>
        <AlertDescription>
          <span>{t(`errors.providerFailure.${failureKind}.action`)}</span>
          <TechnicalDetailsDisclosure detail={error} />
        </AlertDescription>
        {onDismiss && (
          <AlertAction>
            <IconButton
              label={t("errors.dismiss")}
              className="size-6 text-destructive/60 hover:text-destructive sm:size-6"
              onClick={onDismiss}
            >
              <XIcon className="size-3.5" />
            </IconButton>
          </AlertAction>
        )}
      </Alert>
    </ChatColumnBannerFrame>
  );
});
