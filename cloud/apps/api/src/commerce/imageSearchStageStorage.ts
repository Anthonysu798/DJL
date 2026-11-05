import { ApiError } from "../http/errors.ts";
import { createS3BlobStore } from "../sync/BlobStore.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const photoKey = /^commerce\/image-uploads\/([0-9a-f-]+)\/(staging|ready)$/;
const proxyEnv = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "NODE_USE_ENV_PROXY",
];

const refused = () =>
  new ApiError(400, "evaluation_stage_storage_forbidden", "Use the isolated evaluation bucket.");

/** No fallback bucket, remote writes, redirects, or access to AI attachment keys. */
export function createCommerceImageStageStorage(
  env: NodeJS.ProcessEnv,
  runId: string,
  request: typeof fetch = fetch,
) {
  const endpoint = URL.parse(env.STORAGE_S3_ENDPOINT ?? "");
  const publicEndpoint = URL.parse(env.STORAGE_S3_PUBLIC_ENDPOINT ?? "");
  const bucket = `djl-commerce-eval-${runId.replaceAll("-", "")}`;
  if (
    (env.DJL_ENV !== "local" && env.DJL_ENV !== "test") ||
    !uuid.test(runId) ||
    env.STORAGE_BUCKET !== bucket ||
    !endpoint ||
    !["127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
    !["http:", "https:"].includes(endpoint.protocol) ||
    !endpoint.port ||
    endpoint.origin !== env.STORAGE_S3_ENDPOINT ||
    !publicEndpoint ||
    publicEndpoint.protocol !== "https:" ||
    publicEndpoint.origin !== env.STORAGE_S3_PUBLIC_ENDPOINT ||
    !env.STORAGE_ACCESS_KEY_ID?.trim() ||
    !env.STORAGE_SECRET_ACCESS_KEY?.trim() ||
    proxyEnv.some((key) => env[key]?.trim())
  )
    throw refused();

  const origin = endpoint.origin;
  return createS3BlobStore({
    endpoint: origin,
    publicEndpoint: publicEndpoint.origin,
    region: env.STORAGE_S3_REGION ?? "us-east-1",
    bucket,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    writeOnce: true,
    fetchImpl: (async (input, init) => {
      const url = typeof input === "string" ? URL.parse(input) : null;
      const prefix = `/${bucket}/`;
      const match =
        url?.pathname.startsWith(prefix) && photoKey.exec(url.pathname.slice(prefix.length));
      if (
        !url ||
        url.origin !== origin ||
        url.username ||
        url.password ||
        url.hash ||
        !match ||
        !uuid.test(match[1]!) ||
        !["HEAD", "GET", "PUT", "DELETE"].includes(init?.method ?? "GET")
      )
        throw refused();
      return request(url.href, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
    }) as typeof fetch,
  });
}
