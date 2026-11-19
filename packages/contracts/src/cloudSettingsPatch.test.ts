import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ServerSettingsPatch } from "./settings";

const decode = (input: unknown) =>
  Schema.decodeUnknownSync(ServerSettingsPatch)(input, { onExcessProperty: "error" });

describe("DJL Cloud settings updates", () => {
  it("retains enablement and region in serialized settings patches", () => {
    const patch = { providers: { djlCloud: { enabled: true, region: "global" } } };
    expect(decode(patch)).toEqual(patch);
    expect(decode({ providers: { djlCloud: { enabled: false } } })).toEqual({
      providers: { djlCloud: { enabled: false } },
    });
    expect(decode({ providers: { djlCloud: { region: "auto" } } })).toEqual({
      providers: { djlCloud: { region: "auto" } },
    });
  });
  it.each([{ region: "other" }, { enabled: "true" }, { token: "must-not-be-a-setting" }])(
    "rejects invalid or secret-bearing Cloud patches %o",
    (cloud) => {
      expect(() => decode({ providers: { djlCloud: cloud } })).toThrow();
    },
  );
});
