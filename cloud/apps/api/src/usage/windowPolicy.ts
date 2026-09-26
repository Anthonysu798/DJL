/**
 * The gateway's window admission slot and the 429 it answers with. The
 * policy is a fast read-only check; the authoritative check holds room in
 * the same transaction as the credit reservation (windowStore.holdWindows).
 */
import { windowRoom, blockingWindow, type WindowUsage } from "@djl/domain";

import type { AdmissionPolicy } from "../gateway/admission.ts";
import { ApiError } from "../http/errors.ts";
import type { UsageService } from "./UsageService.ts";

export function windowExhausted(window: WindowUsage): ApiError {
  const label = window.kind === "five_hour" ? "5-hour" : "weekly";
  return new ApiError(429, "usage_window_exhausted", `You reached your ${label} usage limit.`, {
    window: window.kind,
    ...(window.resetsAt ? { resetsAt: window.resetsAt.toISOString() } : {}),
  });
}

export function windowPolicy(usage: Pick<UsageService, "measure">): AdmissionPolicy {
  return {
    name: "window",
    admit: async ({ facts, limits }) => {
      const windows = await usage.measure(facts.principal.userId, limits.windowCaps);
      const blocking = blockingWindow(windows);
      if (windowRoom(windows) === 0n && blocking) throw windowExhausted(blocking);
    },
  };
}
