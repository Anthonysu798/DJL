"use client";
import { MoreHorizontal, TrendingDown, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../LocaleProvider";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Hero-number tile with a change-versus-previous-period line and an overflow menu. */
export function StatTile({
  label,
  icon: Icon,
  value,
  current,
  previous,
  hint,
  menu,
}: {
  label: string;
  icon?: LucideIcon;
  value: string;
  current?: number;
  previous?: number;
  hint?: string;
  menu?: readonly { label: string; onSelect: () => void }[];
}) {
  const { t, percent } = useI18n();
  let delta: ReactNode = null;
  if (current !== undefined && previous !== undefined) {
    const up = current >= previous;
    const pct =
      previous === 0
        ? current === 0
          ? 0
          : 100
        : Math.round(((current - previous) / previous) * 100);
    const Icon = up ? TrendingUp : TrendingDown;
    delta = (
      <span className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={up ? "size-3.5 text-chart-3" : "size-3.5 text-chart-5"} />
        {t("charts.change", { change: `${up ? "+" : ""}${percent(pct / 100)}` })}
      </span>
    );
  }
  return (
    <div className="panel p-5">
      <div className="flex gap-4">
        {Icon ? (
          <div className="grid size-12 shrink-0 place-items-center rounded-lg border bg-secondary/60">
            <Icon className="size-5 text-foreground/70" strokeWidth={1.5} />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between">
            <div className="text-sm text-muted-foreground">{label}</div>
            {menu?.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-mt-1 -mr-2 size-8 text-muted-foreground"
                    aria-label={t("charts.options", { label })}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {menu.map((m) => (
                    <DropdownMenuItem key={m.label} onSelect={m.onSelect}>
                      {m.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        </div>
      </div>
      {delta}
      {hint ? <div className="mt-2 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
