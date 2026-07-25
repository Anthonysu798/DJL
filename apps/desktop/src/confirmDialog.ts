import { type BrowserWindow, dialog } from "electron";
import { desktopT, type DesktopTranslate } from "./desktopI18n";

const CONFIRM_BUTTON_INDEX = 1;

export async function showDesktopConfirmDialog(
  message: string,
  ownerWindow: BrowserWindow | null,
  t: DesktopTranslate = desktopT,
): Promise<boolean> {
  const normalizedMessage = message.trim();
  if (normalizedMessage.length === 0) {
    return false;
  }

  const options = {
    type: "question" as const,
    buttons: [t("dialog.no"), t("dialog.yes")],
    defaultId: CONFIRM_BUTTON_INDEX,
    cancelId: 0,
    noLink: true,
    message: normalizedMessage,
  };
  const result = ownerWindow
    ? await dialog.showMessageBox(ownerWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === CONFIRM_BUTTON_INDEX;
}
