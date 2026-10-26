"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translate, type MessageKey } from "@/lib/i18n";
import {
  LOCALE_STORAGE_KEY,
  readLocale,
  supportedLocale,
  type AdminLocale,
} from "@/lib/i18n/locale";
import {
  formatBytes,
  formatCredits,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatTime,
} from "@/lib/i18n/format";

function localized(locale: AdminLocale, setLocale: (locale: AdminLocale) => void) {
  return {
    locale,
    setLocale,
    t: (key: MessageKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    number: (value: number | bigint, options?: Intl.NumberFormatOptions) =>
      formatNumber(value, locale, options),
    date: (value: string | Date, options?: Intl.DateTimeFormatOptions) =>
      formatDate(value, locale, options),
    time: (value: string | Date) => formatTime(value, locale),
    percent: (value: number) => formatPercent(value, locale),
    bytes: (value: number) => formatBytes(value, locale),
    credits: (micro: string | number | bigint | null | undefined) =>
      micro == null ? "—" : formatCredits(String(micro), locale),
    currency: (value: number, currency = "USD") => formatCurrency(value, currency, locale),
  };
}

const LocaleContext = createContext(localized("en", () => undefined));
export const useI18n = () => useContext(LocaleContext);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<AdminLocale>("en");
  const setLocale = useCallback((next: AdminLocale) => {
    const valid = supportedLocale(next);
    if (!valid) return;
    updateLocale(valid);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, valid);
    } catch {
      /* preference persistence is optional */
    }
  }, []);
  useEffect(() => {
    updateLocale(readLocale());
    const sync = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY) updateLocale(readLocale());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(() => localized(locale, setLocale), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
