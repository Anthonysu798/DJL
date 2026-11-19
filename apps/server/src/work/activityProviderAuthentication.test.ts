import { describe, expect, it } from "vitest";
import { resolveActivityCodexConfig } from "./computerActivityProviderConfig";
import { resolveActivityCodexAuthentication } from "./activityProviderAuthentication";

const apiConfig = resolveActivityCodexConfig({ environment: {}, model: "fixture-model" });
const signal = () => new AbortController().signal;
describe("static activity provider authentication", () => {
  it.each([
    { OPENAI_ORGANIZATION: "org-fixture" },
    { OPENAI_PROJECT: "proj-fixture" },
    { OPENAI_ORGANIZATION: "org-fixture", OPENAI_PROJECT: "proj-fixture" },
  ])(
    "extracts builtin own account scope independently of credential precedence",
    async (account) => {
      const result = await resolveActivityCodexAuthentication({
        configuration: apiConfig,
        environment: { CODEX_API_KEY: "synthetic", ...account },
        signal: signal(),
        readAuth: async () => {
          throw new Error("must not read");
        },
      });
      expect(result).toMatchObject({
        accountHeaders: Object.fromEntries(
          Object.entries(account).map(([name, value]) => [
            name === "OPENAI_PROJECT" ? "openai-project" : "openai-organization",
            value,
          ]),
        ),
      });
    },
  );
  it.each(["", "scope\nvalue", "scope\u0000value", "x".repeat(513)])(
    "rejects invalid builtin scope before auth read",
    async (value) => {
      await expect(
        resolveActivityCodexAuthentication({
          configuration: apiConfig,
          environment: { CODEX_API_KEY: "synthetic", OPENAI_PROJECT: value },
          signal: signal(),
          readAuth: async () => {
            throw new Error("must not read");
          },
        }),
      ).rejects.toMatchObject({ code: "authentication" });
    },
  );
  it("ignores inherited builtin account scope", async () => {
    const result = await resolveActivityCodexAuthentication({
      configuration: apiConfig,
      environment: Object.assign(Object.create({ OPENAI_PROJECT: "inherited" }), {
        CODEX_API_KEY: "synthetic",
      }),
      signal: signal(),
      readAuth: async () => undefined,
    });
    expect(result).toEqual({ environment: { CODEX_API_KEY: "synthetic" } });
  });
  it("preserves the selected transport without reading unrelated environment or auth", async () => {
    const configuration = resolveActivityCodexConfig({
      source:
        'model_provider="fixture"\n[model_providers.fixture]\nenv_key="FIXTURE_KEY"\nrequires_openai_auth=true',
      model: "fixture-model",
      environment: { FIXTURE_KEY: "synthetic-selected" },
    });
    const result = await resolveActivityCodexAuthentication({
      configuration,
      environment: new Proxy(
        {},
        {
          get() {
            throw new Error("unrelated env read");
          },
        },
      ),
      signal: signal(),
      readAuth: async () => {
        throw new Error("unrelated auth read");
      },
    });
    expect(result).toEqual({ environment: { FIXTURE_KEY: "synthetic-selected" } });
  });
  it("uses the verified exec key before considering a source file", async () => {
    const result = await resolveActivityCodexAuthentication({
      configuration: apiConfig,
      environment: { CODEX_API_KEY: "synthetic-exec-key" },
      signal: signal(),
      readAuth: async () => {
        throw new Error("must not read");
      },
    });
    expect(result).toEqual({ environment: { CODEX_API_KEY: "synthetic-exec-key" } });
  });
  it("selects only a static API key from the private source file", async () => {
    const result = await resolveActivityCodexAuthentication({
      configuration: apiConfig,
      environment: { OPENAI_API_KEY: "ignored-env-key" },
      signal: signal(),
      readAuth: async () =>
        JSON.stringify({
          auth_mode: "apikey",
          OPENAI_API_KEY: "synthetic-file-key",
          tokens: null,
          last_refresh: "2026-10-28T00:00:00Z",
        }),
    });
    expect(result).toEqual({
      environment: {},
      authFile: JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "synthetic-file-key" }),
    });
    expect(JSON.stringify(result)).not.toContain("ignored-env-key");
    expect(JSON.stringify(result)).not.toContain("last_refresh");
  });
  it("supports a legacy static file without an explicit auth mode", async () => {
    const result = await resolveActivityCodexAuthentication({
      configuration: apiConfig,
      environment: {},
      signal: signal(),
      readAuth: async () => '{"OPENAI_API_KEY":"synthetic-file-key"}',
    });
    expect(result.authFile).toContain('"auth_mode":"apikey"');
  });
  it.each([
    '{"auth_mode":"chatgpt","OPENAI_API_KEY":"misleading-static-key","tokens":{"refresh_token":"synthetic"}}',
    '{"OPENAI_API_KEY":"synthetic-key","tokens":{}}',
    '{"OPENAI_API_KEY":"synthetic-key","helper":"must not execute"}',
  ])("refuses unsupported refresh/helper auth rather than copying it: %s", async (auth) => {
    await expect(
      resolveActivityCodexAuthentication({
        configuration: apiConfig,
        environment: {},
        signal: signal(),
        readAuth: async () => auth,
      }),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
  });
  it.each([
    undefined,
    "{",
    "null",
    "[]",
    "{}",
    '{"OPENAI_API_KEY":""}',
    '{"OPENAI_API_KEY":42}',
    "a".repeat(65_537),
  ])("fails absent, malformed or oversized static authentication", async (auth) => {
    await expect(
      resolveActivityCodexAuthentication({
        configuration: apiConfig,
        environment: {},
        signal: signal(),
        readAuth: async () => auth,
      }),
    ).rejects.toMatchObject({ code: "authentication" });
  });
  it.each(["", "key\nheader", "key\u0000value", " ", "x".repeat(65_537)])(
    "refuses an invalid selected exec key without falling back: %s",
    async (key) => {
      await expect(
        resolveActivityCodexAuthentication({
          configuration: apiConfig,
          environment: { CODEX_API_KEY: key },
          signal: signal(),
          readAuth: async () => '{"OPENAI_API_KEY":"other-key"}',
        }),
      ).rejects.toMatchObject({ code: "authentication" });
    },
  );
  it("ignores inherited environment properties", async () => {
    await expect(
      resolveActivityCodexAuthentication({
        configuration: apiConfig,
        environment: Object.create({ CODEX_API_KEY: "inherited-key" }),
        signal: signal(),
        readAuth: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "authentication" });
  });
  it("checks cancellation before and after reading a source", async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      resolveActivityCodexAuthentication({
        configuration: apiConfig,
        environment: {},
        signal: c.signal,
        readAuth: async () => {
          throw new Error("must not read");
        },
      }),
    ).rejects.toMatchObject({ code: "generation-failed" });
    const after = new AbortController();
    await expect(
      resolveActivityCodexAuthentication({
        configuration: apiConfig,
        environment: {},
        signal: after.signal,
        readAuth: async () => {
          after.abort();
          return '{"OPENAI_API_KEY":"synthetic"}';
        },
      }),
    ).rejects.toMatchObject({ code: "generation-failed" });
  });
  it("invokes the auth reader without a credential-bearing receiver and hides its error", async () => {
    let called = false;
    await expect(
      resolveActivityCodexAuthentication({
        configuration: apiConfig,
        environment: {},
        signal: signal(),
        readAuth: async function (this: unknown) {
          expect(this).toBeUndefined();
          called = true;
          throw new Error("private-file-path");
        },
      }),
    ).rejects.toMatchObject({ message: "authentication" });
    expect(called).toBe(true);
  });
});
