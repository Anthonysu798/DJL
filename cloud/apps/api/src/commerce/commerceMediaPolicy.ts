/** Product media approval is independent from paid image-search/model configuration. */
export interface CommerceMediaPolicy {
  readonly mediaOrigin?: string;
  readonly webPublicUrl?: string;
  readonly apiPublicUrl?: string;
}
export class CommerceMediaPolicyError extends Error {
  constructor(
    readonly code:
      | "image_url_invalid"
      | "image_origin_not_approved"
      | "media_configuration_invalid",
  ) {
    super(
      code === "media_configuration_invalid"
        ? "Commerce media configuration is invalid. Use explicit HTTPS origins without paths or credentials."
        : code === "image_origin_not_approved"
          ? "Publishing requires a safe /shop/ image or an explicitly approved HTTPS media origin."
          : "Use a safe /shop/ image path or an HTTPS image URL without credentials or path traversal.",
    );
  }
}
const configError = () => new CommerceMediaPolicyError("media_configuration_invalid");
const unsafeCharacters = (value: string) =>
  value.includes("\\") ||
  Array.from(value).some(
    (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
  );
const hostName = (url: URL) => url.hostname.toLowerCase().replace(/\.$/, "");
const loopback = (url: URL) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostName(url)) ||
  hostName(url).endsWith(".localhost");
const publicHost = (url: URL) => {
  const host = hostName(url);
  return !loopback(url) && !host.endsWith(".local") && !host.includes(":") && !/^\d+\./.test(host);
};
function originUrl(value: string): URL {
  let url: URL;
  try {
    if (value !== value.trim() || unsafeCharacters(value)) throw configError();
    const raw = /^https?:\/\/([^/?#]+)([^?#]*)$/i.exec(value);
    if (!raw || raw[1]!.includes("@") || !["", "/"].includes(raw[2]!)) throw configError();
    url = new URL(value);
  } catch {
    throw configError();
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw configError();
  return url;
}
/** Same strict public HTTPS-origin boundary used by image inference. */
export function commerceMediaOrigin(value: string): string {
  const url = originUrl(value);
  if (url.protocol !== "https:" || !publicHost(url)) throw configError();
  return url.origin;
}
function configured(policy: CommerceMediaPolicy) {
  const media = policy.mediaOrigin?.trim() ? commerceMediaOrigin(policy.mediaOrigin) : null;
  if (policy.apiPublicUrl?.trim()) {
    const api = originUrl(policy.apiPublicUrl);
    if (
      (api.protocol !== "https:" && !(api.protocol === "http:" && loopback(api))) ||
      media === api.origin
    )
      throw configError();
  }
  let web: string | null = null;
  if (policy.webPublicUrl?.trim()) {
    const url = originUrl(policy.webPublicUrl);
    if ((url.protocol === "http:" || url.protocol === "https:") && loopback(url)) {
      // A development web base preserves relative demo images, never provider-visible URLs.
      web = null;
    } else {
      web = commerceMediaOrigin(policy.webPublicUrl);
    }
  }
  return { media, web };
}
export function assertCommerceMediaPolicy(policy: CommerceMediaPolicy): void {
  configured(policy);
}
function safePath(path: string): boolean {
  if (
    !path.startsWith("/") ||
    path.includes("//") ||
    path.includes("\\") ||
    /%(?:2e|2f|5c|25|0[0-9a-f]|1[0-9a-f]|7f)/i.test(path)
  )
    return false;
  try {
    decodeURIComponent(path);
    return new URL(path, "https://relative.invalid").pathname === path;
  } catch {
    return false;
  }
}
function image(value: unknown): { stored: string; absolute: URL | null } {
  if (typeof value !== "string" || !value.length || value.length > 2048 || unsafeCharacters(value))
    throw new CommerceMediaPolicyError("image_url_invalid");
  const path = value.split(/[?#]/)[0]!;
  if (value.startsWith("/shop/") && safePath(path)) return { stored: value, absolute: null };
  try {
    const url = new URL(value);
    const raw = /^https:\/\/([^/?#]+)([^?#]*)/i.exec(value);
    const rawPath = raw?.[2] || "/";
    if (
      raw &&
      !raw[1]!.includes("@") &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      publicHost(url) &&
      safePath(rawPath) &&
      url.pathname === rawPath
    )
      return { stored: url.href, absolute: url };
  } catch {
    // No URL, host, credentials or request contents are included in validation errors.
  }
  throw new CommerceMediaPolicyError("image_url_invalid");
}
function approved(absolute: URL, origins: ReturnType<typeof configured>): boolean {
  // Repeating the web origin as MEDIA must not bypass native /shop/ resource isolation.
  if (absolute.origin === origins.web) return absolute.pathname.startsWith("/shop/");
  return absolute.origin === origins.media;
}

/** Drafts may retain a safe but unapproved supplier URL; every published save rechecks approval. */
export function commerceProductImageUrl(
  value: unknown,
  status: "draft" | "published" | "archived",
  policy: CommerceMediaPolicy = {},
): string {
  const origins = status === "published" ? configured(policy) : null;
  const parsed = image(value);
  if (origins && parsed.absolute && !approved(parsed.absolute, origins))
    throw new CommerceMediaPolicyError("image_origin_not_approved");
  return parsed.stored;
}

/** Inference requires explicit HTTPS resolution; safe relative demos alone never invent an origin. */
export function commerceApprovedImageUrl(
  value: string,
  policy: CommerceMediaPolicy,
): string | null {
  const origins = configured(policy);
  let parsed: ReturnType<typeof image>;
  try {
    parsed = image(value);
  } catch {
    return null;
  }
  if (parsed.absolute) return approved(parsed.absolute, origins) ? parsed.stored : null;
  return origins.web ? new URL(parsed.stored, origins.web).href : null;
}
