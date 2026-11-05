export const SHOP_OPEN_CHANNEL = "desktop:open-shop";
export const SHOP_WINDOW_PARTITION = "persist:djl-shop-prototype";
const SHOP_CLOUD_PARTITION = "persist:djl-shop-cloud";
const SHOP_SCOPED_TEST_PARTITION = "persist:djl-shop-scoped-test-v1";
export const SHOP_ENTRY_PATH = "/shop/index.html";

export interface ShopDestination {
  readonly kind: "prototype" | "cloud";
  readonly entryUrl: string;
  readonly apiOrigin?: string;
  readonly storageOrigin?: string;
  readonly scopedTest?: true;
}

function configuredOrigin(value: string, development: boolean, requireHosted: boolean): URL {
  const url = new URL(value);
  if (requireHosted) {
    const host = url.hostname.replace(/\.$/, "");
    if (
      ["localhost", "0.0.0.0", "[::]", "[::1]", "[::ffff:0:0]"].includes(host) ||
      host.endsWith(".localhost") ||
      /^127(?:\.\d{1,3}){3}$/.test(host) ||
      /^\[::ffff:7f[\da-f]{2}:[\da-f]{1,4}\]$/.test(host)
    )
      throw new Error("Hosted shop does not allow local endpoints.");
    if (url.protocol !== "https:") throw new Error("Hosted shop endpoints require HTTPS.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(development && loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Commerce endpoints must use HTTPS (or development loopback) without credentials or query strings.",
    );
  return url;
}

/** Explicit opt-in only: demo and cloud use different sessions and never exchange balances. */
export function resolveShopDestination(
  rendererEntry: string,
  env: NodeJS.ProcessEnv,
  development: boolean,
): ShopDestination {
  const requireHosted = env.DJL_COMMERCE_REQUIRE_HOSTED === "true";
  if (env.DJL_COMMERCE_SCOPED_TEST === "true") {
    if (requireHosted) throw new Error("Hosted shop is required; scoped TEST cannot be used.");
    const web = URL.parse(env.DJL_COMMERCE_WEB_URL ?? "");
    const api = URL.parse(env.DJL_COMMERCE_API_URL ?? "");
    if (
      !development ||
      !web ||
      !api ||
      web.protocol !== "https:" ||
      api.protocol !== "https:" ||
      web.hostname !== "127.0.0.1" ||
      api.hostname !== web.hostname ||
      !web.port ||
      !api.port ||
      web.port === api.port ||
      env.DJL_COMMERCE_WEB_URL !== `${web.origin}/shop` ||
      env.DJL_COMMERCE_API_URL !== api.origin ||
      env.DJL_COMMERCE_STORAGE_URL?.trim()
    )
      throw new Error("Scoped Shop requires isolated loopback HTTPS development configuration.");
    return { kind: "cloud", entryUrl: web.href, apiOrigin: api.origin, scopedTest: true };
  }
  if (!env.DJL_COMMERCE_WEB_URL?.trim()) {
    if (requireHosted) throw new Error("The hosted shop Web URL is required.");
    return { kind: "prototype", entryUrl: new URL(SHOP_ENTRY_PATH, rendererEntry).href };
  }
  const web = configuredOrigin(env.DJL_COMMERCE_WEB_URL.trim(), development, requireHosted);
  if (!/^\/shop\/?$/.test(web.pathname)) throw new Error("Commerce web URL must point to /shop.");
  if (!env.DJL_COMMERCE_API_URL?.trim()) throw new Error("Commerce API origin is required.");
  const api = configuredOrigin(env.DJL_COMMERCE_API_URL.trim(), development, requireHosted);
  if (api.pathname !== "/") throw new Error("Commerce API URL must be an origin.");
  const storage = env.DJL_COMMERCE_STORAGE_URL?.trim()
    ? configuredOrigin(env.DJL_COMMERCE_STORAGE_URL.trim(), development, requireHosted)
    : undefined;
  if (storage && storage.pathname !== "/")
    throw new Error("Commerce storage URL must be an origin.");
  if (storage && (storage.origin === web.origin || storage.origin === api.origin)) {
    throw new Error("Commerce storage must have a separate origin from the web and API.");
  }
  return {
    kind: "cloud",
    entryUrl: web.href,
    apiOrigin: api.origin,
    ...(storage ? { storageOrigin: storage.origin } : {}),
  };
}

export function shopSessionPartition(destination: ShopDestination): string {
  if (destination.scopedTest) return SHOP_SCOPED_TEST_PARTITION;
  return destination.kind === "cloud" ? SHOP_CLOUD_PARTITION : SHOP_WINDOW_PARTITION;
}

const cloudPages =
  /^\/(shop(?:\/|$)|sign-in(?:\/|$)|sign-up(?:\/|$)|verify(?:\/|$)|forgot-password(?:\/|$)|reset-password(?:\/|$))/;
const cloudCommerceApi = /^\/v1\/commerce(?:\/|$)/;
const cloudOrderRecovery = "/v1/commerce/orders/recover";
const cloudImageUploads = "/v1/commerce/image-uploads";
const cloudImageUploadComplete =
  /^\/v1\/commerce\/image-uploads\/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\/complete$/;
const cloudApiReads = new Set(["/v1/auth/get-session", "/v1/csrf"]);
const cloudApiWrites = new Set([
  "/v1/auth/sign-in/email",
  "/v1/auth/sign-up/email",
  "/v1/auth/sign-out",
  "/v1/auth/email-otp/send-verification-otp",
  "/v1/auth/email-otp/verify-email",
  "/v1/auth/request-password-reset",
  "/v1/auth/reset-password",
]);
const cloudMfaChallengeWrites = new Set([
  "/v1/auth/two-factor/send-otp",
  "/v1/auth/two-factor/verify-otp",
  "/v1/auth/two-factor/verify-totp",
  "/v1/auth/two-factor/verify-backup-code",
]);

const scopedReads = new Set([
  "/v1/shop/auth/get-session",
  "/v1/shop/csrf",
  "/v1/shop/account",
  ...["catalog", "me", "favorites", "orders", "wallet", "wallet/entries", "withdrawals"].map(
    (path) => `/v1/shop/commerce/${path}`,
  ),
]);
const scopedWrites = new Set([
  "/v1/shop/auth/sign-in/email",
  "/v1/shop/auth/sign-out",
  ...Array.from(cloudMfaChallengeWrites, (path) => path.replace("/v1/auth/", "/v1/shop/auth/")),
  ...[
    "referrals/bind",
    "orders",
    "orders/recover",
    "withdrawals",
    "image-uploads",
    "image-search",
  ].map((path) => `/v1/shop/commerce/${path}`),
]);
const scopedWriteWithId = new RegExp(
  "^/v1/shop/commerce/(?:" +
    ["favorites/{id}", "orders/{id}/(?:test-pay|cancel|returns)", "image-uploads/{id}/complete"]
      .join("|")
      .replaceAll("{id}", "[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}") +
    ")$",
);
const scopedPage = (pathname: string) => pathname === "/shop" || pathname === "/shop/sign-in";

function allowsScopedApiRequest(pathname: string, method: string | undefined): boolean {
  return (
    ((method === "GET" || method === "OPTIONS") && scopedReads.has(pathname)) ||
    ((method === "POST" || method === "OPTIONS") &&
      (scopedWrites.has(pathname) || scopedWriteWithId.test(pathname)))
  );
}
/** Renderer network admission only; server authentication and authorization still apply. */
function allowsCloudApiRequest(
  pathname: string,
  method: string | undefined,
  canonical: boolean,
): boolean {
  if (cloudCommerceApi.test(pathname)) {
    // Commerce resource names are literal. Do not let spelling or separator
    // variants of this new mutation fall through to the older commerce prefix.
    const collapsed = pathname.replace(/\/{2,}/g, "/");
    if (/^\/v1\/commerce\/[^/]*%/.test(collapsed)) return false;
    if (/^\/v1\/commerce\/orders\/recover(?:\/|$)/i.test(decodeURIComponent(collapsed)))
      return (
        canonical && pathname === cloudOrderRecovery && (method === "POST" || method === "OPTIONS")
      );
    if (!collapsed.toLowerCase().startsWith(cloudImageUploads)) return true;
    return (
      canonical &&
      (method === "POST" || method === "OPTIONS") &&
      (pathname === cloudImageUploads || cloudImageUploadComplete.test(pathname))
    );
  }
  if (cloudApiReads.has(pathname)) return method === "GET" || method === "OPTIONS";
  return (
    (method === "POST" || method === "OPTIONS") &&
    (cloudApiWrites.has(pathname) || (canonical && cloudMfaChallengeWrites.has(pathname)))
  );
}

function cleanPath(url: URL): boolean {
  return !/%(?:2e|2f|5c)/i.test(url.pathname) && !url.pathname.includes("\\");
}

export const SHOP_WEB_PREFERENCES = {
  partition: SHOP_WINDOW_PARTITION,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webviewTag: false,
} as const;

/** AI commands must never be delivered to the isolated shop's renderer. */
export function selectAiMenuWindow<T extends object>(
  focusedWindow: T | null,
  mainWindow: T | null,
  allWindows: readonly T[],
  shopWindow: T | null,
): T | null {
  if (focusedWindow && focusedWindow !== shopWindow) return focusedWindow;
  if (mainWindow && mainWindow !== shopWindow) return mainWindow;
  return allWindows.find((window) => window !== shopWindow) ?? null;
}

export function getShopEntryUrl(rendererEntryUrl: string, destination?: ShopDestination): string {
  return destination?.entryUrl ?? new URL(SHOP_ENTRY_PATH, rendererEntryUrl).href;
}

function sameSite(candidate: URL, entry: URL): boolean {
  // Custom protocols have a null URL.origin, so compare protocol and host explicitly.
  return (
    candidate.protocol === entry.protocol &&
    candidate.host === entry.host &&
    candidate.username === "" &&
    candidate.password === ""
  );
}

export function isShopOpenerUrl(candidate: string, rendererEntryUrl: string): boolean {
  try {
    const url = new URL(candidate);
    return sameSite(url, new URL(rendererEntryUrl)) && !url.pathname.startsWith("/shop/");
  } catch {
    return false;
  }
}

export function isShopNavigationUrl(
  candidate: string,
  rendererEntryUrl: string,
  destination?: ShopDestination,
): boolean {
  try {
    const url = new URL(candidate);
    if (destination?.kind === "cloud") {
      return (
        sameSite(url, new URL(destination.entryUrl)) &&
        cleanPath(url) &&
        (destination.scopedTest ? scopedPage(url.pathname) : cloudPages.test(url.pathname))
      );
    }
    return sameSite(url, new URL(rendererEntryUrl)) && url.pathname === SHOP_ENTRY_PATH;
  } catch {
    return false;
  }
}

export function isShopResourceUrl(
  candidate: string,
  rendererEntryUrl: string,
  destination?: ShopDestination,
  requestMethod?: string,
): boolean {
  try {
    const url = new URL(candidate);
    if (destination?.kind === "cloud") {
      const web = new URL(destination.entryUrl);
      if (url.protocol === "blob:") return sameSite(new URL(url.pathname), web);
      if (!cleanPath(url) || url.username || url.password) return false;
      if (destination.scopedTest) {
        if (candidate !== url.href) return false;
        if (sameSite(url, web))
          return (
            (requestMethod === "GET" || requestMethod === "HEAD") &&
            (scopedPage(url.pathname) ||
              url.pathname.startsWith("/_next/") ||
              url.pathname.startsWith("/shop/media/") ||
              url.pathname === "/favicon.ico")
          );
        return (
          url.origin === destination.apiOrigin &&
          allowsScopedApiRequest(url.pathname, requestMethod)
        );
      }
      if (
        sameSite(url, web) &&
        (cloudPages.test(url.pathname) ||
          url.pathname.startsWith("/_next/") ||
          url.pathname === "/favicon.ico")
      )
        return true;
      if (url.origin === destination.apiOrigin) {
        // Sensitive paths must not match only after URL normalization.
        return allowsCloudApiRequest(url.pathname, requestMethod, candidate === url.href);
      }
      return Boolean(destination.storageOrigin && url.origin === destination.storageOrigin);
    }
    if (url.protocol === "blob:") {
      return sameSite(new URL(url.pathname), new URL(rendererEntryUrl));
    }
    return sameSite(url, new URL(rendererEntryUrl)) && url.pathname.startsWith("/shop/");
  } catch {
    return false;
  }
}
