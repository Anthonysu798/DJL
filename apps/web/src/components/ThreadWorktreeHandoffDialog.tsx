import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

interface ThreadWorktreeHandoffDialogProps {
  open: boolean;
  worktreeName: string;
  busy?: boolean;
  onWorktreeNameChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
}

export function ThreadWorktreeHandoffDialog({
  open,
  worktreeName,
  busy = false,
  onWorktreeNameChange,
  onOpenChange,
  onConfirm,
}: ThreadWorktreeHandoffDialogProps) {
  const { t } = useTranslation(["shell", "common"]);
  const worktreeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      worktreeInputRef.current?.focus();
      worktreeInputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  const canSubmit = !busy && worktreeName.trim().length > 0;

  const handleSubmit = () => {
    if (canSubmit) {
      void onConfirm();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("handoff.title", { ns: "shell" })}</DialogTitle>
          <DialogDescription>{t("handoff.description", { ns: "shell" })}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleSubmit();
            }}
          >
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {t("handoff.name", { ns: "shell" })}
              </span>
              <Input
                ref={worktreeInputRef}
                value={worktreeName}
                disabled={busy}
                onChange={(event) => onWorktreeNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onOpenChange(false);
                  }
                }}
                placeholder="synara/feature-name"
              />
            </label>
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {busy ? t("handoff.busy", { ns: "shell" }) : t("handoff.action", { ns: "shell" })}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
