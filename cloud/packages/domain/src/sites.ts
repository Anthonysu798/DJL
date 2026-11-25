/**
 * Rules for static sites on slcor.site: which names can be claimed, which
 * files a deploy may contain, and which pages are held for human review
 * before they go live.
 */

const NAME = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Exact names kept for DJL's own use. */
const RESERVED_NAMES = new Set([
  "www",
  "api",
  "app",
  "apps",
  "admin",
  "mail",
  "email",
  "smtp",
  "imap",
  "ftp",
  "ns1",
  "ns2",
  "cdn",
  "static",
  "assets",
  "files",
  "download",
  "downloads",
  "status",
  "support",
  "help",
  "docs",
  "blog",
  "news",
  "shop",
  "store",
  "billing",
  "pay",
  "payments",
  "account",
  "accounts",
  "auth",
  "oauth",
  "sso",
  "root",
  "test",
  "staging",
  "dev",
  "preview",
  "report",
  "abuse",
  "legal",
  "terms",
  "privacy",
  "about",
  "security",
  "official",
]);

/** Name segments that suggest impersonation or credential theft, or are offensive. */
const RESERVED_SEGMENTS = new Set([
  "djl",
  "slcor",
  "login",
  "signin",
  "logon",
  "verify",
  "verification",
  "secure",
  "password",
  "wallet",
  "bank",
  "banking",
  "apple",
  "google",
  "gmail",
  "amazon",
  "facebook",
  "meta",
  "instagram",
  "whatsapp",
  "microsoft",
  "outlook",
  "office",
  "netflix",
  "steam",
  "tiktok",
  "wechat",
  "alipay",
  "taobao",
  "openai",
  "chatgpt",
  "anthropic",
  "claude",
  "irs",
  "gov",
  "fuck",
  "shit",
  "cunt",
  "nazi",
  "porn",
  "nigger",
  "faggot",
]);

/** High-risk brands rejected anywhere inside a name. */
const RESERVED_SUBSTRINGS = [
  "djl",
  "slcor",
  "paypal",
  "metamask",
  "coinbase",
  "binance",
  "icloud",
  "appleid",
  "microsoft",
  "office365",
  "wellsfargo",
  "bankofamerica",
  "venmo",
  "cashapp",
];

export type SiteNameProblem = "invalid" | "reserved";

export function siteNameProblem(name: string): SiteNameProblem | null {
  if (!NAME.test(name)) return "invalid";
  if (RESERVED_NAMES.has(name)) return "reserved";
  if (name.split("-").some((segment) => RESERVED_SEGMENTS.has(segment))) return "reserved";
  if (RESERVED_SUBSTRINGS.some((word) => name.includes(word))) return "reserved";
  return null;
}

/**
 * Why a path inside a deploy is not allowed, or null. Paths are relative,
 * forward-slash separated, with no empty, `.` or `..` segments, no hidden
 * files, and an extension from `allowedExtensions` (lowercase, no dot).
 */
export function sitePathProblem(
  path: string,
  allowedExtensions: ReadonlySet<string>,
): string | null {
  if (path.length === 0 || path.length > 512) return "A file path is empty or too long.";
  // Control characters, backslashes and drive letters never appear in a web build.
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\u0000-\u001f\u007f\\]/.test(path) || /^[a-zA-Z]:/.test(path))
    return `The path "${printable(path)}" has characters a website cannot use.`;
  if (path.startsWith("/")) return `The path "${printable(path)}" must be relative.`;
  const segments = path.split("/");
  if (segments[0]?.toLowerCase() === "_djl")
    return `The folder "_djl" is reserved for DJL and cannot be published.`;
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..")
      return `The path "${printable(path)}" is not a plain file path.`;
    if (segment.startsWith(".")) return `Hidden files like "${printable(path)}" are not published.`;
  }
  const name = segments.at(-1)!;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (!allowedExtensions.has(extension))
    return `"${printable(path)}" is a file type that is not allowed on a website.`;
  return null;
}

// oxlint-disable-next-line no-control-regex -- control characters are replaced for display
const printable = (path: string) => path.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 120);

export interface SiteFileLimits {
  readonly maxFiles: number;
  /** Most bytes all files may hold together, unzipped. */
  readonly maxBytes: number;
}

/** Why a deploy's file list cannot be published, or null. Paths are already checked one by one. */
export function siteFilesProblem(
  files: ReadonlyArray<{ readonly path: string; readonly size: number }>,
  limits: SiteFileLimits,
): string | null {
  if (files.length > limits.maxFiles)
    return `A site can have up to ${limits.maxFiles} files; this one has ${files.length}.`;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > limits.maxBytes)
    return `A site can hold up to ${Math.floor(limits.maxBytes / (1024 * 1024)) || limits.maxBytes} MB unzipped (${limits.maxBytes} bytes).`;
  const seen = new Set<string>();
  for (const f of files) {
    const key = f.path.toLowerCase();
    if (seen.has(key)) return `"${printable(f.path)}" appears twice.`;
    seen.add(key);
  }
  if (!files.some((f) => f.path === "index.html"))
    return "The site needs an index.html at its top level.";
  return null;
}

const HOLD_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(seed|recovery|secret|mnemonic)\s+phrase\b/i, "asks for a wallet recovery phrase"],
  [/\b(12|24)[-\s]word\b/i, "asks for a wallet recovery phrase"],
  [/\bprivate\s+key\b/i, "asks for a private key"],
  [/\b(card\s*number|cvv|cvc|security\s+code)\b/i, "asks for payment card details"],
  [/\b(social\s+security\s+number|ssn)\b/i, "asks for a social security number"],
  [/\baccount\s+(has\s+been\s+)?(suspended|locked|limited)\b/i, "warns that an account is locked"],
  [
    /\b(verify|confirm|unlock|restore)\s+your\s+(account|identity|wallet|password)\b/i,
    "asks visitors to verify an account",
  ],
];

/**
 * Why a page should be held for review before going live, or null. Static
 * sites have no server to sign anyone in, so a password field or a form that
 * posts elsewhere is almost always credential theft.
 */
export function siteContentHold(text: string): string | null {
  if (/<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(text))
    return "A page has a password field.";
  for (const match of text.matchAll(/<form\b[^>]*\baction\s*=\s*["']?\s*(https?:)?\/\//gi))
    if (match) return "A form sends what visitors type to another site.";
  for (const [pattern, reason] of HOLD_PHRASES) if (pattern.test(text)) return `A page ${reason}.`;
  return null;
}
