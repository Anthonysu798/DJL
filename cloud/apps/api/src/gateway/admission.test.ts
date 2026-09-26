import { describe, expect, it } from "vitest";

import { ApiError } from "../http/errors.ts";
import {
  allowAll,
  runAdmission,
  type AdmissionContext,
  type AdmissionPolicy,
} from "./admission.ts";

const ctx = {
  facts: {
    principal: {
      userId: "u",
      email: "u@test.invalid",
      emailVerified: true,
      banned: false,
      sessionId: "s",
      orgId: "o",
      role: "owner",
      personalOrgId: "o",
    },
    traceId: "t",
    ipHash: null,
    deviceId: null,
  },
  limits: { planId: "trial", concurrentStreams: 1, requestsPerMinute: 1, priorityWeight: 1 },
} satisfies AdmissionContext;

function recording(log: string[], name: string, fail = false): AdmissionPolicy {
  return {
    name,
    admit: async () => {
      log.push(`admit:${name}`);
      if (fail) throw new ApiError(429, `${name}_refused`, "no");
      return async () => void log.push(`release:${name}`);
    },
  };
}

describe("runAdmission", () => {
  it("admits through every policy in order and releases holds once, in reverse", async () => {
    const log: string[] = [];
    const release = await runAdmission(
      [recording(log, "a"), allowAll("b"), recording(log, "c")],
      ctx,
    );
    expect(log).toEqual(["admit:a", "admit:c"]);
    await release();
    await release();
    expect(log).toEqual(["admit:a", "admit:c", "release:c", "release:a"]);
  });

  it("stops at the first refusal and releases what earlier policies held", async () => {
    const log: string[] = [];
    await expect(
      runAdmission([recording(log, "a"), recording(log, "b", true), recording(log, "c")], ctx),
    ).rejects.toMatchObject({ code: "b_refused" });
    expect(log).toEqual(["admit:a", "admit:b", "release:a"]);
  });
});
