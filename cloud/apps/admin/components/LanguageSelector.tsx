"use client";
import { Languages } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { ADMIN_LOCALES, LANGUAGE_NAMES, type AdminLocale } from "@/lib/i18n/locale";

export function LanguageSelector({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`inline-flex min-w-0 items-center gap-2 text-sm ${className}`}>
      <Languages aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only">{t("common.language")}</span>
      <select
        aria-label={t("common.language")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as AdminLocale)}
        className="max-w-36 rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {ADMIN_LOCALES.map((value) => (
          <option key={value} value={value} lang={value}>
            {LANGUAGE_NAMES[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
