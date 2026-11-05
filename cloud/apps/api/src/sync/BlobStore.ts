/**
 * S3-compatible attachment storage with signed client URLs.
 */
export interface BlobStore {
  /** Pre-signed PUT for a client upload, pinned to the type and size; expires in minutes. */
  readonly presignUpload: (
    key: string,
    mimeType: string,
    sizeBytes: number,
  ) => Promise<{
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly expiresAt: string;
  }>;
  /** Pre-signed GET, valid for `expiresSeconds` (default ten minutes). */
  readonly presignDownload: (
    key: string,
    expiresSeconds?: number,
  ) => Promise<{ readonly url: string; readonly expiresAt: string }>;
  /** Confirm an object exists and matches the expected size. */
  readonly head: (key: string) => Promise<{ readonly sizeBytes: number } | null>;
  /** Object bytes, or null if missing. A supplied cap applies to actual bytes read. */
  readonly read: (key: string, maxBytes?: number) => Promise<Uint8Array | null>;
  /** Server-side upload (generated files). */
  readonly write: (key: string, bytes: Uint8Array, mimeType: string) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
}

export class BlobReadLimitError extends Error {
  constructor() {
    super("Storage object exceeds the permitted size.");
    this.name = "BlobReadLimitError";
  }
}

function validateReadLimit(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new RangeError("Invalid storage read limit.");
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body;
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    void body?.cancel().catch(() => undefined);
    throw new BlobReadLimitError();
  }
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  let complete = false;
  try {
    // Do not accumulate chunks or trust Content-Length to bound decoded bytes.
    const bytes = new Uint8Array(maxBytes);
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        complete = true;
        return bytes.subarray(0, size);
      }
      if (chunk.value.byteLength > maxBytes - size) throw new BlobReadLimitError();
      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class FakeBlobStore implements BlobStore {
  readonly objects = new Map<string, { sizeBytes: number; mimeType: string; bytes?: Uint8Array }>();
  async presignUpload(key: string, mimeType: string, sizeBytes: number) {
    // Tests "upload" by calling complete(); mark the object as present immediately.
    this.objects.set(key, { sizeBytes, mimeType });
    return {
      url: `https://blob.test/upload/${encodeURIComponent(key)}`,
      headers: { "content-type": mimeType, "content-length": String(sizeBytes) },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  }
  async presignDownload(key: string, expiresSeconds = 600) {
    const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString();
    return {
      url: `https://blob.test/${encodeURIComponent(key)}?expires=${encodeURIComponent(expiresAt)}`,
      expiresAt,
    };
  }
  /** What a client's PUT to the presigned URL would store. */
  put(key: string, bytes: Uint8Array, mimeType = "application/octet-stream") {
    this.objects.set(key, { sizeBytes: bytes.byteLength, mimeType, bytes });
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.sizeBytes } : null;
  }
  async read(key: string, maxBytes?: number) {
    const bytes = this.objects.get(key)?.bytes ?? null;
    if (maxBytes !== undefined) {
      validateReadLimit(maxBytes);
      if (bytes && bytes.byteLength > maxBytes) throw new BlobReadLimitError();
    }
    return bytes;
  }
  async write(key: string, bytes: Uint8Array, mimeType: string) {
    this.put(key, bytes, mimeType);
  }
  async remove(key: string) {
    this.objects.delete(key);
  }
}

/** SigV4 signing works with both public and private S3 endpoints. */
const hmac = async (key: ArrayBuffer | Uint8Array, data: string) => {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
};
const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export function createS3BlobStore(config: {
  readonly endpoint: string;
  readonly publicEndpoint?: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Server-side writes for isolated corpora only; do not alter client upload grants. */
  readonly writeOnce?: boolean;
  readonly fetchImpl?: typeof fetch;
}): BlobStore {
  const fetchImpl = config.fetchImpl ?? fetch;

  const sha256 = async (s: string) =>
    hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

  async function presign(
    method: "GET" | "PUT" | "HEAD" | "DELETE",
    key: string,
    expiresSeconds: number,
    extraHeaders: Record<string, string> = {},
    endpoint = config.endpoint,
  ) {
    const host = new URL(endpoint).host;
    const base = `${endpoint.replace(/\/+$/, "")}/${config.bucket}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const scope = `${date}/${config.region}/s3/aws4_request`;
    const signedHeaders = ["host", ...Object.keys(extraHeaders).map((h) => h.toLowerCase())]
      .toSorted()
      .join(";");
    const canonicalHeaders =
      [
        `host:${host}`,
        ...Object.entries(extraHeaders).map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`),
      ]
        .toSorted()
        .join("\n") + "\n";
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresSeconds),
      "X-Amz-SignedHeaders": signedHeaders,
    });
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    const objectUrl = new URL(`${base}/${encodedKey}`);
    const canonicalRequest = [
      method,
      objectUrl.pathname,
      query.toString(),
      canonicalHeaders,
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonicalRequest)].join(
      "\n",
    );
    let signingKey = await hmac(new TextEncoder().encode(`AWS4${config.secretAccessKey}`), date);
    for (const part of [config.region, "s3", "aws4_request"])
      signingKey = await hmac(signingKey, part);
    const signature = hex(await hmac(signingKey, stringToSign));
    query.set("X-Amz-Signature", signature);
    return {
      url: `${objectUrl}?${query.toString()}`,
      expiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
    };
  }

  return {
    async presignUpload(key, mimeType, sizeBytes) {
      const headers = { "content-type": mimeType, "content-length": String(sizeBytes) };
      const { url, expiresAt } = await presign(
        "PUT",
        key,
        600,
        headers,
        config.publicEndpoint ?? config.endpoint,
      );
      return { url, headers, expiresAt };
    },
    async presignDownload(key, expiresSeconds = 600) {
      return presign("GET", key, expiresSeconds, {}, config.publicEndpoint ?? config.endpoint);
    },
    async head(key) {
      const { url } = await presign("HEAD", key, 60);
      const res = await fetchImpl(url, { method: "HEAD" });
      if (!res.ok) return null;
      return { sizeBytes: Number(res.headers.get("content-length") ?? "0") };
    },
    async read(key, maxBytes) {
      if (maxBytes !== undefined) validateReadLimit(maxBytes);
      const { url } = await presign("GET", key, 60);
      const res = await fetchImpl(url);
      if (!res.ok) {
        if (maxBytes !== undefined) void res.body?.cancel().catch(() => undefined);
        if (res.status === 404) return null;
        throw new Error(`storage read failed: ${res.status}`);
      }
      return maxBytes === undefined
        ? new Uint8Array(await res.arrayBuffer())
        : readBoundedResponse(res, maxBytes);
    },
    async write(key, bytes, mimeType) {
      const headers: Record<string, string> = {
        "content-type": mimeType,
        "content-length": String(bytes.byteLength),
      };
      if (config.writeOnce) headers["if-none-match"] = "*";
      const { url } = await presign("PUT", key, 60, headers);
      const res = await fetchImpl(url, { method: "PUT", headers, body: bytes as BodyInit });
      if (!res.ok) throw new Error(`storage write failed: ${res.status}`);
    },
    async remove(key) {
      const { url } = await presign("DELETE", key, 60);
      const res = await fetchImpl(url, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`storage delete failed: ${res.status}`);
    },
  };
}

/**
 * The blob store for this process. Real S3-compatible storage whenever it is
 * configured, even when other externals are mocked, so the API and worker
 * share one store and browsers can reach presigned URLs (local SeaweedFS in
 * development). The in-memory fake is only for mock mode without S3 settings.
 */
export function blobStoreFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  options: { readonly mockExternals: boolean },
): BlobStore {
  if (!env.STORAGE_S3_ENDPOINT && options.mockExternals) return new FakeBlobStore();
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  return createS3BlobStore({
    endpoint: required("STORAGE_S3_ENDPOINT"),
    ...(env.STORAGE_S3_PUBLIC_ENDPOINT ? { publicEndpoint: env.STORAGE_S3_PUBLIC_ENDPOINT } : {}),
    region: env.STORAGE_S3_REGION ?? "us-east-1",
    bucket: env.STORAGE_BUCKET ?? "djl-sync",
    accessKeyId: required("STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY"),
  });
}
