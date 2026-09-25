"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { t, type Dict, type Locale } from "./i18n";

const LocaleContext = createContext<{ locale: Locale; d: Dict }>({ locale: "en", d: t("en") });

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, d: t(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
