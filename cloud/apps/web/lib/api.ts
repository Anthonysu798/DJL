import type { CloudCreditsResponse, CloudMeResponse } from "@synara/contracts/cloud";

import { API_URL } from "./config";

export interface ApiErrorBody {
  error: { code: string; message: string; traceId: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId: string | null,
  ) {
    super(message);
  }
}

let csrfToken: Promise<string> | null = null;

/** Double-submit token the API requires on cookie-authenticated writes (GET /v1/csrf). */
function csrf(): Promise<string> {
  csrfToken ??= fetch(`${API_URL}/v1/csrf`, { credentials: "include" })
    .then((res) => res.json() as Promise<{ token: string }>)
    .then((body) => body.token)
    .catch((error: unknown) => {
      csrfToken = null;
      throw error;
    });
  return csrfToken;
}

/** Same-site credentialed call to the control plane. */
export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  retried = false,
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  const method = (rest.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") headers.set("x-csrf-token", await csrf());
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers,
    credentials: "include",
    body: json !== undefined ? JSON.stringify(json) : (rest.body ?? null),
  });
  if (res.status === 403 && !retried && res.headers.get("content-type")?.includes("json")) {
    const code = ((await res.clone().json()) as Partial<ApiErrorBody>).error?.code;
    // The cookie can rotate (a new browser session); fetch a fresh token once.
    if (code === "csrf_token") {
      csrfToken = null;
      return api<T>(path, init, true);
    }
  }
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-json error */
    }
    throw new ApiError(
      res.status,
      body.error?.code ?? "http_error",
      body.error?.message ?? `Request failed (${res.status})`,
      body.error?.traceId ?? null,
    );
  }
  return (await res.json()) as T;
}

export type Me = CloudMeResponse;
export type Credits = CloudCreditsResponse;
