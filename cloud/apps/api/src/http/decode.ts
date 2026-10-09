import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import { ApiError } from "./errors.ts";
import { readJson } from "./json.ts";

type Decodable = Schema.Top & { readonly DecodingServices: never };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decode input with a contract schema, or fail with a 400 naming the bad field. */
export function decode<S extends Decodable>(schema: S, input: unknown) {
  return Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((e) => new ApiError(400, "bad_request", e.message)),
  ) as Effect.Effect<S["Type"], ApiError>;
}

/** The JSON body decoded with a contract schema. */
export const decodeBody = <S extends Decodable>(schema: S) =>
  Effect.flatMap(readJson, (body) => decode(schema, body));

/** The query string decoded with a contract schema. */
export const decodeQuery = <S extends Decodable>(schema: S) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    return yield* decode(schema, Object.fromEntries(url?.searchParams ?? []));
  });

/** A uuid path parameter. Anything else is a 404: it cannot name a row. */
export const idParam = (name: string) =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const value = params[name] ?? "";
    if (!UUID.test(value)) return yield* Effect.fail(new ApiError(404, "not_found", "Not found."));
    return value.toLowerCase();
  });
