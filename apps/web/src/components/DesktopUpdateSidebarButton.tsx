import { useTranslation } from "react-i18next";
import { DownloadIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { SidebarIconButton } from "./SidebarIconButton";

export function DesktopUpdateSidebarButton(props: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation("shell");
  return (
    <SidebarIconButton
      icon={DownloadIcon}
      label={props.label}
      tooltip={props.busy ? props.label : t("sidebar.update.availableTitle")}
      tooltipSide="right"
      iconClassName="size-4 text-white"
      data-testid="desktop-update-button"
      disabled={props.disabled}
      aria-busy={props.busy || undefined}
      className={cn(
        "djl-desktop-update-button relative size-7 rounded-full bg-[var(--info)] text-white shadow-sm transition-[filter,opacity,transform]",
        props.disabled ? "cursor-not-allowed opacity-70" : "hover:brightness-110 active:scale-95",
        props.busy && "animate-pulse",
      )}
      onClick={props.onClick}
    />
  );
}
