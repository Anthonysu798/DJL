import { describe, expect, it } from "vitest";

import { createS3BlobStore } from "./BlobStore.ts";

function store(respond: (req: { method: string; url: URL }) => Response = () => new Response()) {
  const calls: { method: string; url: URL }[] = [];
  const blobs = createS3BlobStore({
    endpoint: "https://ref.storage.supabase.co/storage/v1/s3",
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
});
