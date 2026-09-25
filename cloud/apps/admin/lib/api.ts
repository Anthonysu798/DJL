"use client";
/**
 * Admin API client. The admin session token is kept in memory for the tab
 * and mirrored into sessionStorage so a reload does not sign the admin out;
 * it never touches localStorage or a non-httpOnly cookie on this origin.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(
  /\/+$/,
  "",
);

let token: string | null = null;
export function getToken(): string | null {
  if (token) return token;
  try {
    token = sessionStorage.getItem("djl_admin_token");
  } catch {
    token = null;
  }
  return token;
}
export function setToken(next: string | null): void {
  token = next;
  try {
    if (next) sessionStorage.setItem("djl_admin_token", next);
    else sessionStorage.removeItem("djl_admin_token");
  } catch {
    /* ignore */
  }
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function admin<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  const t = getToken();
  if (t) headers.set("authorization", `Bearer ${t}`);
  if (json !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(`${API_URL}/admin/v1${path}`, {
    ...rest,
    headers,
    credentials: "include",
    body: json !== undefined ? JSON.stringify(json) : (rest.body ?? null),
  });
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* no body */
    }
    if (res.status === 401) setToken(null);
    throw new AdminApiError(
      res.status,
      body.error?.code ?? "http_error",
      body.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return (await res.json()) as T;
}

export const credits = (micro: string | number | bigint | null | undefined) => {
  if (micro === null || micro === undefined) return "—";
  const n = BigInt(micro);
  const whole = n / 1_000_000n;
  const cents = ((n % 1_000_000n) / 10_000n).toString().padStart(2, "0");
  return `${whole.toLocaleString()}.${cents}`;
};
export const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
