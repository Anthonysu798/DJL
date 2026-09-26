/**
 * The `next` redirect target after sign-in, sign-up, or verification. Only a
 * path on this site is honored: it must start with a single "/", contain no
 * backslashes or control characters (browsers treat "\" like "/" and drop
 * tabs and newlines, which turns "/\evil" or "/\t/evil" into "//evil"), and
 * still resolve to this origin. Anything else becomes `fallback`.
 */
const BASE = "https://app.invalid";
// oxlint-disable-next-line no-control-regex -- control characters are exactly what is refused
const UNSAFE = /[\\\u0000-\u001f\u007f]/;

export function safeNext(value: string | null, fallback = "/account"): string {
  if (!value?.startsWith("/") || value.startsWith("//") || UNSAFE.test(value)) return fallback;
  const url = new URL(value, BASE);
  return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : fallback;
}
