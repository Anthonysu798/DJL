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

/** Same-site credentialed call to the control plane. */
export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers,
    credentials: "include",
    body: json !== undefined ? JSON.stringify(json) : (rest.body ?? null),
  });
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
