import { describe, expect, it } from "vitest";
import {
  CommerceMediaPolicyError,
  commerceApprovedImageUrl,
  commerceMediaOrigin,
  commerceProductImageUrl,
} from "./commerceMediaPolicy.ts";

const policy = {
  mediaOrigin: "https://media.test",
  webPublicUrl: "https://shop.test",
  apiPublicUrl: "https://api.test",
};

describe("shared commerce product media policy", () => {
  it("keeps safe relative demos publishable without configuration or model keys", () => {
    for (const image of ["/shop/media/tote.png", "/shop/media/blue%20tote.webp?v=2#preview"]) {
      expect(commerceProductImageUrl(image, "published")).toBe(image);
      expect(commerceApprovedImageUrl(image, {})).toBeNull();
      expect(commerceApprovedImageUrl(image, { mediaOrigin: policy.mediaOrigin })).toBeNull();
      expect(
        commerceProductImageUrl(image, "published", { webPublicUrl: "http://localhost:3000" }),
      ).toBe(image);
      expect(commerceApprovedImageUrl(image, { webPublicUrl: "http://localhost:3000" })).toBeNull();
    }
  });

  it("uses the explicit web /shop/ base, never a different approved CDN, for relative images", () => {
    expect(commerceProductImageUrl("/shop/media/tote.png", "published", policy)).toBe(
      "/shop/media/tote.png",
    );
    expect(commerceApprovedImageUrl("/shop/media/tote.png", policy)).toBe(
      "https://shop.test/shop/media/tote.png",
    );
    expect(commerceApprovedImageUrl("https://shop.test/shop/media/tote.png", policy)).toBe(
      "https://shop.test/shop/media/tote.png",
    );
    expect(
      commerceApprovedImageUrl("/shop/media/tote.png", { webPublicUrl: policy.webPublicUrl }),
    ).toBe("https://shop.test/shop/media/tote.png");
    expect(commerceApprovedImageUrl("https://media.test/catalog/tote.png", policy)).toBe(
      "https://media.test/catalog/tote.png",
    );
    expect(
      commerceProductImageUrl("https://media.test/catalog/tote.png", "published", policy),
    ).toBe("https://media.test/catalog/tote.png");
  });

  it("stores safe unapproved supplier origins only in drafts or archives and rejects publishing them", () => {
    const url = "https://supplier.test/catalog/tote.png";
    expect(commerceProductImageUrl(url, "draft", policy)).toBe(url);
    expect(commerceProductImageUrl(url, "archived", policy)).toBe(url);
    for (const configuration of [{}, policy]) {
      expect(() => commerceProductImageUrl(url, "published", configuration)).toThrow(
        CommerceMediaPolicyError,
      );
      try {
        commerceProductImageUrl(url, "published", configuration);
      } catch (error) {
        expect(error).toMatchObject({ code: "image_origin_not_approved" });
      }
      expect(commerceApprovedImageUrl(url, configuration)).toBeNull();
    }
  });

  it("never expands the web origin beyond /shop/, including when MEDIA repeats that origin", () => {
    for (const configuration of [
      policy,
      { mediaOrigin: policy.webPublicUrl, webPublicUrl: policy.webPublicUrl },
    ]) {
      expect(() =>
        commerceProductImageUrl("https://shop.test/uploads/tote.png", "published", configuration),
      ).toThrow();
      expect(
        commerceApprovedImageUrl("https://shop.test/uploads/tote.png", configuration),
      ).toBeNull();
      expect(commerceApprovedImageUrl("https://shop.test/shop/media/tote.png", configuration)).toBe(
        "https://shop.test/shop/media/tote.png",
      );
    }
  });

  it.each([
    "https:media.test",
    "https:/media.test/tote.png",
    "https://@media.test/tote.png",
    "//supplier.test/tote.png",
    "data:image/png;base64,test",
    "file:///shop/tote.png",
    "javascript:alert(1)",
    "http://media.test/tote.png",
    "https://user:private@media.test/tote.png",
    "https://media.test@evil.test/tote.png",
    "/shop/../private.png",
    "/shop/./tote.png",
    "/shop/%2e%2e/private.png",
    "/shop/%252e%252e/private.png",
    "/shop/media%2ftote.png",
    "/shop/media%5Ctote.png",
    "/shop//media/tote.png",
    "/shop\\..\\tote.png",
    "/outside/tote.png",
    "/shop/media/tote.png\n",
    "/shop/media/tote%00.png",
    "/shop/media/tote%zz.png",
    "https://media.test/x/../tote.png",
    "https://media.test/x/%2E%2E/tote.png",
    "https://media.test//tote.png",
    "https:\\media.test\\tote.png",
    " https://media.test/tote.png",
    "https://127.0.0.1/tote.png",
    "https://localhost./tote.png",
    "https://[::1]/tote.png",
    "https://internal.local/tote.png",
  ])("rejects unsafe image syntax for all publication states: %s", (url) => {
    for (const status of ["draft", "published", "archived"] as const)
      expect(() => commerceProductImageUrl(url, status, policy)).toThrow(CommerceMediaPolicyError);
    expect(commerceApprovedImageUrl(url, policy)).toBeNull();
  });

  it.each([
    { mediaOrigin: "https:media.test" },
    { mediaOrigin: "https://media.test/a/.." },
    { mediaOrigin: "https://media.test/%2e" },
    { mediaOrigin: "https://@media.test" },
    { mediaOrigin: "https://media.test?" },
    { mediaOrigin: "http://media.test" },
    { mediaOrigin: "https://media.test/path" },
    { mediaOrigin: "https://user:private@media.test" },
    { mediaOrigin: "https://media.test?secret=private" },
    { mediaOrigin: "https://media.test#fragment" },
    { mediaOrigin: "https://localhost" },
    { mediaOrigin: "https://127.0.0.1" },
    { mediaOrigin: "https://media.local" },
    { webPublicUrl: "http://shop.test" },
    { webPublicUrl: "https://shop.test/shop" },
    { webPublicUrl: "https://private@shop.test" },
    { webPublicUrl: "https://shop.test?private" },
    { apiPublicUrl: "http://api.test" },
    { apiPublicUrl: "https://api.test/path" },
    { apiPublicUrl: "https://private@api.test" },
    { apiPublicUrl: "https://media.test", mediaOrigin: "https://media.test/" },
  ])(
    "fails published configuration explicitly instead of guessing or relaxing origins: %j",
    (configuration) => {
      expect(() =>
        commerceProductImageUrl("/shop/media/tote.png", "published", configuration),
      ).toThrow(CommerceMediaPolicyError);
      try {
        commerceProductImageUrl("/shop/media/tote.png", "published", configuration);
      } catch (error) {
        expect(error).toMatchObject({ code: "media_configuration_invalid" });
        expect((error as Error).message).not.toContain("private");
      }
      expect(() => commerceApprovedImageUrl("/shop/media/tote.png", configuration)).toThrow(
        CommerceMediaPolicyError,
      );
      expect(
        commerceProductImageUrl("https://supplier.test/tote.png", "draft", configuration),
      ).toBe("https://supplier.test/tote.png");
    },
  );

  it("requires exact normalized approved origins, not hostname suffixes, ports or guessed storage", () => {
    expect(commerceMediaOrigin("https://MEDIA.test:443/")).toBe("https://media.test");
    for (const url of [
      "https://media.test.evil.test/a.png",
      "https://sub.media.test/a.png",
      "https://media.test:444/a.png",
      "https://storage.test/a.png",
      "https://api.test/shop/media/tote.png",
    ]) {
      expect(commerceApprovedImageUrl(url, policy)).toBeNull();
      expect(() => commerceProductImageUrl(url, "published", policy)).toThrow();
    }
  });
});
