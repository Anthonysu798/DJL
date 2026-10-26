export const ADMIN_LOCALES = ["en", "zh-Hans", "zh-Hant", "fr", "es-419", "ja", "ko"] as const;
export type AdminLocale = (typeof ADMIN_LOCALES)[number];
export const LOCALE_STORAGE_KEY = "djl_admin_locale";
export const LANGUAGE_NAMES: Record<AdminLocale, string> = {
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  fr: "Français",
  "es-419": "Español",
  ja: "日本語",
  ko: "한국어",
};

export function supportedLocale(value: unknown): AdminLocale | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/_/g, "-");
  if (normalized === "zh" || /^zh-(hans|cn|sg)(-|$)/.test(normalized)) return "zh-Hans";
  if (/^zh-(hant|tw|hk|mo)(-|$)/.test(normalized)) return "zh-Hant";
  const language = normalized.split("-")[0];
  if (language === "es") return "es-419";
  return (["en", "fr", "ja", "ko"] as const).find((locale) => locale === language) ?? null;
}

export function resolveLocale(saved: unknown, browserLanguages: readonly string[]): AdminLocale {
  const explicit = supportedLocale(saved);
  if (explicit) return explicit;
  for (const language of browserLanguages) {
    const supported = supportedLocale(language);
    if (supported) return supported;
  }
  return "en";
}

export function readLocale(): AdminLocale {
  if (typeof window === "undefined") return "en";
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    /* storage is optional */
  }
  return resolveLocale(
    saved,
    navigator.languages.length ? navigator.languages : [navigator.language],
  );
}

export const LOCALE_BOOT_SCRIPT = `(()=>{try{const l=${JSON.stringify(ADMIN_LOCALES)};let p=null;try{p=localStorage.getItem('${LOCALE_STORAGE_KEY}')}catch{}const norm=s=>{s=String(s).toLowerCase().replace(/_/g,'-');if(s==='zh'||/^zh-(hans|cn|sg)(-|$)/.test(s))return'zh-Hans';if(/^zh-(hant|tw|hk|mo)(-|$)/.test(s))return'zh-Hant';const b=s.split('-')[0];return b==='es'?'es-419':l.includes(b)?b:null};document.documentElement.lang=norm(p)||Array.from(navigator.languages||[navigator.language]).map(norm).find(Boolean)||'en'}catch{document.documentElement.lang='en'}})();`;
