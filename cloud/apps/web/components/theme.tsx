"use client";
import { Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { useLocale } from "@/lib/locale-context";

const KEY = "djl-web-theme";
type Theme = "light" | "dark";

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Current theme and a setter that persists it per browser. Light is the default. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => setThemeState(readTheme()), []);
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
  }, []);
  return { theme, setTheme };
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { d } = useLocale();
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Sun className="size-4" aria-hidden />
      <Switch
        aria-label={d.chat.darkMode}
        checked={theme === "dark"}
        onCheckedChange={(c) => setTheme(c ? "dark" : "light")}
      />
      <Moon className="size-4" aria-hidden />
    </div>
  );
}

/** Inline script so the first paint already has the right theme (no flash). */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}})();`;
