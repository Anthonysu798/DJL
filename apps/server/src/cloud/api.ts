/**
 * Minimal HTTP client for the DJL Cloud control plane. Region selection: the
 * global hostname is the default; mainland users are served by a hostname
 * that is not proxied through Cloudflare, chosen by a one-time latency probe
 * when the setting is "auto".
 */
export const DJL_CLOUD_HOSTS = {
  global: "https://api.slcor.com",
  asia: "https://api-asia.slcor.com",
} as const;

export type CloudRegionSetting = "auto" | "global" | "asia";

/** Narrow fetch signature so tests can pass a plain function without Bun's `preconnect`. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CloudHttpError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly traceId: string | null;
}

export class CloudApiError extends Error {
  readonly _tag = "CloudApiError";
  constructor(readonly detail: CloudHttpError) {
    super(detail.message);
  }
}

let probedBase: string | null = null;

export function resolveCloudBaseUrl(region: CloudRegionSetting, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.DJL_CLOUD_API_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  if (region === "asia") return DJL_CLOUD_HOSTS.asia;
  if (region === "global") return DJL_CLOUD_HOSTS.global;
  return probedBase ?? DJL_CLOUD_HOSTS.global;
}

/** Pick the faster hostname once per process; failures fall back to global. */
export async function probeCloudRegion(fetchImpl: FetchLike = fetch): Promise<string> {
  if (probedBase) return probedBase;
  const time = async (base: string) => {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetchImpl(`${base}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok ? Date.now() - started : Number.POSITIVE_INFINITY;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  };
  const [global, asia] = await Promise.all([time(DJL_CLOUD_HOSTS.global), time(DJL_CLOUD_HOSTS.asia)]);
  probedBase = asia < global ? DJL_CLOUD_HOSTS.asia : DJL_CLOUD_HOSTS.global;
  return probedBase;
}

async function parseError(res: Response): Promise<CloudHttpError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; traceId?: string } };
    return {
      status: res.status,
      code: body.error?.code ?? "http_error",
      message: body.error?.message ?? `DJL Cloud returned ${res.status}`,
      traceId: body.error?.traceId ?? null,
    };
  } catch {
    return { status: res.status, code: "http_error", message: `DJL Cloud returned ${res.status}`, traceId: null };
  }
}

export interface CloudClient {
  readonly baseUrl: string;
  readonly get: <T>(path: string, token?: string | null) => Promise<T>;
  readonly post: <T>(path: string, body: unknown, token?: string | null) => Promise<T>;
  /** POST returning the raw response for SSE streams. */
  readonly stream: (path: string, body: unknown, token: string, signal: AbortSignal) => Promise<Response>;
}

export function createCloudClient(baseUrl: string, fetchImpl: FetchLike = fetch): CloudClient {
  const headers = (token?: string | null, extra: Record<string, string> = {}) => ({
    "content-type": "application/json",
    "x-djl-client": "desktop",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  const check = async <T>(res: Response): Promise<T> => {
    if (!res.ok) throw new CloudApiError(await parseError(res));
    return (await res.json()) as T;
  };
  return {
    baseUrl,
    get: async (path, token) => check(await fetchImpl(`${baseUrl}${path}`, { headers: headers(token) })),
    post: async (path, body, token) =>
      check(await fetchImpl(`${baseUrl}${path}`, { method: "POST", headers: headers(token), body: JSON.stringify(body) })),
    stream: async (path, body, token, signal) => {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: headers(token, { accept: "text/event-stream" }),
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new CloudApiError(await parseError(res));
      return res;
    },
  };
}
