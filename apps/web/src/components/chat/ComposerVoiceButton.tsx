// FILE: ComposerVoiceButton.tsx
// Purpose: Renders the composer mic control for recording and transcribing a voice note.
// Layer: Chat composer presentation
// Depends on: shared button styling and caller-owned voice recording state callbacks.

import { memo } from "react";
import { useTranslation } from "react-i18next";

import { Loader2Icon, MicIcon } from "~/lib/icons";
import { Button } from "../ui/button";

export const ComposerVoiceButton = memo(function ComposerVoiceButton(props: {
  disabled?: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  durationLabel: string;
  onClick: () => void;
}) {
  const { t } = useTranslation("chat");
  const label = props.isTranscribing
    ? t("voice.transcribing")
    : props.isRecording
      ? t("voice.stop", { duration: props.durationLabel })
      : t("voice.record");

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="shrink-0 rounded-md"
      disabled={props.disabled || props.isTranscribing}
      aria-label={label}
      title={label}
      onClick={props.onClick}
    >
      {props.isTranscribing ? (
        <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <MicIcon aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
});
