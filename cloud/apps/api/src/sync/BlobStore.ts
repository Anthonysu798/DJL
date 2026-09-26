/**
 * Object storage for attachments. Production uses Supabase Storage through its
 * S3-compatible endpoint with pre-signed URLs; tests use an in-memory fake.
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
  /** The object's bytes, or null when it does not exist. */
  readonly read: (key: string) => Promise<Uint8Array | null>;
  /** Server-side upload (generated files). */
  readonly write: (key: string, bytes: Uint8Array, mimeType: string) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
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
  async read(key: string) {
    return this.objects.get(key)?.bytes ?? null;
  }
  async write(key: string, bytes: Uint8Array, mimeType: string) {
    this.put(key, bytes, mimeType);
  }
  async remove(key: string) {
    this.objects.delete(key);
  }
}

/**
 * Supabase Storage via the S3 protocol with SigV4 pre-signing. Configured with
 * the project's S3 endpoint (https://<ref>.storage.supabase.co/storage/v1/s3),
 * region, access key id and secret from the Storage settings page.
 */
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
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly fetchImpl?: typeof fetch;
}): BlobStore {
  const fetchImpl = config.fetchImpl ?? fetch;
  const host = new URL(config.endpoint).host;
  const base = `${config.endpoint.replace(/\/+$/, "")}/${config.bucket}`;

  const sha256 = async (s: string) =>
    hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

  async function presign(
    method: "GET" | "PUT" | "HEAD" | "DELETE",
    key: string,
    expiresSeconds: number,
    extraHeaders: Record<string, string> = {},
  ) {
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
    const canonicalRequest = [
      method,
      `/${config.bucket}/${encodedKey}`,
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
      url: `${base}/${encodedKey}?${query.toString()}`,
      expiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
    };
  }

  return {
    async presignUpload(key, mimeType, sizeBytes) {
      const headers = { "content-type": mimeType, "content-length": String(sizeBytes) };
      const { url, expiresAt } = await presign("PUT", key, 600, headers);
      return { url, headers, expiresAt };
    },
    async presignDownload(key, expiresSeconds = 600) {
      return presign("GET", key, expiresSeconds);
    },
    async head(key) {
      const { url } = await presign("HEAD", key, 60);
      const res = await fetchImpl(url, { method: "HEAD" });
      if (!res.ok) return null;
      return { sizeBytes: Number(res.headers.get("content-length") ?? "0") };
    },
    async read(key) {
      const { url } = await presign("GET", key, 60);
      const res = await fetchImpl(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`storage read failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async write(key, bytes, mimeType) {
      const headers = { "content-type": mimeType, "content-length": String(bytes.byteLength) };
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
