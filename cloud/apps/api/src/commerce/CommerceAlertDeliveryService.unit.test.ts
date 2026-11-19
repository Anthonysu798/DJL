import { describe, expect, it } from "vitest";
import { commerceAlertEmailConfig } from "./CommerceAlertDeliveryService.ts";

describe("independent commerce email configuration", () => {
  it("is off by default and never borrows the AI mail key", () => {
    expect(commerceAlertEmailConfig({ RESEND_API_KEY: "unrelated-test-key" })).toMatchObject({
      enabled: false,
      senderConfigured: false,
    });
    expect(
      commerceAlertEmailConfig({
        DJL_ENV: "test",
        DJL_COMMERCE_ALERT_EMAIL_ENABLED: "true",
        DJL_MOCK_EXTERNALS: "false",
        DJL_COMMERCE_ALERT_EMAIL_TO: "ops@test.invalid",
        DJL_COMMERCE_ALERT_EMAIL_FROM: "sender@test.invalid",
        RESEND_API_KEY: "unrelated-test-key",
      }),
    ).toMatchObject({ enabled: true, mode: "resend", senderConfigured: false });
  });
  it.each([
    [undefined, undefined, "mock"],
    ["local", undefined, "mock"],
    ["test", "true", "mock"],
    ["test", "false", "resend"],
    ["local", "false", "resend"],
    ["staging", "true", "resend"],
    ["production", undefined, "resend"],
    ["production", "true", "resend"],
  ])(
    "matches the existing normalized environment semantics for %s/%s",
    (environment, mock, mode) => {
      expect(
        commerceAlertEmailConfig({
          ...(environment ? { DJL_ENV: environment } : {}),
          ...(mock ? { DJL_MOCK_EXTERNALS: mock } : {}),
        }).mode,
      ).toBe(mode);
    },
  );
  it("admits an explicit mock without a provider key and does not expose the dedicated key", () => {
    const result = commerceAlertEmailConfig({
      DJL_ENV: "test",
      DJL_MOCK_EXTERNALS: "true",
      DJL_COMMERCE_ALERT_EMAIL_ENABLED: "1",
      DJL_COMMERCE_ALERT_EMAIL_TO: "ops@test.invalid",
      DJL_COMMERCE_ALERT_EMAIL_RESEND_API_KEY: "dedicated-test-secret",
    });
    expect(result).toMatchObject({ enabled: true, mode: "mock", senderConfigured: true });
    expect(JSON.stringify(result)).not.toContain("dedicated-test-secret");
  });
});
