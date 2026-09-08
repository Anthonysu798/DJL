import { DEFAULT_SERVER_SETTINGS } from "@synara/contracts";
import { describe, expect, it } from "vitest";
import { buildHarnessInvocation } from "./accounts";
import { nativeProfileOptions } from "./native/profile";
import { kimiSubscriptionEnvironment } from "./native/kimi";

describe("Kimi subscription regions", () => {
  it.each([
    ["global", "kimi.ai"],
    ["mainland-cn", "kimi.com"],
  ] as const)("keeps %s login and runtime on the same official endpoints", (region, domain) => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        kimi: { ...DEFAULT_SERVER_SETTINGS.providers.kimi, region },
      },
    };
    const login = buildHarnessInvocation("kimi", settings, "/tmp", {
      KIMI_MODEL_NAME: "api-model",
      KIMI_MODEL_API_KEY: "api-secret",
    });
    const profile = nativeProfileOptions("kimi", settings);
    expect(login.loginArgs).toEqual(["login"]);
    expect(profile.kimi?.region).toBe(region);
    expect(login.env.KIMI_CODE_OAUTH_HOST).toBe(`https://auth.${domain}`);
    expect(login.env.KIMI_CODE_BASE_URL).toBe(`https://api.${domain}/coding/v1`);
    expect(login.env.KIMI_MODEL_NAME).toBeUndefined();
    expect(login.env.KIMI_MODEL_API_KEY).toBeUndefined();
  });
  it("preserves the existing CLI region and home unless the user chooses a region", () => {
    const original = {
      KIMI_CODE_HOME: "/custom/kimi",
      KIMI_CODE_OAUTH_HOST: "https://auth.kimi.ai",
      KIMI_CODE_BASE_URL: "https://api.kimi.ai/coding/v1",
    };
    expect(kimiSubscriptionEnvironment(original, "existing")).toMatchObject(original);
  });
});
