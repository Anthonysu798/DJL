import { describe, expect, it } from "vitest";

import { loadApiEnv } from "./env.ts";

const production = {
  DJL_ENV: "production",
  BETTER_AUTH_SECRET: "x".repeat(40),
  API_PUBLIC_URL: "https://api.slcor.com",
  WEB_PUBLIC_URL: "https://app.slcor.com",
  ADMIN_PUBLIC_URL: "https://admin.slcor.com",
  DATABASE_URL: "postgres://prod",
  REDIS_URL: "redis://prod",
  IP_HASH_SALT: "prod-salt",
};

describe("loadApiEnv security settings", () => {
  it("requires a separate IP hash salt outside local and test", () => {
    const { IP_HASH_SALT: _omit, ...withoutSalt } = production;
    expect(() => loadApiEnv(withoutSalt)).toThrow(/IP_HASH_SALT/);
    expect(loadApiEnv(production).ipHashSalt).toBe("prod-salt");
    expect(loadApiEnv({ DJL_ENV: "test" }).ipHashSalt).toBeTruthy();
  });

  it("uses the shared parent domain as the passkey relying party", () => {
    expect(loadApiEnv(production).passkeyRpId).toBe("slcor.com");
    expect(loadApiEnv({ ...production, PASSKEY_RP_ID: "staging.slcor.com" }).passkeyRpId).toBe(
      "staging.slcor.com",
    );
    expect(loadApiEnv({ DJL_ENV: "local" }).passkeyRpId).toBe("localhost");
  });

  it("accepts extra Google client ids and the iOS bundle id for native sign-in", () => {
    const env = loadApiEnv({
      ...production,
      GOOGLE_OAUTH_CLIENT_ID: "web.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "s",
      GOOGLE_ALLOWED_CLIENT_IDS: " ios.apps.googleusercontent.com , ",
      APPLE_OAUTH_CLIENT_ID: "app.djl.web",
      APPLE_OAUTH_CLIENT_SECRET: "s",
    });
    expect(env.google?.extraClientIds).toEqual(["ios.apps.googleusercontent.com"]);
    expect(env.apple?.appBundleIdentifier).toBe("app.djl.ios");
  });
});
