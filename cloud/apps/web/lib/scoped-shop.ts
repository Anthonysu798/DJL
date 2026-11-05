import { ApiError, type ApiErrorBody } from "./api";
import type { CommerceCatalogResponse } from "@synara/contracts/cloud";
import { createCommerceClient, uploadCommerceImage, type CommerceRequest } from "./commerce";
import { safeNext } from "./safeNext";

type ScopedConfig =
  | { readonly mode: "off" | "invalid" }
  | { readonly mode: "test"; readonly webOrigin: string; readonly apiOrigin: string };

function canonicalLoopbackHttps(value?: string) {
  try {
    if (!value) return null;
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.port &&
      url.origin === value &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

export function resolveScopedShopConfig(input: {
  readonly enabled?: string | undefined;
  readonly webUrl?: string | undefined;
  readonly apiUrl?: string | undefined;
}): ScopedConfig {
  if (input.enabled !== "true") return { mode: "off" };
  const web = canonicalLoopbackHttps(input.webUrl);
  const api = canonicalLoopbackHttps(input.apiUrl);
  return web && api && web.hostname === api.hostname && web.origin !== api.origin
    ? { mode: "test", webOrigin: web.origin, apiOrigin: api.origin }
    : { mode: "invalid" };
}

export const scopedShopConfig = resolveScopedShopConfig({
  enabled: process.env.NEXT_PUBLIC_DJL_TEST_SCOPED_SHOP,
  webUrl: process.env.NEXT_PUBLIC_DJL_TEST_SCOPED_SHOP_WEB_URL,
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
});

const authBase = "/v1/shop/auth";
const buyerReadPath = /^\/(catalog|me|favorites|orders|wallet(?:\/entries)?|withdrawals)$/;
const buyerWritePath =
  /^\/(favorites\/[^/]+|referrals\/bind|orders(?:\/(?:recover|[^/]+\/(?:test-pay|cancel|returns)))?|withdrawals|image-uploads(?:\/[^/]+\/complete)?|image-search)$/;

async function scopedFetch<T>(
  path: string,
  method: "GET" | "POST",
  options: {
    readonly json?: unknown;
    readonly signal?: AbortSignal | null | undefined;
    readonly csrf?: string;
  } = {},
): Promise<T> {
  if (
    scopedShopConfig.mode !== "test" ||
    typeof window === "undefined" ||
    window.location.origin !== scopedShopConfig.webOrigin
  )
    throw new ApiError(503, "scoped_shop_unavailable", "本地独立测试商城未启用。", null);
  options.signal?.throwIfAborted();
  const headers = new Headers();
  if (options.json !== undefined) headers.set("content-type", "application/json");
  if (options.csrf) headers.set("x-csrf-token", options.csrf);
  const res = await fetch(scopedShopConfig.apiOrigin + path, {
    method,
    headers,
    credentials: "include",
    redirect: "error",
    cache: "no-store",
    signal: options.signal ?? null,
    ...(method === "POST" && options.json !== undefined
      ? { body: JSON.stringify(options.json) }
      : {}),
  });
  options.signal?.throwIfAborted();
  let result: unknown;
  try {
    result = await res.json();
  } catch {
    throw new ApiError(
      res.ok ? 503 : res.status,
      "scoped_shop_response",
      "测试商城响应未确认，请重试。",
      null,
    );
  }
  options.signal?.throwIfAborted();
  if (!res.ok) {
    const error = (result as Partial<ApiErrorBody> | null)?.error;
    throw new ApiError(
      res.status,
      typeof error?.code === "string" ? error.code : "scoped_shop_response",
      typeof error?.message === "string" ? error.message : "测试商城请求未确认，请重试。",
      typeof error?.traceId === "string" ? error.traceId : null,
    );
  }
  return result as T;
}

const scopedCommerceRequest: CommerceRequest = async <T>(
  path: string,
  init?: RequestInit & { json?: unknown },
) => {
  const legacy = "/v1/commerce/";
  const method = (init?.method ?? "GET").toUpperCase();
  const pathname = "/" + path.slice(legacy.length).split("?")[0];
  if (
    !path.startsWith(legacy) ||
    (method === "GET"
      ? !buyerReadPath.test(pathname)
      : method !== "POST" || !buyerWritePath.test(pathname))
  )
    throw new ApiError(
      503,
      "scoped_shop_operation_unavailable",
      "本地测试商城不支持此操作。",
      null,
    );
  const scopedPath = "/v1/shop" + path.slice(3);
  const signal = init?.signal;
  if (method === "GET") {
    const result = await scopedFetch<T>(scopedPath, "GET", { signal });
    if (pathname === "/catalog") {
      const catalog = result as CommerceCatalogResponse | null;
      if (catalog?.mode !== "test" || catalog.paymentProvider !== "simulation")
        throw new ApiError(
          503,
          "scoped_shop_operation_unavailable",
          "本地测试商城仅支持模拟付款。",
          null,
        );
    }
    return result;
  }
  // Read a scoped token for each write; never reuse a generic token or one
  // cached before an account switch. The original signal guards both requests.
  const csrf = await scopedFetch<{ token?: unknown }>("/v1/shop/csrf", "GET", { signal });
  if (typeof csrf?.token !== "string" || !csrf.token)
    throw new ApiError(
      503,
      "scoped_shop_csrf_unavailable",
      "测试商城安全校验未确认，请重试。",
      null,
    );
  return scopedFetch<T>(scopedPath, "POST", { json: init?.json ?? {}, signal, csrf: csrf.token });
};

export const scopedShopCommerce = createCommerceClient(scopedCommerceRequest);
export const scopedUploadCommerceImage: typeof uploadCommerceImage = (file, input) =>
  uploadCommerceImage(file, input, scopedCommerceRequest);

export type ScopedShopSession = {
  readonly user: { readonly id: string; readonly email: string; readonly emailVerified: true };
  readonly session: { readonly id: string };
};
function identity(value: unknown): ScopedShopSession["user"] | null {
  const user = value as Partial<ScopedShopSession["user"]> | null;
  return typeof user?.id === "string" &&
    user.id &&
    typeof user.email === "string" &&
    user.email &&
    user.emailVerified === true
    ? { id: user.id, email: user.email, emailVerified: true }
    : null;
}

export async function getScopedShopSession(
  signal?: AbortSignal,
): Promise<ScopedShopSession | null> {
  const data = await scopedFetch<Partial<ScopedShopSession> | null>(
    authBase + "/get-session",
    "GET",
    { signal },
  );
  if (data === null) return null;
  const user = identity(data?.user);
  if (!user || typeof data?.session?.id !== "string" || !data.session.id)
    throw new Error("测试商城会话未确认。");
  return { user, session: { id: data.session.id } };
}

async function confirmScopedSignIn(
  result: { user?: unknown } | null,
  email: string,
  signal: AbortSignal,
) {
  const user = identity(result?.user);
  if (!user || user.email.toLowerCase() !== email.trim().toLowerCase())
    throw new Error("测试商城登录未确认。");
  const session = await getScopedShopSession(signal);
  if (!session || session.user.id !== user.id || session.user.email !== user.email)
    throw new Error("测试商城会话未确认。");
}

export async function signInScopedShop(email: string, password: string, signal: AbortSignal) {
  const result = await scopedFetch<{
    user?: unknown;
    twoFactorRedirect?: unknown;
    twoFactorMethods?: unknown;
  } | null>(authBase + "/sign-in/email", "POST", {
    json: { email: email.trim(), password, rememberMe: false },
    signal,
  });
  if (result?.twoFactorRedirect === true) {
    return Array.isArray(result.twoFactorMethods) && result.twoFactorMethods.includes("totp")
      ? "totp"
      : "unsupported_factor";
  }
  await confirmScopedSignIn(result, email, signal);
  return "signed_in";
}

export async function verifyScopedShopTotp(email: string, code: string, signal: AbortSignal) {
  const result = await scopedFetch<{ user?: unknown } | null>(
    authBase + "/two-factor/verify-totp",
    "POST",
    {
      json: { code },
      signal,
    },
  );
  await confirmScopedSignIn(result, email, signal);
}

export async function signOutScopedShop() {
  const result = await scopedFetch<{ success?: unknown } | null>(authBase + "/sign-out", "POST", {
    json: {},
  });
  if (result?.success !== true) throw new Error("测试商城退出未确认。");
}

export function scopedShopSignInPath(referralCode?: string) {
  const next = `/shop${referralCode ? `?ref=${encodeURIComponent(referralCode)}` : ""}`;
  return `/shop/sign-in?next=${encodeURIComponent(next)}`;
}

export function scopedShopReturn(raw: string | null) {
  const next = safeNext(raw, "/shop");
  return next.split(/[?#]/, 1)[0] === "/shop" ? next : "/shop";
}
