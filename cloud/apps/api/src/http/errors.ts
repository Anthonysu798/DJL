import { HttpServerResponse } from "effect/unstable/http";

/** Uniform JSON error envelope. Codes are stable strings clients switch on. */
export interface ApiErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly traceId: string };
}

export class ApiError extends Error {
  readonly _tag = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(status: number, code: string, message: string, traceId: string) {
  const body: ApiErrorBody = { error: { code, message, traceId } };
  return HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "x-trace-id": traceId, "cache-control": "no-store" },
  });
}

export const unauthorized = (traceId: string) =>
  errorResponse(401, "unauthorized", "Sign in required.", traceId);
export const forbidden = (traceId: string) =>
  errorResponse(403, "forbidden", "Not allowed.", traceId);
export const notFound = (traceId: string) => errorResponse(404, "not_found", "Not found.", traceId);
