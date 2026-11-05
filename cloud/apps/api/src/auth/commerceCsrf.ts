import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../http/errors.ts";
import type { CommerceBuyer } from "./commerceAuth.ts";

/** The pilot accepts only the Shop origin and a token tied to its own session. */
export function createCommerceCsrf(
  auth: { readonly buyer: (headers: Headers) => Promise<CommerceBuyer | null> },
  shopOrigin: string,
  secret: string,
) {
  const tokenFor = (sessionId: string) =>
    createHmac("sha256", secret)
      .update(JSON.stringify(["djl-shop-csrf-v1", shopOrigin, sessionId]))
      .digest("base64url");

  async function resolve(headers: Headers, write: boolean) {
    if (headers.get("origin") !== shopOrigin)
      throw new ApiError(403, "csrf_origin", "This request did not come from the DJL shop.");
    const buyer = await auth.buyer(headers);
    if (!buyer) throw new ApiError(401, "unauthorized", "Shop sign-in required.");
    if (write) {
      const presented = headers.get("x-csrf-token");
      if (
        !presented ||
        !/^[A-Za-z0-9_-]{43}$/.test(presented) ||
        !timingSafeEqual(Buffer.from(presented), Buffer.from(tokenFor(buyer.sessionId)))
      )
        throw new ApiError(403, "csrf_token", "Your shop page is out of date. Try again.");
    }
    return buyer;
  }

  return {
    resolve,
    async issue(headers: Headers) {
      const buyer = await resolve(headers, false);
      return { token: tokenFor(buyer.sessionId) };
    },
  };
}

/** These explicit pilot namespaces have their own Origin/session gates. */
export function isScopedCommercePath(path: string): boolean {
  return path.startsWith("/v1/shop/auth/") || path.startsWith("/v1/shop/commerce/");
}
