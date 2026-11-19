import { ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";

import type { Principal } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import {
  commerceAddressLookupKey,
  makeCommerceAddressLookupRoutes,
} from "./addressLookupRoutes.ts";

const keyConfig = {
  DJL_COMMERCE_GOOGLE_ADDRESS_ENABLED: "true",
  DJL_COMMERCE_GOOGLE_PLACES_KEY: "example-server-only-key",
  PUBLIC_TERMS_URL: "https://shop.example/terms",
  PUBLIC_PRIVACY_URL: "https://shop.example/privacy",
};
const principal: Principal = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "buyer@example.invalid",
  emailVerified: true,
  banned: false,
  sessionId: "test-session",
  orgId: "test-org",
  personalOrgId: "test-org",
  role: "member",
};
const sessionToken = "00000000-0000-4000-8000-000000000001";
const address = {
  line1: "50 Sample Street",
  line2: "Unit 2",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 2T6",
  country: "CA" as const,
};

function fixture(caller: Principal | ApiError = principal) {
  const suggest = vi.fn(async () => [{ placeId: "sample-id", label: "50 Sample Street" }]);
  const resolve = vi.fn(async () => address);
  const hit = vi.fn(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }));
  const router = HttpRouter.toWebHandler(
    makeCommerceAddressLookupRoutes({
      addressLookup: { suggest, resolve },
      addressLookupLimiter: { hit },
      principals: {
        resolve: async () => {
          if (caller instanceof ApiError) throw caller;
          return caller;
        },
      },
    }),
    { disableLogger: true },
  );
  const context = ServiceMap.make(RequestContext, {
    traceId: "test-address",
    ip: "127.0.0.1",
    userAgent: null,
    region: "test",
    startedAt: 0,
  });
  return {
    suggest,
    resolve,
    hit,
    dispose: router.dispose,
    call: (body?: unknown) =>
      router.handler(
        new Request(
          "http://localhost/v1/commerce/address-lookup",
          body !== undefined
            ? {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              }
            : undefined,
        ),
        context,
      ),
  };
}

describe("Canadian commerce address lookup", () => {
  it("is disabled in local, test and mock environments and without explicit hosted prerequisites", () => {
    const production = { env: "production", mockExternals: false } as const;
    expect(commerceAddressLookupKey(production, keyConfig)).toBe(
      keyConfig.DJL_COMMERCE_GOOGLE_PLACES_KEY,
    );
    expect(
      commerceAddressLookupKey({ ...production, mockExternals: true }, keyConfig),
    ).toBeUndefined();
    for (const env of ["local", "test"] as const)
      expect(commerceAddressLookupKey({ ...production, env }, keyConfig)).toBeUndefined();
    for (const key of Object.keys(keyConfig))
      expect(commerceAddressLookupKey(production, { ...keyConfig, [key]: "" })).toBeUndefined();
    expect(
      commerceAddressLookupKey(production, {
        ...keyConfig,
        PUBLIC_PRIVACY_URL: "http://shop.example/",
      }),
    ).toBeUndefined();
  });

  it("requires a verified buyer before revealing availability or spending provider quota", async () => {
    for (const [status, caller] of [
      [401, new ApiError(401, "unauthorized", "Sign in required.")],
      [403, { ...principal, emailVerified: false }],
    ] as const) {
      const f = fixture(caller);
      try {
        expect((await f.call()).status).toBe(status);
        expect((await f.call({ query: "50", sessionToken })).status).toBe(status);
        expect(f.hit).not.toHaveBeenCalled();
        expect(f.suggest).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    }
  });

  it("accepts short address queries, resolves a selected place, and never returns the key", async () => {
    const f = fixture();
    try {
      expect(await (await f.call()).json()).toEqual({ enabled: true });
      const response = await f.call({ query: " 50 ", sessionToken });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        suggestions: [{ placeId: "sample-id", label: "50 Sample Street" }],
      });
      expect(f.suggest).toHaveBeenCalledWith("50", sessionToken, expect.any(AbortSignal));
      expect(f.hit).toHaveBeenCalledWith(
        expect.stringMatching(/^commerce-address:user:[a-f\d]{64}$/),
        30,
        60,
      );
      expect(await (await f.call({ placeId: "sample-id", sessionToken })).json()).toEqual({
        address,
      });
      expect(f.resolve).toHaveBeenCalledWith("sample-id", sessionToken, expect.any(AbortSignal));
    } finally {
      await f.dispose();
    }
  });

  it("rejects invalid/extra inputs before quota use and fails closed on rate or upstream failure", async () => {
    const f = fixture();
    try {
      for (const body of [
        { query: "5", sessionToken },
        { query: "50", sessionToken: "old" },
        { query: "x".repeat(151), sessionToken },
        { query: "50", sessionToken, recipient: "do not send" },
        { query: "50", placeId: "sample-id", sessionToken },
        { placeId: "https://other.example/", sessionToken },
      ])
        expect((await f.call(body)).status).toBe(400);
      expect(f.hit).not.toHaveBeenCalled();
      f.hit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
      expect((await f.call({ query: "50", sessionToken })).status).toBe(429);
      expect(f.suggest).not.toHaveBeenCalled();
      f.suggest.mockRejectedValueOnce(new Error("sensitive-provider-error"));
      const failed = await f.call({ query: "50", sessionToken });
      expect(failed.status).toBe(503);
      expect(await failed.text()).not.toContain("sensitive-provider-error");
    } finally {
      await f.dispose();
    }
  });
});
