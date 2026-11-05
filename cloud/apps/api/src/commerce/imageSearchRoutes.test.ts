import { ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";
import type { Principal } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { makeCommerceImageSearchRoutes } from "./imageSearchRoutes.ts";

const principal: Principal = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "buyer@test.invalid",
  emailVerified: true,
  banned: false,
  sessionId: "test-session",
  orgId: "ai-team",
  personalOrgId: "personal-org",
  role: "member",
};
const result = {
  products: [],
  message: "No similar product found.",
  matchType: "similar" as const,
  modelId: "verified-model",
  indexVersion: "test-index",
};

function fixture(caller: Principal | ApiError = principal) {
  const search = vi.fn(
    async (
      _principal: Pick<Principal, "userId">,
      _body: unknown,
      _options: { readonly signal?: AbortSignal; readonly traceId?: string },
    ) => result,
  );
  const router = HttpRouter.toWebHandler(
    makeCommerceImageSearchRoutes({
      imageSearch: { search },
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
    traceId: "image-test",
    ip: "127.0.0.1",
    userAgent: null,
    region: "test",
    startedAt: Date.now(),
  });
  return {
    search,
    dispose: router.dispose,
    call: (body: string, signal?: AbortSignal) =>
      router.handler(
        new Request("http://commerce.test/v1/commerce/image-search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          ...(signal ? { signal } : {}),
        }),
        context,
      ),
  };
}

describe("commerce image route", () => {
  it("requires a signed-in verified account before spending the platform AI budget", async () => {
    for (const caller of [
      new ApiError(401, "unauthorized", "Sign in required."),
      { ...principal, emailVerified: false },
    ]) {
      const f = fixture(caller);
      try {
        expect((await f.call("{}")).status).toBe(caller instanceof ApiError ? 401 : 403);
        expect(f.search).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    }
  });

  it("passes authenticated identity, trace and abort signal rather than trusting body owner IDs", async () => {
    const f = fixture();
    const body = { fileId: "00000000-0000-4000-8000-000000000002", ownerId: "other-user" };
    try {
      const response = await f.call(JSON.stringify(body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);
      expect(f.search).toHaveBeenCalledWith(principal, body, {
        signal: expect.any(AbortSignal),
        traceId: "image-test",
      });
    } finally {
      await f.dispose();
    }
  });

  it("rejects malformed or oversized JSON before search and preserves safe service error envelopes", async () => {
    const f = fixture();
    try {
      expect((await f.call("{")).status).toBe(400);
      expect((await f.call(JSON.stringify({ query: "x".repeat(256 * 1024) }))).status).toBe(413);
      expect(f.search).not.toHaveBeenCalled();
      f.search.mockRejectedValueOnce(new ApiError(429, "image_search_limit", "Try later."));
      const response = await f.call("{}");
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({
        error: { code: "image_search_limit", message: "Try later.", traceId: "image-test" },
      });
    } finally {
      await f.dispose();
    }
  });

  it("waits for cancelled search cleanup before the request scope closes", async () => {
    const f = fixture();
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let cleaned = false;
    f.search.mockImplementationOnce(async (_principal, _body, { signal }) => {
      entered();
      await new Promise<void>((resolve) =>
        signal!.addEventListener("abort", () => resolve(), { once: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      cleaned = true;
      return result;
    });
    try {
      const response = f.call("{}", controller.signal);
      await started;
      controller.abort();
      await response;
      await f.dispose();
      expect(cleaned).toBe(true);
    } finally {
      controller.abort();
      await f.dispose();
    }
  });

  it("bounds cancellation cleanup and warns without exposing input when a dependency stays stuck", async () => {
    const f = fixture();
    const controller = new AbortController();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.search.mockImplementationOnce(async () => {
      entered();
      await blocked;
      return result;
    });
    try {
      const response = f.call(
        JSON.stringify({ query: "private shopping description" }),
        controller.signal,
      );
      await started;
      const cancelledAt = Date.now();
      controller.abort();
      await response;
      await f.dispose();
      expect(Date.now() - cancelledAt).toBeGreaterThanOrEqual(1_900);
      expect(Date.now() - cancelledAt).toBeLessThan(5_000);
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({
          level: "warn",
          msg: "commerce_image_cleanup_timeout",
          traceId: "image-test",
        }),
      );
    } finally {
      release();
      controller.abort();
      await f.dispose();
      warn.mockRestore();
    }
  });
});
