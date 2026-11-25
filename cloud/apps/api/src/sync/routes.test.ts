import { ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { Principal } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { makeSyncRoutes } from "./routes.ts";
import type { SyncService } from "./SyncService.ts";

const beginAttachmentUpload = vi.fn(async () => ({ alreadyPresent: true, contentHash: "h" }));
const setDeviceSync = vi.fn(async () => ({ deviceId: "d", syncEnabled: true }));
const app = HttpRouter.toWebHandler(
  makeSyncRoutes({
    sync: { beginAttachmentUpload, setDeviceSync } as unknown as SyncService,
    principals: { resolve: async () => ({ userId: "u", orgId: "o" }) as Principal },
  }),
  { disableLogger: true },
);
afterAll(() => app.dispose());

const send = (path: string, method: string, contentType: string | null) => {
  const request = new Request(`https://cloud.test${path}`, {
    method,
    body: JSON.stringify({ contentHash: "a".repeat(64), sizeBytes: 1, enabled: true }),
    ...(contentType ? { headers: { "content-type": contentType } } : {}),
  });
  if (!contentType) request.headers.delete("content-type");
  return app.handler(
    request,
    ServiceMap.make(RequestContext, {
      traceId: "t",
      ip: "198.51.100.7",
      userAgent: null,
      region: "test",
      startedAt: 0,
    }),
  );
};

describe("sync routes only read a body declared as JSON", () => {
  it.each(["text/plain", "application/x-www-form-urlencoded", null])(
    "refuses a %s body, which a browser can send cross-origin without a preflight",
    async (contentType) => {
      for (const [path, method] of [
        ["/v1/sync/attachments", "POST"],
        ["/v1/sync/devices/d/enabled", "PUT"],
      ] as const) {
        const response = await send(path, method, contentType);
        expect(response.status).toBe(415);
        expect(await response.json()).toMatchObject({ error: { code: "unsupported_media_type" } });
      }
      expect(beginAttachmentUpload).not.toHaveBeenCalled();
      expect(setDeviceSync).not.toHaveBeenCalled();
    },
  );

  it("accepts application/json", async () => {
    expect((await send("/v1/sync/attachments", "POST", "application/json")).status).toBe(200);
    expect(beginAttachmentUpload).toHaveBeenCalledOnce();
  });
});
