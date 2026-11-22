import { expect, it } from "vitest";
import { explainProblem } from "./problems";

const why = (error: string | null) => explainProblem({ state: "failed", error })?.key;
it("explains a failed post in words a person can act on", () => {
  expect(why("fetch failed")).toBe("whyConnection");
  expect(why("Platform preparation timed out")).toBe("whyConnection");
  expect(why("Autopilot reached its daily limit for this account")).toBe("whyLimit");
  expect(why("Platform account changed before submission")).toBe("whyAccount");
  expect(why("Autopilot is off or expired for this account")).toBe("whyPermission");
  expect(why("Prepared page is no longer available")).toBe("whyClosed");
  expect(why("Could not attach the video")).toBe("whyMedia");
  expect(why("TypeError: x is not a function")).toBe("whyUnknown");
  expect(why(null)).toBe("whyUnknown");
});
it("always offers one way forward, and stays quiet when nothing failed", () => {
  expect(explainProblem({ state: "failed", error: "fetch failed" })?.fix).toBe("retry");
  expect(explainProblem({ state: "failed", error: "daily limit" })?.fix).toBe("accounts");
  expect(explainProblem({ state: "published", error: null })).toBeNull();
});
