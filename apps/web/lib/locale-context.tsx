"use client";
import { createContext, useContext, type ReactNode } from "react";

import { t, type Dict, type Locale } from "./i18n";

const LocaleContext = createContext<{ locale: Locale; d: Dict }>({ locale: "en", d: t("en") });

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <LocaleContext.Provider value={{ locale, d: t(locale) }}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
