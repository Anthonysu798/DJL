import { isIP } from "node:net";

// oxlint-disable-next-line no-control-regex -- Reject controls in both raw and decoded redirect targets.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const SECRET_KEY =
  /(?:token|secret|password|passwd|apikey|authorization|credential)|^(?:pwd|key|auth|session|sessionid|jwt|bearer|code|state|nonce|otp|ticket|signature|sig|xamz.+)$/i;
const SECRET_VALUE =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?:Bearer|Basic)\s+\S+)/i;
const BAD_LOCAL_HOST = /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/i;
const normalizeKey = (key: string) => key.replace(/[^a-z0-9]/gi, "");

/** Validation only: redirects never fetch or resolve the destination on the server. */
export function validatedTrackingTarget(raw: string): string | null {
  if (!raw || raw.length > 4096 || /\s/.test(raw) || CONTROL.test(raw)) return null;
  let decoded = raw;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(decoded);
      if (CONTROL.test(next) || SECRET_VALUE.test(next)) return null;
      const fields = next.split(/[?&#]/).slice(1);
      if (fields.some((field) => SECRET_KEY.test(normalizeKey(field.split("=")[0] ?? ""))))
        return null;
      if (next === decoded) break;
      decoded = next;
    }
    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      isIP(host) ||
      !host.includes(".") ||
      BAD_LOCAL_HOST.test(host) ||
      url.port
    )
      return null;
    if ([...url.searchParams.keys()].some((key) => SECRET_KEY.test(normalizeKey(key)))) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Explicit browser hints only. Unlabelled previews and bots may still be counted. */
export function countsAsTrackingOpen(
  method: string,
  headers: Readonly<Record<string, string | undefined>>,
): boolean {
  if (method !== "GET") return false;
  return !["purpose", "sec-purpose", "x-purpose", "x-moz"].some((key) =>
    /prefetch|prerender|preview/i.test(headers[key] ?? ""),
  );
}
