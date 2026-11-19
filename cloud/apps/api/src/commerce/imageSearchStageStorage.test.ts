import { describe, expect, it, vi } from "vitest";

import { createCommerceImageStageStorage } from "./imageSearchStageStorage.ts";

const runId = "b05857ae-a331-4cd7-a38e-18e367475cd6";
const fileId = "181ab2e5-a819-4158-98dc-6c6317f58022";
const env = {
  DJL_ENV: "test",
  STORAGE_S3_ENDPOINT: "http://127.0.0.1:9910",
  STORAGE_S3_PUBLIC_ENDPOINT: "https://evaluation.test.invalid",
  STORAGE_BUCKET: "djl-commerce-eval-b05857aea3314cd7a38e18e367475cd6",
  STORAGE_ACCESS_KEY_ID: "synthetic-access",
  STORAGE_SECRET_ACCESS_KEY: "synthetic-secret",
};

describe("local evaluation staging storage", () => {
  it.each([
    { DJL_ENV: "production" },
    { STORAGE_BUCKET: "djl-sync" },
    { STORAGE_S3_ENDPOINT: "https://production.test.invalid" },
    { STORAGE_S3_ENDPOINT: "http://127.0.0.1:9910/path" },
    { STORAGE_S3_ENDPOINT: "http://user@127.0.0.1:9910" },
    { STORAGE_S3_PUBLIC_ENDPOINT: "http://127.0.0.1:9910" },
    { STORAGE_S3_PUBLIC_ENDPOINT: "https://evaluation.test.invalid/?next=elsewhere" },
    { HTTPS_PROXY: "http://external.test.invalid" },
    { http_proxy: "http://external.test.invalid" },
  ])("refuses unsafe storage configuration: %o", (patch) => {
    const transport = vi.fn<typeof fetch>();
    expect(() => createCommerceImageStageStorage({ ...env, ...patch }, runId, transport)).toThrow(
      "Use the isolated evaluation bucket",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("only sends guarded conditional PUTs to the run's loopback bucket; grants are signed offline", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const blobs = createCommerceImageStageStorage(env, runId, transport);
    const key = `commerce/image-uploads/${fileId}/ready`;
    const grant = await blobs.presignDownload(key, 60);
    expect(new URL(grant.url).origin).toBe(env.STORAGE_S3_PUBLIC_ENDPOINT);
    expect(transport).not.toHaveBeenCalled();
    await expect(blobs.write("generic/ai/file", new Uint8Array([1]), "image/png")).rejects.toThrow(
      "Use the isolated evaluation bucket",
    );
    expect(transport).not.toHaveBeenCalled();
    await blobs.write(key, new Uint8Array([1]), "image/png");
    expect(transport).toHaveBeenCalledTimes(1);
    const [input, init] = transport.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin).toBe(env.STORAGE_S3_ENDPOINT);
    expect(url.pathname).toBe(`/${env.STORAGE_BUCKET}/${key}`);
    expect(init).toMatchObject({
      method: "PUT",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(new Headers(init?.headers).get("if-none-match")).toBe("*");
  });
});
