"use client";
import type { CloudUsageWindow, CloudUsageWindowsResponse } from "@synara/contracts/cloud";
import { Gauge, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChat, useChatStore } from "@/lib/chat/context";
import { formatDate, formatWhen, percentUsed } from "@/lib/chat/format";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

import { toast } from "./toast";

function WindowBar({ label, window }: { label: string; window: CloudUsageWindow }) {
  const { d, locale } = useLocale();
  const pct = percentUsed(window);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {fill(d.chat.percentUsed, { pct: String(Math.round(pct)) })}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning-fg" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {window.resetsAt
          ? fill(d.chat.resets, { when: formatWhen(window.resetsAt, locale) })
          : d.chat.notUsed}
      </p>
    </div>
  );
}

export function UsageMeter({ usage }: { usage: CloudUsageWindowsResponse }) {
  const { d } = useLocale();
  return (
    <div className="space-y-3">
      <WindowBar label={d.chat.fiveHour} window={usage.windows.fiveHour} />
      <WindowBar label={d.chat.week} window={usage.windows.week} />
    </div>
  );
}

/** Shown above the composer when a usage window is exhausted: redeem a banked reset or upgrade. */
export function UsageExhaustedPanel() {
  const { d, locale } = useLocale();
  const store = useChatStore();
  const usage = useChat((s) => s.usage);
  const block = useChat((s) => s.usageBlock);
  const [confirming, setConfirming] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!block) return null;

  const weekly = usage ? BigInt(usage.windows.week.remaining) <= 0n : false;
  const banks = usage?.banks.count ?? 0;
  const nextExpiresAt = usage?.banks.nextExpiresAt ?? null;
  const resetsAt = block.resetsAt;

  const redeem = async () => {
    setRedeeming(true);
    setError(null);
    try {
      await store.redeemBank();
      setConfirming(false);
      toast(d.chat.bankUsed);
    } catch {
      setError(d.error);
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <section
      role="region"
      aria-labelledby="usage-exhausted-title"
      className="mb-3 rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning-fg">
          <Gauge className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="usage-exhausted-title" className="text-sm font-semibold">
            {weekly ? d.chat.exhaustedWeek : d.chat.exhaustedFiveHour}
          </h2>
          <p className="text-sm text-muted-foreground">
            {resetsAt
              ? fill(d.chat.exhaustedBody, { when: formatWhen(resetsAt, locale) })
              : d.chat.exhaustedBodyNoReset}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-12">
        {banks > 0 ? (
          <Button size="sm" onClick={() => setConfirming(true)}>
            <RotateCcw />
            {d.chat.useBank}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" asChild>
          <Link href="/billing">{d.chat.upgrade}</Link>
        </Button>
        <span className="text-xs text-muted-foreground">
          {banks > 0 && nextExpiresAt
            ? fill(d.chat.banksLeft, {
                count: String(banks),
                date: formatDate(nextExpiresAt, locale),
              })
            : d.chat.noBanks}
        </span>
      </div>
      <Dialog open={confirming} onOpenChange={(o) => !redeeming && setConfirming(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{d.chat.confirmBankTitle}</DialogTitle>
            <DialogDescription>
              {fill(d.chat.confirmBankBody, { count: String(Math.max(0, banks - 1)) })}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={redeeming}>
              {d.chat.cancel}
            </Button>
            <Button onClick={() => void redeem()} disabled={redeeming}>
              {redeeming ? <Loader2 className="animate-spin" /> : null}
              {d.chat.confirmBank}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
