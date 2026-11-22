import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import { resolveActivityCodexConfig } from "./computerActivityProviderConfig";

const source = `
model_provider = "fixture.vendor"
model = "ignored-source-model"
developer_instructions = "UNTRUSTED_PERSONAL_INSTRUCTIONS"
notify = ["UNTRUSTED_NOTIFY"]
[mcp_servers.personal]
command = "UNTRUSTED_COMMAND"
[profiles.inactive]
model_provider = "not-selected"
[model_providers."fixture.vendor"]
name = "Fixture vendor"
base_url = "http://127.0.0.1:12345/custom/v1"
wire_api = "responses"
requires_openai_auth = false
env_key = "FIXTURE_API_KEY"
[model_providers."fixture.vendor".http_headers]
X-Fixture = "static-fixture-header"
[model_providers."fixture.vendor".env_http_headers]
X-Fixture-Account = "FIXTURE_ACCOUNT"
`;
const environment = {
  FIXTURE_API_KEY: "synthetic-private-key",
  FIXTURE_ACCOUNT: "synthetic-account",
  DJL_COMPUTER_USE_BRIDGE_TOKEN: "host-authority-must-stay-private",
  OTHER_PROVIDER_API_KEY: "unused-secret",
};
function resolve(config: string | undefined = source, env = environment) {
  return resolveActivityCodexConfig({
    source: config,
    environment: env,
    model: "selected-fixture-model",
  });
}
describe("isolated activity Codex configuration", () => {
  it("preserves only selected transport and credentials, with the DJL selected model", () => {
    const result = resolve();
    expect(result.provider).toBe("fixture.vendor");
    expect(parse(result.configuration)).toEqual({
      model_provider: "fixture.vendor",
      model: "selected-fixture-model",
      model_providers: {
        "fixture.vendor": {
          name: "Fixture vendor",
          base_url: "http://127.0.0.1:12345/custom/v1",
          wire_api: "responses",
          requires_openai_auth: false,
          env_key: "FIXTURE_API_KEY",
          http_headers: { "X-Fixture": "static-fixture-header" },
          env_http_headers: { "X-Fixture-Account": "FIXTURE_ACCOUNT" },
        },
      },
    });
    expect(result.credentialEnvironment).toEqual({
      FIXTURE_API_KEY: "synthetic-private-key",
      FIXTURE_ACCOUNT: "synthetic-account",
    });
    expect(JSON.stringify(result)).not.toContain("UNTRUSTED");
    expect(JSON.stringify(result)).not.toContain("unused-secret");
    expect(JSON.stringify(result)).not.toContain("host-authority");
  });
  it("permits an absent file without inventing a custom provider or credential", () => {
    const result = resolveActivityCodexConfig({ model: "selected-fixture-model", environment });
    expect(result.provider).toBe("openai");
    expect(result.credentialEnvironment).toEqual({});
    expect(parse(result.configuration)).toEqual({
      model_provider: "openai",
      model: "selected-fixture-model",
    });
  });
  it("keeps inactive legacy profile tables from selecting another provider", () => {
    expect(resolve().provider).toBe("fixture.vendor");
  });
  it.each([
    'model_provider = "missing"',
    'model_provider = ["invalid"]',
    'model_provider = "fixture"\n[model_providers',
    'profile = "work"\n[profiles.work]\nmodel_provider="fixture"',
    'cli_auth_credentials_store="keyring"',
    'forced_login_method="chatgpt"',
  ])("refuses unsupported or malformed configuration without provider fallback: %s", (config) => {
    expect(() => resolve(config)).toThrow("provider-unavailable");
  });
  it.each([
    'http_headers_helper = "UNTRUSTED_EXECUTABLE"',
    'wire_api = "chat"',
    "supports_websockets = true",
    'base_url = "file:///private/tmp/fixture"',
    'base_url = "https://user:password@example.com/v1"',
    'base_url = "https://example.com/v1?secret=fixture"',
  ])("rejects unsupported selected-provider transport: %s", (field) => {
    const config = `model_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\n${field}`;
    expect(() => resolve(config)).toThrow("provider-unavailable");
  });
  it.each([
    "DJL_COMPUTER_USE_BRIDGE_TOKEN",
    "DJL_WORK_TOKEN",
    "NODE_OPTIONS",
    "DYLD_INSERT_LIBRARIES",
    "PATH",
    "HOME",
    "BASH_ENV",
    "DJL_BROWSER_USE_PIPE_PATH",
    "CODEX_LOG_DIR",
    "OPENCODE_SERVER_PASSWORD",
    "RUST_LOG",
    "SSL_CERT_FILE",
  ])("never imports process authority through a credential named %s", (key) => {
    let read = false;
    const env = Object.defineProperty({}, key, {
      get() {
        read = true;
        return "private";
      },
    });
    const config = `model_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\nenv_key="${key}"`;
    expect(() => resolve(config, env as typeof environment)).toThrow("provider-unavailable");
    expect(read).toBe(false);
  });
  it("fails missing selected authentication rather than borrowing another provider's key", () => {
    expect(() => resolve(source, { ...environment, FIXTURE_API_KEY: "" })).toThrow(
      "authentication",
    );
  });
  it("permits a deliberately selected Codex API credential name without opening other runtime variables", () => {
    const result = resolveActivityCodexConfig({
      source:
        'model_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\nenv_key="CODEX_API_KEY"',
      model: "fixture-model",
      environment: { CODEX_API_KEY: "synthetic-codex-key" },
    });
    expect(result.credentialEnvironment).toEqual({ CODEX_API_KEY: "synthetic-codex-key" });
  });
  it("does not treat inherited object properties as selected credential variables", () => {
    const inherited = Object.assign(
      Object.create({ FIXTURE_API_KEY: "inherited-fixture-secret" }),
      { FIXTURE_ACCOUNT: "fixture-account" },
    );
    expect(() => resolve(source, inherited)).toThrow("authentication");
    expect(
      resolveActivityCodexConfig({
        model: "fixture-model",
        environment: Object.create({ OPENAI_API_KEY: "inherited-fixture-secret" }),
      }).credentialEnvironment,
    ).toEqual({});
  });
  it("preserves deliberate no-auth custom transport without requiring an unrelated key", () => {
    const result = resolve(
      'model_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\nbase_url="http://127.0.0.1:12345/v1"\nwire_api="responses"\nrequires_openai_auth=false',
    );
    expect(result.credentialEnvironment).toEqual({});
  });
  it("does not import an OpenAI environment key that the verified exec recipe ignores", () => {
    const result = resolveActivityCodexConfig({
      model: "fixture-model",
      environment: { OPENAI_API_KEY: "synthetic-openai-key", FIXTURE_API_KEY: "unused" },
    });
    expect(result.credentialEnvironment).toEqual({});
    expect(result.authentication).toBe("api");
  });
  it("marks an explicit env-key transport as independently authenticated", () => {
    expect(resolve().authentication).toBe("transport");
    expect(
      resolve(source.replace("requires_openai_auth = false", "requires_openai_auth = true"))
        .authentication,
    ).toBe("transport");
  });
  it("marks a required OpenAI-auth custom provider without env-key as API authenticated", () => {
    expect(
      resolveActivityCodexConfig({
        model: "fixture-model",
        environment: {},
        source: 'model_provider="fixture"\n[model_providers.fixture]\nrequires_openai_auth=true',
      }).authentication,
    ).toBe("api");
  });
  it.each(["synthetic-unrelated-key", "", undefined])(
    "rejects a selected reserved OpenAI override regardless of unrelated OpenAI key: %s",
    (openaiKey) => {
      expect(() =>
        resolveActivityCodexConfig({
          source:
            'model_provider="openai"\n[model_providers.openai]\nbase_url="http://127.0.0.1:12345/v1"\nwire_api="responses"\nrequires_openai_auth=false\nenv_key="FIXTURE_API_KEY"',
          model: "fixture-model",
          environment: {
            FIXTURE_API_KEY: "synthetic-selected-key",
            ...(openaiKey === undefined ? {} : { OPENAI_API_KEY: openaiKey }),
          },
        }),
      ).toThrow("provider-unavailable");
    },
  );
  it("rejects a selected reserved OpenAI override before reading environment values", () => {
    const reads: string[] = [];
    const env: Record<string, string | undefined> = {};
    for (const name of ["OPENAI_BASE_URL", "OPENAI_API_KEY", "FIXTURE_API_KEY"]) {
      Object.defineProperty(env, name, {
        get() {
          reads.push(name);
          throw new Error("environment value must not be read");
        },
      });
    }
    expect(() =>
      resolveActivityCodexConfig({
        source:
          'model_provider="openai"\n[model_providers.openai]\nrequires_openai_auth=false\nenv_key="FIXTURE_API_KEY"',
        model: "fixture-model",
        environment: env,
      }),
    ).toThrow("provider-unavailable");
    expect(reads).toEqual([]);
  });
  it("rejects unverified OpenAI endpoint environment overrides instead of silently dropping them", () => {
    expect(() =>
      resolveActivityCodexConfig({
        model: "fixture-model",
        environment: { OPENAI_BASE_URL: "https://unverified.example/v1" },
      }),
    ).toThrow("provider-unavailable");
  });
  it("preserves a validated builtin root endpoint and its path prefix", () => {
    const result = resolve('openai_base_url="http://127.0.0.1:12345/prefix/v1/"');
    expect(parse(result.configuration)).toEqual({
      model_provider: "openai",
      model: "selected-fixture-model",
      openai_base_url: "http://127.0.0.1:12345/prefix/v1/",
    });
  });
  it.each([
    " https://example.com/v1",
    "https://example.com/v1 ",
    "https://example.com/v1?",
    "https://example.com/v1#",
    "https://user:pass@example.com/v1",
    "https://example.com/\\tpath",
    "https://example.com\\\\path",
    "file:///tmp/fixture",
  ])("rejects ambiguous builtin root endpoint %s", (endpoint) => {
    expect(() => resolve(`openai_base_url=${JSON.stringify(endpoint)}`)).toThrow(
      "provider-unavailable",
    );
  });
  it("bounds source size and selected model before parsing or emitting configuration", () => {
    expect(() => resolve("#".repeat(1024 * 1024 + 1))).toThrow("provider-unavailable");
    expect(() => resolveActivityCodexConfig({ model: " ", environment: {} })).toThrow(
      "provider-unavailable",
    );
  });
});
