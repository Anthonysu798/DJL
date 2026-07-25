// FILE: QueuedComposerActions.tsx
// Purpose: Inline action cluster (Steer / Delete / Menu) rendered on each queued
// composer row. Used in both the compact and expanded composer layouts so the
// action chrome stays in lockstep across surfaces.
// Layer: Chat composer UI primitive
// Exports: QueuedComposerActions

import { EllipsisIcon, SteerIcon, Trash2 } from "~/lib/icons";

import type { QueuedComposerTurn } from "../../composerDraftStore";

import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { useTranslation } from "react-i18next";

type QueuedComposerActionsProps = {
  queuedTurn: QueuedComposerTurn;
  onSteer: (queuedTurn: QueuedComposerTurn) => void;
  onRemove: (queuedTurnId: string) => void;
  onEdit: (queuedTurn: QueuedComposerTurn) => void;
};

function QueuedComposerActions({
  queuedTurn,
  onSteer,
  onRemove,
  onEdit,
}: QueuedComposerActionsProps) {
  const { t } = useTranslation("chat");

  return (
    <div className="flex shrink-0 items-center gap-0">
      <Button variant="subtle" size="chip" onClick={() => void onSteer(queuedTurn)}>
        <SteerIcon />
        <span>{t("queue.steer")}</span>
      </Button>
      <IconButton
        variant="ghost"
        size="icon-chip"
        label={t("queue.deleteFollowUp")}
        onClick={() => onRemove(queuedTurn.id)}
      >
        <Trash2 />
      </IconButton>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-chip"
              aria-label={t("queue.actions")}
              className="[&_svg]:mx-0"
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="end" side="top" sideOffset={6}>
          <MenuItem onClick={() => onEdit(queuedTurn)}>{t("queue.editPrompt")}</MenuItem>
          <MenuItem onClick={() => onRemove(queuedTurn.id)}>{t("queue.deletePrompt")}</MenuItem>
        </ComposerPickerMenuPopup>
      </Menu>
    </div>
  );
}

export { QueuedComposerActions };
