import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import type { PrincipalResolver } from "../auth/guard.ts";
import { requirePrincipal } from "../auth/guard.ts";
import { ApiError } from "../http/errors.ts";
import { attempt, handle } from "../http/handle.ts";
import { json } from "../http/json.ts";
import type { SyncEventInput, SyncService } from "./SyncService.ts";

export interface SyncRouteDeps {
  readonly sync: SyncService;
  readonly principals: PrincipalResolver;
}

const FAIL = { status: 500, code: "sync_error", message: "Sync failed." };
const MAX_BODY = 8 * 1024 * 1024;

const readBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (Number(request.headers["content-length"] ?? "0") > MAX_BODY)
    return yield* Effect.fail(new ApiError(413, "payload_too_large", "Body too large."));
  const text = yield* request.text.pipe(
    Effect.mapError(() => new ApiError(400, "bad_body", "Could not read body.")),
  );
  if (text.length > MAX_BODY)
    return yield* Effect.fail(new ApiError(413, "payload_too_large", "Body too large."));
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return yield* Effect.fail(new ApiError(400, "bad_json", "Body is not valid JSON."));
  }
});

const deviceHeader = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const id = request.headers["x-device-id"];
  if (!id)
    return yield* Effect.fail(
      new ApiError(400, "device_required", "x-device-id header is required."),
    );
  return id;
});

export function makeSyncRoutes(deps: SyncRouteDeps) {
  const status = HttpRouter.add(
    "GET",
    "/v1/sync/status",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const deviceId = yield* deviceHeader;
        return json(yield* attempt(() => deps.sync.status(p, deviceId), FAIL));
      }),
    ),
  );
  const enable = HttpRouter.add(
    "PUT",
    "/v1/sync/devices/:id/enabled",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const params = yield* HttpRouter.params;
        const body = yield* readBody;
        return json(
          yield* attempt(
            () => deps.sync.setDeviceSync(p, params.id ?? "", body.enabled === true),
            FAIL,
          ),
        );
      }),
    ),
  );
  const push = HttpRouter.add(
    "POST",
    "/v1/sync/events",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const deviceId = yield* deviceHeader;
        const body = yield* readBody;
        if (!Array.isArray(body.events))
          return yield* Effect.fail(new ApiError(400, "bad_request", "events must be an array."));
        return json(
          yield* attempt(() => deps.sync.push(p, deviceId, body.events as SyncEventInput[]), FAIL),
        );
      }),
    ),
  );
  const pull = HttpRouter.add(
    "GET",
    "/v1/sync/events",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const deviceId = yield* deviceHeader;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = HttpServerRequest.toURL(request);
        const cursorRaw = url?.searchParams.get("cursor") ?? "0";
        if (!/^\d+$/.test(cursorRaw))
          return yield* Effect.fail(
            new ApiError(400, "bad_cursor", "cursor must be a non-negative integer."),
          );
        const includeOwn = url?.searchParams.get("includeOwn") === "true";
        const limit = Number(url?.searchParams.get("limit") ?? "500");
        return json(
          yield* attempt(
            () => deps.sync.pull(p, deviceId, BigInt(cursorRaw), { includeOwn, limit }),
            FAIL,
          ),
        );
      }),
    ),
  );
  const threads = HttpRouter.add(
    "GET",
    "/v1/sync/threads",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        return json({ threads: yield* attempt(() => deps.sync.listThreads(p), FAIL) });
      }),
    ),
  );
  const thread = HttpRouter.add(
    "GET",
    "/v1/sync/threads/:id/events",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const params = yield* HttpRouter.params;
        return json({
          events: yield* attempt(() => deps.sync.threadEvents(p, params.id ?? ""), FAIL),
        });
      }),
    ),
  );
  const beginUpload = HttpRouter.add(
    "POST",
    "/v1/sync/attachments",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const body = yield* readBody;
        return json(
          yield* attempt(
            () =>
              deps.sync.beginAttachmentUpload(p, {
                contentHash: String(body.contentHash ?? ""),
                mimeType: String(body.mimeType ?? "application/octet-stream"),
                sizeBytes: Number(body.sizeBytes),
              }),
            FAIL,
          ),
        );
      }),
    ),
  );
  const completeUpload = HttpRouter.add(
    "POST",
    "/v1/sync/attachments/:hash/complete",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const params = yield* HttpRouter.params;
        return json(
          yield* attempt(() => deps.sync.completeAttachmentUpload(p, params.hash ?? ""), FAIL),
        );
      }),
    ),
  );
  const download = HttpRouter.add(
    "GET",
    "/v1/sync/attachments/:hash",
    handle(
      Effect.gen(function* () {
        const p = yield* requirePrincipal(deps.principals);
        const params = yield* HttpRouter.params;
        return json(yield* attempt(() => deps.sync.attachmentDownload(p, params.hash ?? ""), FAIL));
      }),
    ),
  );
  return Layer.mergeAll(
    status,
    enable,
    push,
    pull,
    threads,
    thread,
    beginUpload,
    completeUpload,
    download,
  );
}
