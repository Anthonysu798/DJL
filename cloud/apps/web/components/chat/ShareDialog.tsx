"use client";
import type { CloudConversationId, CloudMessageId, CloudShare } from "@synara/contracts/cloud";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useChatClient } from "@/lib/chat/context";
import { formatDate } from "@/lib/chat/format";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

import { toast } from "./toast";
import { useCopy } from "./useCopy";

export function ShareDialog({
  open,
  onOpenChange,
  conversationId,
  lastMessageId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  lastMessageId: string | null;
}) {
  const { d, locale } = useLocale();
  const client = useChatClient();
  const [shares, setShares] = useState<readonly CloudShare[] | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopy();

  useEffect(() => {
    if (!open) return;
    setUrl(null);
    setError(null);
    let live = true;
    client.listShares().then(
      (r) =>
        live &&
        setShares(r.shares.filter((s) => s.conversationId === conversationId && !s.revokedAt)),
      () => live && setShares([]),
    );
    return () => {
      live = false;
    };
  }, [open, client, conversationId]);

  const create = async () => {
    if (!lastMessageId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await client.createShare({
        conversationId: conversationId as CloudConversationId,
        messageId: lastMessageId as CloudMessageId,
      });
      setUrl(res.url);
      setShares((list) => [res.share, ...(list ?? [])]);
    } catch {
      setError(d.error);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await client.revokeShare(id);
      setShares((list) => list?.filter((s) => s.id !== id) ?? null);
      setUrl(null);
      toast(d.chat.revoked);
    } catch {
      toast(d.error, "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.chat.shareTitle}</DialogTitle>
          <DialogDescription>{d.chat.shareBody}</DialogDescription>
        </DialogHeader>
        {url ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                readOnly
                value={url}
                aria-label={d.chat.shareLink}
                onFocus={(e) => e.target.select()}
                className="font-mono text-xs"
              />
              <Button onClick={() => void copy(url)} className="shrink-0">
                {copied ? <Check /> : <Copy />}
                {copied ? d.chat.copied : d.chat.copy}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{d.chat.linkOnce}</p>
          </div>
        ) : (
          <Button onClick={() => void create()} disabled={busy || !lastMessageId} className="w-fit">
            {busy ? <Loader2 className="animate-spin" /> : <Link2 />}
            {busy ? d.chat.creating : d.chat.createLink}
          </Button>
        )}
        {error ? (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        ) : null}
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium">{d.chat.activeLinks}</h3>
          {shares === null ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={d.loading} />
          ) : shares.length === 0 ? (
            <p className="text-sm text-muted-foreground">{d.chat.noLinks}</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {shares.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    {fill(d.chat.createdOn, { date: formatDate(s.createdAt, locale) })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void revoke(s.id)}
                  >
                    {d.chat.revoke}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
