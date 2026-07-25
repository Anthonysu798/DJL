import { RenameDialog } from "./RenameDialog";
import { useTranslation } from "react-i18next";

interface RenameThreadDialogProps {
  open: boolean;
  currentTitle: string;
  onOpenChange: (open: boolean) => void;
  onSave: (newTitle: string) => Promise<void> | void;
}

export function RenameThreadDialog({
  open,
  currentTitle,
  onOpenChange,
  onSave,
}: RenameThreadDialogProps) {
  const { t } = useTranslation("shell");

  return (
    <RenameDialog
      open={open}
      title={t("sidebar.renameThread.title")}
      description={t("sidebar.renameThread.description")}
      initialValue={currentTitle}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  );
}
