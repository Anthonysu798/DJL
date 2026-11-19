import { afterAll, expect, it, vi } from "vitest";
import { ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RequestContext } from "../../http/context.ts";
import { ApiError } from "../../http/errors.ts";
import { makeSocialReportRoutes } from "./routes.ts";
import type { SocialReportService } from "./SocialReportService.ts";
const principal = {
  userId: "owner",
  orgId: "organization",
  email: "",
  emailVerified: true,
  banned: false,
  sessionId: "session",
  role: "owner" as const,
  personalOrgId: "organization",
};
const id = crypto.randomUUID();
const input = { enabled: true, timezone: "America/Toronto", weekday: 1, hour: 9, minute: 0 };
const service = {
  getSchedule: vi.fn(async () => ({ ...input, enabled: false, id: null })),
  getState: vi.fn(async () => ({ schedule: { ...input, enabled: false }, reports: [] })),
  setSchedule: vi.fn(async (_p: unknown, draftId: string, preference: unknown) => {
    if (draftId !== id) throw new ApiError(404, "not_found", "Not found.");
    return { schedule: preference, reports: [] };
  }),
};
const app = HttpRouter.toWebHandler(
  makeSocialReportRoutes({
    socialReports: service as unknown as SocialReportService,
    principals: {
      resolve: async ({ headers }) => {
        if (headers.get("authorization") !== "Bearer owned-session")
          throw new ApiError(401, "unauthorized", "Sign in required.");
        return principal;
      },
    },
  }),
  { disableLogger: true },
);
const handler = (request: Request) =>
  app.handler(
    request,
    ServiceMap.make(RequestContext, {
      traceId: "fixture",
      ip: null,
      userAgent: null,
      region: "test",
      startedAt: 0,
    }),
  );
afterAll(() => app.dispose());
const request = (suffix: string, init: RequestInit = {}) =>
  handler(
    new Request(`https://cloud.test/v1/social/drafts/${id}/${suffix}`, {
      ...init,
      headers: {
        authorization: "Bearer owned-session",
        "content-type": "application/json",
        ...init.headers,
      },
    }),
  );
it("requires authentication for every recap endpoint and keeps responses private", async () => {
  for (const suffix of ["report-schedule", "reports"]) {
    const response = await handler(
      new Request(`https://cloud.test/v1/social/drafts/${id}/${suffix}`),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(
    (
      await handler(
        new Request(`https://cloud.test/v1/social/drafts/${id}/report-schedule`, {
          method: "PUT",
          body: JSON.stringify(input),
          headers: { "content-type": "application/json" },
        }),
      )
    ).status,
  ).toBe(401);
  const read = await request("reports");
  expect(read.status).toBe(200);
  expect(read.headers.get("cache-control")).toBe("no-store");
});
it("uses authenticated identity and owned draft path, ignoring caller-supplied identities", async () => {
  const response = await request("report-schedule", {
    method: "PUT",
    body: JSON.stringify({ ...input, userId: "foreign", orgId: "other", threadId: "untrusted" }),
  });
  expect(response.status).toBe(200);
  expect(service.setSchedule).toHaveBeenCalledWith(principal, id, input);
  const foreign = await handler(
    new Request(`https://cloud.test/v1/social/drafts/${crypto.randomUUID()}/report-schedule`, {
      method: "PUT",
      headers: { authorization: "Bearer owned-session", "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  expect(foreign.status).toBe(404);
});
it("requires an explicit boolean opt-in and complete schedule input", async () => {
  for (const body of [
    { timezone: "UTC" },
    { ...input, enabled: "true" },
    { ...input, hour: 9.5 },
  ]) {
    expect(
      (await request("report-schedule", { method: "PUT", body: JSON.stringify(body) })).status,
    ).toBe(400);
  }
});
