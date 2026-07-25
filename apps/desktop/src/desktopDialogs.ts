import type { MessageBoxOptions } from "electron";
import type { DesktopUpdateState } from "@synara/contracts";
import type { DesktopTranslate } from "./desktopI18n";

export function buildDisabledUpdatesDialog(
  t: DesktopTranslate,
  diagnosticDetail: string,
): MessageBoxOptions {
  return {
    type: "info",
    title: t("dialog.updates.disabledTitle"),
    message: t("dialog.updates.disabledMessage"),
    detail: diagnosticDetail,
    buttons: [t("dialog.ok")],
  };
}

export function buildUpdateResultDialog(
  t: DesktopTranslate,
  state: DesktopUpdateState,
  appName: string,
): MessageBoxOptions | null {
  switch (state.status) {
    case "up-to-date":
      return {
        type: "info",
        title: t("dialog.updates.upToDateTitle"),
        message: t("dialog.updates.upToDateMessage", {
          appName,
          version: state.currentVersion,
        }),
        buttons: [t("dialog.ok")],
      };
    case "downloading":
    case "available":
      return {
        type: "info",
        title: t("dialog.updates.foundTitle"),
        message: t("dialog.updates.foundMessage", { appName }),
        buttons: [t("dialog.ok")],
      };
    case "downloaded":
      return {
        type: "info",
        title: t("dialog.updates.readyTitle"),
        message: t("dialog.updates.readyMessage"),
        buttons: [t("dialog.ok")],
      };
    case "error":
      return {
        type: "warning",
        title: t("dialog.updates.errorTitle"),
        message: t("dialog.updates.errorMessage"),
        detail: state.message ?? t("dialog.updates.unknownError"),
        buttons: [t("dialog.ok")],
      };
    default:
      return null;
  }
}
