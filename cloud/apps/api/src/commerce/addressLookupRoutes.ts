import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { requirePrincipal, type PrincipalResolver } from "../auth/guard.ts";
import type { ApiEnv } from "../config/env.ts";
import type { RateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import { handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import type { CommerceAddressLookup } from "./CommerceAddressLookup.ts";

const path = "/v1/commerce/address-lookup";
const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const placeIdPattern = /^[\w-]{1,512}$/;

function publicPolicy(value: string | undefined) {
  const url = URL.parse(value ?? "");
  return Boolean(url?.protocol === "https:" && !url.username && !url.password);
}

export function commerceAddressLookupKey(
  env: Pick<ApiEnv, "env" | "mockExternals">,
  values: NodeJS.ProcessEnv,
): string | undefined {
  if (
    (env.env !== "staging" && env.env !== "production") ||
    env.mockExternals ||
    values.DJL_COMMERCE_GOOGLE_ADDRESS_ENABLED !== "true" ||
    !publicPolicy(values.PUBLIC_TERMS_URL) ||
    !publicPolicy(values.PUBLIC_PRIVACY_URL)
  )
    return undefined;
  return values.DJL_COMMERCE_GOOGLE_PLACES_KEY?.trim() || undefined;
}

export interface CommerceAddressLookupRouteDeps {
  readonly addressLookup?: Pick<CommerceAddressLookup, "suggest" | "resolve">;
  readonly principals: PrincipalResolver;
  readonly addressLookupLimiter: Pick<RateLimiter, "hit">;
}

export function makeCommerceAddressLookupRoutes({
  addressLookup,
  principals,
  addressLookupLimiter: limiter,
}: CommerceAddressLookupRouteDeps) {
  if (!addressLookup) return Layer.empty;
  const buyer = Effect.gen(function* () {
    const principal = yield* requirePrincipal(principals);
    if (!principal.emailVerified)
      return yield* Effect.fail(
        new ApiError(403, "email_verification_required", "Verify your email first."),
      );
    return principal;
  });

  return Layer.mergeAll(
    HttpRouter.add("GET", path, handle(Effect.map(buyer, () => json({ enabled: true })))),
    HttpRouter.add(
      "POST",
      path,
      handle(
        Effect.gen(function* () {
          const principal = yield* buyer;
          const raw = yield* readJson;
          const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
          const token = body.sessionToken;
          const query = typeof body.query === "string" ? body.query.trim() : "";
          const id = typeof body.placeId === "string" ? body.placeId : "";
          const suggest =
            query.length >= 2 &&
            query.length <= 150 &&
            !/[\r\n\t]/.test(query) &&
            !("placeId" in body);
          const resolve = placeIdPattern.test(id) && !("query" in body);
          if (
            Object.keys(body).length !== 2 ||
            typeof token !== "string" ||
            !uuidV4.test(token) ||
            (!suggest && !resolve)
          )
            return yield* Effect.fail(new ApiError(400, "bad_request", "Invalid address lookup."));

          const user = createHash("sha256").update(principal.userId).digest("hex");
          const result = yield* Effect.tryPromise({
            try: async (signal) => {
              if (
                !(await limiter.hit(`commerce-address:user:${user}`, 30, 60)).allowed ||
                !(await limiter.hit("commerce-address:global", 300, 60)).allowed
              )
                throw new ApiError(
                  429,
                  "address_lookup_limit",
                  "Too many requests. Try again later.",
                );
              return suggest
                ? { suggestions: await addressLookup.suggest(query, token, signal) }
                : { address: await addressLookup.resolve(id, token, signal) };
            },
            // Do not log upstream errors or request data: these can contain an address or key.
            catch: (cause) =>
              cause instanceof ApiError
                ? cause
                : new ApiError(503, "address_lookup_unavailable", "Address lookup is unavailable."),
          });
          return json(result);
        }),
      ),
    ),
  );
}
