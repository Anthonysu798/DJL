"use client";
import type { CloudModel } from "@synara/contracts/cloud";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/lib/locale-context";

const KEY = "djl.chat.model";

/** Models a chat can target: anything that chats or makes images. */
export const pickable = (models: readonly CloudModel[]) =>
  models.filter(
    (m) => m.capabilities.includes("text.chat") || m.capabilities.includes("image.generate"),
  );

/** The chosen model id, remembered per browser; falls back to the first usable chat model. */
export function useModelChoice(
  models: readonly CloudModel[],
): [string | null, (id: string) => void] {
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => {
    try {
      setStored(localStorage.getItem(KEY));
    } catch {
      /* ignore */
    }
  }, []);
  const usable = pickable(models).filter((m) => m.status !== "disabled");
  const choice =
    usable.find((m) => m.id === stored)?.id ??
    usable.find((m) => m.capabilities.includes("text.chat") && m.status === "active")?.id ??
    usable[0]?.id ??
    null;
  const set = (id: string) => {
    setStored(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  };
  return [choice, set];
}

export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: readonly CloudModel[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { d } = useLocale();
  const current = models.find((m) => m.id === value);
  const caps = d.chat.capabilities as Record<string, string>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-1.5 rounded-lg px-2.5 text-[15px] font-semibold"
          aria-label={`${d.chat.model}: ${current?.displayName ?? d.chat.chooseModel}`}
        >
          {current?.displayName ?? d.chat.chooseModel}
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-1.5">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {d.chat.chooseModel}
        </DropdownMenuLabel>
        {pickable(models).map((m) => (
          <DropdownMenuItem
            key={m.id}
            disabled={m.status === "disabled"}
            onSelect={() => onChange(m.id)}
            className="items-start gap-3 rounded-lg px-2.5 py-2"
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{m.displayName}</span>
                {m.status === "degraded" ? (
                  <Badge
                    variant="outline"
                    className="border-transparent bg-warning-bg text-warning-fg"
                  >
                    {d.chat.degraded}
                  </Badge>
                ) : m.status === "disabled" ? (
                  <Badge variant="outline">{d.chat.unavailable}</Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                {m.capabilities
                  .filter((c) => c !== "text.chat")
                  .map((c) => (
                    <Badge
                      key={c}
                      variant="secondary"
                      className="rounded-md px-1.5 text-[11px] font-normal text-muted-foreground"
                    >
                      {caps[c] ?? c}
                    </Badge>
                  ))}
              </div>
            </div>
            {m.id === value ? <Check className="mt-0.5 size-4 text-primary" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
