/**
 * Object storage for attachments. Production uses Supabase Storage through its
 * S3-compatible endpoint with pre-signed URLs; tests use an in-memory fake.
 */
export interface BlobStore {
  /** Pre-signed PUT for a client upload; expires in minutes. */
  readonly presignUpload: (
    key: string,
    mimeType: string,
    sizeBytes: number,
  ) => Promise<{
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly expiresAt: string;
  }>;
  /** Pre-signed GET. */
  readonly presignDownload: (
    key: string,
  ) => Promise<{ readonly url: string; readonly expiresAt: string }>;
  /** Confirm an object exists and matches the expected size. */
  readonly head: (key: string) => Promise<{ readonly sizeBytes: number } | null>;
  readonly remove: (key: string) => Promise<void>;
}

export class FakeBlobStore implements BlobStore {
  readonly objects = new Map<string, { sizeBytes: number; mimeType: string }>();
  async presignUpload(key: string, mimeType: string, sizeBytes: number) {
    // Tests "upload" by calling complete(); mark the object as present immediately.
    this.objects.set(key, { sizeBytes, mimeType });
    return {
      url: `https://blob.test/upload/${encodeURIComponent(key)}`,
      headers: { "content-type": mimeType },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  }
  async presignDownload(key: string) {
    return {
      url: `https://blob.test/${encodeURIComponent(key)}`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.sizeBytes } : null;
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
    method: "GET" | "PUT" | "HEAD",
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
      const { url, expiresAt } = await presign("PUT", key, 600, { "content-type": mimeType });
      return { url, headers, expiresAt };
    },
    async presignDownload(key) {
      return presign("GET", key, 600);
    },
    async head(key) {
      const { url } = await presign("HEAD", key, 60);
      const res = await fetchImpl(url, { method: "HEAD" });
      if (!res.ok) return null;
      return { sizeBytes: Number(res.headers.get("content-length") ?? "0") };
    },
    async remove(key) {
      const now = new Date();
      void now;
      const { url } = await presign("PUT", key, 60); // placeholder path; deletes run from the worker with service credentials
      void url;
    },
  };
}
