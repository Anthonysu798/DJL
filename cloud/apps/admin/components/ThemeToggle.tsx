"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { useI18n } from "./LocaleProvider";

const KEY = "djl-admin-theme";

function readTheme(): "light" | "dark" {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable */
  }
  return "dark";
}

/** Applies the theme class before paint on first render; toggled state persists per browser. */
export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<"light" | "dark">("dark");
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
      <Sun className="hidden size-4 sm:block" aria-hidden />
      <Switch
        aria-label={t("shell.darkMode")}
        checked={theme === "dark"}
        onCheckedChange={(c) => apply(c ? "dark" : "light")}
      />
      <Moon className="hidden size-4 sm:block" aria-hidden />
    </div>
  );
}

/** Inline script so the first paint already has the right theme (no flash). */
export const THEME_BOOT_SCRIPT = `(function(){var t='dark';try{var s=localStorage.getItem(${JSON.stringify(KEY)});if(s==='light'||s==='dark')t=s}catch(e){}document.documentElement.classList.toggle('dark',t==='dark')})();`;
