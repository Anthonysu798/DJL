import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CloudCheckoutInput, CloudCreditsResponse, CloudMeResponse, Microcredits } from "./cloud";

describe("cloud contract", () => {
  it("accepts microcredits as decimal strings only", () => {
    expect(Schema.decodeUnknownSync(Microcredits)("2500000000")).toBe("2500000000");
    expect(Schema.decodeUnknownSync(Microcredits)("-120")).toBe("-120");
    expect(() => Schema.decodeUnknownSync(Microcredits)("12.5")).toThrow();
    expect(() => Schema.decodeUnknownSync(Microcredits)(25)).toThrow();
  });

  it("decodes the /v1/me and /v1/credits shapes the backend emits", () => {
    const me = Schema.decodeUnknownSync(CloudMeResponse)({
      user: { id: "u1", email: "a@b.c", emailVerified: true },
      activeOrgId: "o1",
      role: "owner",
      organizations: [{ id: "o1", name: "Me", slug: "u-abc", role: "owner", personal: true }],
    });
    expect(me.organizations[0]?.personal).toBe(true);
    const credits = Schema.decodeUnknownSync(CloudCreditsResponse)({
      orgId: "o1",
      balances: { trial: "0", plan: "2000000000", topup: "0" },
      total: "2000000000",
      display: { total: "2000.00", trial: "0.00", plan: "2000.00", topup: "0.00" },
    });
    expect(credits.display.total).toBe("2000.00");
  });

  it("bounds top-ups to whole dollars between 5 and 10,000", () => {
    expect(Schema.decodeUnknownSync(CloudCheckoutInput)({ kind: "topup", usd: 25 })).toEqual({
      kind: "topup",
      usd: 25,
    });
    expect(() => Schema.decodeUnknownSync(CloudCheckoutInput)({ kind: "topup", usd: 4 })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CloudCheckoutInput)({ kind: "topup", usd: 5.5 }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(CloudCheckoutInput)({
        kind: "subscription",
        planId: "business",
        interval: "year",
      }).kind,
    ).toBe("subscription");
  });
});
