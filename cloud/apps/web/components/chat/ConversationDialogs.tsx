"use client";
import type { CloudConversation } from "@synara/contracts/cloud";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

export function RenameDialog({
  conversation,
  onClose,
  onRename,
}: {
  conversation: CloudConversation | null;
  onClose: () => void;
  onRename: (title: string) => Promise<void>;
}) {
  const { d } = useLocale();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValue(conversation?.title ?? "");
    setError(null);
  }, [conversation]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = value.trim();
    if (!title) return setError(d.chat.renameEmpty);
    if (title.length > 200) return setError(d.chat.renameTooLong);
    setBusy(true);
    try {
      await onRename(title);
      onClose();
    } catch {
      setError(d.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={conversation !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{d.chat.rename}</DialogTitle>
            <DialogDescription className="sr-only">{d.chat.renameLabel}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor="rename-input" className="text-sm font-medium">
              {d.chat.renameLabel}
            </label>
            <Input
              id="rename-input"
              value={value}
              autoFocus
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "rename-error" : undefined}
            />
            {error ? (
              <p id="rename-error" role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {d.chat.cancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {d.chat.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDialog({
  conversation,
  onClose,
  onDelete,
}: {
  conversation: CloudConversation | null;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const { d } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [conversation]);
  const confirm = async () => {
    setBusy(true);
    try {
      await onDelete();
      onClose();
    } catch {
      setError(d.error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={conversation !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" role="alertdialog">
        <DialogHeader>
          <DialogTitle>{d.chat.deleteTitle}</DialogTitle>
          <DialogDescription>
            {fill(d.chat.deleteBody, { title: conversation?.title || d.chat.untitled })}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {d.chat.cancel}
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {d.chat.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
