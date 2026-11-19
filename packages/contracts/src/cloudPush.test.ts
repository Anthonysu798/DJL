import { Schema } from "effect";
import { expect, it } from "vitest";

import { CloudPushTokenInput } from "./cloud";

const decode = Schema.decodeUnknownSync(CloudPushTokenInput);

it("preserves legacy APNs input and accepts explicit case-sensitive FCM installations", () => {
  const legacy = { token: "A".repeat(64), environment: "sandbox" };
  expect(decode(legacy)).toEqual(legacy);
  const android = { provider: "fcm", token: "AbC_Fid-123", environment: "production" };
  expect(decode(android)).toEqual(android);
});

it("rejects unknown providers, malformed installation identifiers and FCM sandbox", () => {
  for (const token of ["", "x".repeat(201), "has space", "\nidentifier", "id\u0000x"]) {
    expect(() => decode({ provider: "fcm", token, environment: "production" })).toThrow();
  }
  expect(() =>
    decode({ provider: "other", token: "A".repeat(64), environment: "production" }),
  ).toThrow();
  expect(() => decode({ provider: "fcm", token: "AbC_Fid-123", environment: "sandbox" })).toThrow();
  expect(() => decode({ token: "AbC_Fid-123", environment: "production" })).toThrow();
});
