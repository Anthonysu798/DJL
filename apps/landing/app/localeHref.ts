import type { Locale } from "./content";

// Chinese lives at the bare paths; English is prefixed with /en.
export function localeHref(path: string, locale: Locale): string {
  if (locale !== "en") return path;
  return path === "/" ? "/en" : `/en${path}`;
}
