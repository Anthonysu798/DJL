import { parseRetryAfterMs } from "../providerUsage/http";

/** Retry rejected admission only, before any model text or tool call is consumed. */
export function cloudRateLimitRetryDelay(
  code: string | undefined,
  message: string,
  attempt: number,
  headers?: Headers,
): number | null {
  if (attempt >= 2 || (code !== "rate_limited" && code !== "provider_rate_limited")) return null;
  const seconds = /^Too many requests\. Retry in (\d+)s\.$/.exec(message)?.[1];
  const fallback = (code === "provider_rate_limited" ? 5000 : 1000) * (attempt + 1);
  const delay =
    (headers ? parseRetryAfterMs(headers, Date.now()) : undefined) ??
    (seconds ? Number(seconds) * 1000 : fallback);
  return Number.isFinite(delay) && delay <= 60_000 ? Math.max(1, delay) : null;
}

export async function waitForCloudRetry(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
