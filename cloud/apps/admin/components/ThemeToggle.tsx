"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";

const KEY = "djl-admin-theme";

function readTheme(): "light" | "dark" {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Applies the theme class before paint on first render; toggled state persists per browser. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const t = readTheme();
    setTheme(t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, []);
  const apply = (next: "light" | "dark") => {
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Sun className="size-4" aria-hidden />
      <Switch
        aria-label="Dark mode"
        checked={theme === "dark"}
        onCheckedChange={(c) => apply(c ? "dark" : "light")}
      />
      <Moon className="size-4" aria-hidden />
    </div>
  );
}

/** Inline script so the first paint already has the right theme (no flash). */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}})();`;
