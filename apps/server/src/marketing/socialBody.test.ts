import { it, assert } from "@effect/vitest";
import { Effect, Stream } from "effect";
import type { HttpServerRequest } from "effect/unstable/http";
import { readSocialBody } from "./handler";
it.effect("bounds social JSON using actual streamed bytes even without Content-Length", () =>
  Effect.gen(function* () {
    const request = {
      stream: Stream.make(new Uint8Array(40000), new Uint8Array(40000)),
    } as unknown as HttpServerRequest.HttpServerRequest;
    const error = yield* readSocialBody(request).pipe(Effect.flip);
    assert.strictEqual(error.status, 413);
    const valid = {
      stream: Stream.make(new TextEncoder().encode('{"action":"state"}')),
    } as unknown as HttpServerRequest.HttpServerRequest;
    assert.deepEqual(yield* readSocialBody(valid), { action: "state" });
  }),
);
