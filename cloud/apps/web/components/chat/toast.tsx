"use client";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: "default" | "error";
}

let nextId = 1;
const listeners = new Set<(t: Toast) => void>();

/** Shows a short status message in the corner and announces it to screen readers. */
export function toast(message: string, tone: Toast["tone"] = "default") {
  const t = { id: nextId++, message, tone };
  for (const l of listeners) l(t);
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setToasts((list) => [...list.slice(-2), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), 3200);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto rounded-full border px-4 py-2 text-sm shadow-lg animate-in fade-in-0 slide-in-from-bottom-2",
            t.tone === "error"
              ? "border-transparent bg-danger-bg text-danger-fg"
              : "border-border bg-popover text-popover-foreground",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
