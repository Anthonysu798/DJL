import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { CloudSocialReportScheduleInput } from "../../../../../../packages/contracts/src/cloud/socialReports.ts";
import { requirePrincipal, type PrincipalResolver } from "../../auth/guard.ts";
import { decodeBody, idParam } from "../../http/decode.ts";
import { attempt as rawAttempt, handle } from "../../http/handle.ts";
import { json } from "../../http/json.ts";
import { ApiError } from "../../http/errors.ts";
import type { SocialReportService } from "./SocialReportService.ts";
const FAIL = {
  status: 500,
  code: "social_report_error",
  message: "Social results are unavailable. Your recap preference is preserved.",
};
const attempt = <A>(fn: () => Promise<A>) =>
  rawAttempt(async () => {
    try {
      return await fn();
    } catch (error) {
      throw error instanceof ApiError ? error : new ApiError(FAIL.status, FAIL.code, FAIL.message);
    }
  }, FAIL);
export function makeSocialReportRoutes(deps: {
  socialReports: SocialReportService;
  principals: PrincipalResolver;
}) {
  const principal = requirePrincipal(deps.principals);
  return Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/v1/social/drafts/:id/report-schedule",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.socialReports.getSchedule(p, id)));
        }),
      ),
    ),
    HttpRouter.add(
      "PUT",
      "/v1/social/drafts/:id/report-schedule",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          const input = yield* decodeBody(CloudSocialReportScheduleInput);
          return json(yield* attempt(() => deps.socialReports.setSchedule(p, id, input)));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/v1/social/drafts/:id/reports",
      handle(
        Effect.gen(function* () {
          const p = yield* principal;
          const id = yield* idParam("id");
          return json(yield* attempt(() => deps.socialReports.getState(p, id)));
        }),
      ),
    ),
  );
}
