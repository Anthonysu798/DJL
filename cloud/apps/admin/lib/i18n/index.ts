import en from "./en";
import hans from "./zh-Hans";
import hant from "./zh-Hant";
import fr from "./fr";
import es from "./es-419";
import ja from "./ja";
import ko from "./ko";
import type { AdminLocale } from "./locale";

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;
export const catalogs: Record<AdminLocale, Catalog> = {
  en,
  "zh-Hans": hans,
  "zh-Hant": hant,
  fr,
  "es-419": es,
  ja,
  ko,
};
export function translate(
  locale: AdminLocale,
  key: MessageKey,
  params: Record<string, string | number> = {},
): string {
  return (catalogs[locale][key] ?? en[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
