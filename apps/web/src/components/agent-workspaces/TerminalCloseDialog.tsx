import { TriangleAlertIcon } from "~/lib/icons";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";

export interface TerminalCloseDialogProps {
  open: boolean;
  closing: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  closingLabel: string;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function TerminalCloseDialog({
  open,
  closing,
  title,
  description,
  cancelLabel,
  confirmLabel,
  closingLabel,
  onOpenChange,
  onCancel,
  onConfirm,
}: TerminalCloseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        surface="solid"
        showCloseButton={false}
        className="terminal-close-dialog max-w-[26rem] rounded-[20px] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.58)] motion-reduce:transition-none dark:shadow-[0_24px_80px_-20px_rgba(0,0,0,0.82)]"
      >
        <DialogHeader className="grid grid-cols-[2.5rem_1fr] gap-x-3.5 gap-y-1 px-5 pb-4 pt-5">
          <div
            className="row-span-2 flex size-10 items-center justify-center rounded-xl border border-destructive/15 bg-destructive/8 text-destructive"
            data-testid="terminal-close-warning-icon"
          >
            <TriangleAlertIcon className="size-5" aria-hidden="true" />
          </div>
          <DialogTitle className="self-end text-base font-semibold leading-5 tracking-[-0.01em]">
            {title}
          </DialogTitle>
          <DialogDescription className="max-w-[34ch] text-[13px] leading-[1.5] text-[var(--color-text-foreground-secondary)]">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-t border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)]/45 px-5 py-4 sm:gap-2.5">
          <Button
            variant="secondary-outline"
            data-variant="secondary-outline"
            disabled={closing}
            onClick={onCancel}
            className="min-w-20 transition-transform active:scale-[0.98] motion-reduce:transition-none"
          >
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            data-variant="destructive"
            disabled={closing}
            onClick={onConfirm}
            className="min-w-20 transition-transform active:scale-[0.98] motion-reduce:transition-none"
          >
            {closing ? closingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
