import { describe, expect, it } from "vitest";
import { cloudSignInUrl } from "./cloudSignInUrl";

describe("desktop account sign-in URL", () => {
  it.each(["email", "google"] as const)(
    "selects %s without changing the PKCE request",
    (method) => {
      const url = new URL(
        cloudSignInUrl(
          "https://staging.slcor.com/authorize?state=state&code_challenge=challenge",
          method,
        ),
      );
      expect(url.searchParams.get("method")).toBe(method);
      expect(url.searchParams.get("state")).toBe("state");
      expect(url.searchParams.get("code_challenge")).toBe("challenge");
    },
  );
  it("rejects executable schemes", () => {
    expect(() => cloudSignInUrl("javascript:alert(1)", "google")).toThrow();
  });
});
