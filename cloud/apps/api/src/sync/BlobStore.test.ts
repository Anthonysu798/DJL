import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { FakeBlobStore, blobStoreFromEnv, createS3BlobStore } from "./BlobStore.ts";

function store(respond: (req: { method: string; url: URL }) => Response = () => new Response()) {
  const calls: { method: string; url: URL }[] = [];
  const blobs = createS3BlobStore({
    endpoint: "https://objects.example.test/storage/v1/s3",
    region: "us-east-2",
    bucket: "djl",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret",
    fetchImpl: (async (input: string, init?: RequestInit) => {
      const call = { method: init?.method ?? "GET", url: new URL(input) };
      calls.push(call);
      return respond(call);
    }) as typeof fetch,
  });
  return { blobs, calls };
}

describe("S3 blob store", () => {
  it("signs public client URLs separately from internal server requests", async () => {
    const calls: URL[] = [];
    const blobs = createS3BlobStore({
      endpoint: "http://s3:8333",
      publicEndpoint: "https://files.djl.test",
      region: "us-east-1",
      bucket: "djl-files",
      accessKeyId: "test",
      secretAccessKey: "test-secret",
      fetchImpl: (async (input: string) => {
        calls.push(new URL(input));
        return new Response(new Uint8Array([1]));
      }) as typeof fetch,
    });
    const download = new URL((await blobs.presignDownload("org/file")).url);
    expect(download.origin).toBe("https://files.djl.test");
    expect(new URL((await blobs.presignUpload("org/file", "text/plain", 1)).url).origin).toBe(
      "https://files.djl.test",
    );
    await blobs.read("org/file");
    expect(calls[0]!.origin).toBe("http://s3:8333");
    expect(calls[0]!.searchParams.get("X-Amz-Signature")).not.toBe(
      download.searchParams.get("X-Amz-Signature"),
    );
  });
  it("signs the full endpoint path sent to storage", async () => {
    const { blobs } = store();
    const url = new URL((await blobs.presignDownload("org/o/files/f")).url);
    const signature = url.searchParams.get("X-Amz-Signature");
    url.searchParams.delete("X-Amz-Signature");
    const date = url.searchParams.get("X-Amz-Date")!;
    const scope = `${date.slice(0, 8)}/us-east-2/s3/aws4_request`;
    const request = [
      "GET",
      url.pathname,
      url.searchParams.toString(),
      `host:${url.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const toSign = [
      "AWS4-HMAC-SHA256",
      date,
      scope,
      createHash("sha256").update(request).digest("hex"),
    ].join("\n");
    let key = Buffer.from("AWS4secret");
    for (const part of [date.slice(0, 8), "us-east-2", "s3", "aws4_request"])
      key = createHmac("sha256", key).update(part).digest();
    expect(signature).toBe(createHmac("sha256", key).update(toSign).digest("hex"));
  });
  it("pins uploads to their type and size in the signature", async () => {
    const { blobs } = store();
    const upload = await blobs.presignUpload("org/o/files/f", "image/png", 1234);
    const url = new URL(upload.url);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(upload.headers).toEqual({ "content-type": "image/png", "content-length": "1234" });
  });

  it("signs downloads for the requested lifetime", async () => {
    const { blobs } = store();
    const before = Date.now();
    const download = await blobs.presignDownload("org/o/files/f", 300);
    expect(new URL(download.url).searchParams.get("X-Amz-Expires")).toBe("300");
    expect(Date.parse(download.expiresAt) - before).toBeLessThanOrEqual(301_000);
    expect(Date.parse(download.expiresAt) - before).toBeGreaterThan(299_000);
  });

  it("reads bytes, treats a missing object as null, and deletes with a signed DELETE", async () => {
    const { blobs, calls } = store(({ url }) =>
      url.pathname.endsWith("/missing")
        ? new Response(null, { status: 404 })
        : new Response(new Uint8Array([1, 2, 3])),
    );
    expect(await blobs.read("org/o/files/f")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await blobs.read("org/o/files/missing")).toBeNull();
    await blobs.remove("org/o/files/f");
    expect(calls.at(-1)!.method).toBe("DELETE");
    expect(calls.at(-1)!.url.pathname).toBe("/storage/v1/s3/djl/org/o/files/f");
    expect(calls.at(-1)!.url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes server-side with a PUT signed for the type and size", async () => {
    const { blobs, calls } = store();
    await blobs.write("org/o/files/g", new Uint8Array([9, 9]), "image/png");
    expect(calls.at(-1)!.method).toBe("PUT");
    expect(calls.at(-1)!.url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host",
    );
    const failing = store(() => new Response("no", { status: 403 }));
    await expect(failing.blobs.write("k", new Uint8Array([1]), "image/png")).rejects.toThrow();
  });
});

describe("blob store selection", () => {
  const s3 = {
    STORAGE_S3_ENDPOINT: "http://127.0.0.1:9000",
    STORAGE_ACCESS_KEY_ID: "djl",
    STORAGE_SECRET_ACCESS_KEY: "djl-local-secret",
  };

  it("uses real S3 storage whenever it is configured, even with other externals mocked", async () => {
    const blobs = blobStoreFromEnv({ ...s3, STORAGE_BUCKET: "djl-local" }, { mockExternals: true });
    expect(blobs).not.toBeInstanceOf(FakeBlobStore);
    const upload = await blobs.presignUpload("org/o/files/f", "image/png", 4);
    expect(upload.url.startsWith("http://127.0.0.1:9000/djl-local/org/o/files/f?")).toBe(true);
  });

  it("falls back to the in-memory store only in mock mode without S3 settings", () => {
    expect(blobStoreFromEnv({}, { mockExternals: true })).toBeInstanceOf(FakeBlobStore);
  });

  it("refuses to start without S3 settings outside mock mode", () => {
    expect(() => blobStoreFromEnv({}, { mockExternals: false })).toThrow(/STORAGE_S3_ENDPOINT/);
  });
});
