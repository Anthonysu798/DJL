// FILE: AssistantSelectionsSummaryChip.tsx
// Purpose: Renders the compact assistant-selection count chip used in composer and user bubbles.
// Layer: Chat attachment presentation

import { useTranslation } from "react-i18next";

import { MessageCircleIcon } from "~/lib/icons";
import { type ChatAssistantSelectionAttachment } from "../../types";
import { AttachmentSummaryChip } from "./AttachmentSummaryChip";

interface AssistantSelectionsSummaryChipProps {
  selections: ReadonlyArray<ChatAssistantSelectionAttachment>;
  onRemove?: (() => void) | undefined;
}

export function AssistantSelectionsSummaryChip(props: AssistantSelectionsSummaryChipProps) {
  const { t } = useTranslation("chat");
  if (props.selections.length === 0) {
    return null;
  }

  return (
    <AttachmentSummaryChip
      icon={MessageCircleIcon}
      label={t("references.selectionCount", { count: props.selections.length })}
      removeLabel={t("references.removeSelections")}
      onRemove={props.onRemove}
      tooltip={props.selections.map((selection) => (
        <p key={selection.id} className="text-xs leading-relaxed">
          {selection.text}
        </p>
      ))}
    />
  );
}
