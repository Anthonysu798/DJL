import { catalogs, translate, type MessageKey } from "./index";
import type { AdminLocale } from "./locale";

const known = new Map<string, MessageKey>();
for (const catalog of Object.values(catalogs)) {
  for (const [key, text] of Object.entries(catalog))
    if (!text.includes("{")) known.set(text, key as MessageKey);
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns: { key: MessageKey; regex: RegExp; names: string[] }[] = [];
for (const catalog of Object.values(catalogs)) {
  for (const [key, text] of Object.entries(catalog)) {
    if ((key !== "common.required" && !key.startsWith("validation.")) || !text.includes("{"))
      continue;
    const names: string[] = [];
    const pieces = text.split(/(\{\w+\})/g).map((part) => {
      if (/^\{\w+\}$/.test(part)) {
        names.push(part.slice(1, -1));
        return "(.+?)";
      }
      return escape(part);
    });
    patterns.push({ key: key as MessageKey, names, regex: new RegExp(`^${pieces.join("")}$`) });
  }
}
const codes: Readonly<Record<string, MessageKey>> = {
  forbidden: "errors.forbidden",
  unauthorized: "errors.signIn",
  mfa_required: "errors.mfa",
  rate_limited: "errors.rateLimit",
  operator_required: "errors.operator",
  bad_credentials: "auth.badCredentials",
  bad_totp: "auth.badCode",
  locked_out: "auth.lockedOut",
  ip_blocked: "auth.ipBlocked",
  ip_not_allowed: "auth.ipBlocked",
};

/** Only known UI/validation messages are translated; unknown technical failures stay private. */
export function errorMessage(error: unknown, locale: AdminLocale): string {
  const api =
    error && typeof error === "object" ? (error as { status?: unknown; code?: unknown }) : null;
  if (
    api &&
    typeof api.status === "number" &&
    typeof api.code === "string" &&
    Object.hasOwn(codes, api.code)
  )
    return translate(locale, codes[api.code]!);
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const key = known.get(text);
  if (key) return translate(locale, key);
  for (const pattern of patterns) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    const params = Object.fromEntries(
      pattern.names.map((name, index) => {
        const value = match[index + 1]!;
        const label = name === "label" ? known.get(value) : undefined;
        return [name, label ? translate(locale, label) : value];
      }),
    );
    return translate(locale, pattern.key, params);
  }
  if (error instanceof TypeError) return translate(locale, "errors.network");
  return translate(locale, "common.error");
}
