import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { resolveActivityCodexConfig } from "./computerActivityProviderConfig";
import { buildActivityCodexEnvironment } from "./activityProviderEnvironment";

const workspace = Object.fromEntries(
  ["home", "codexHome", "config", "data", "cache", "state", "temp"].map((name) => [
    name,
    `/private/tmp/owned-fixture/${name}`,
  ]),
) as Record<"home" | "codexHome" | "config" | "data" | "cache" | "state" | "temp", string>;
function selected(name = "FIXTURE_KEY") {
  return resolveActivityCodexConfig({
    model: "gpt-6.1-sol",
    environment: { [name]: "synthetic-selected-key", FIXTURE_ACCOUNT: "synthetic-account" },
    source: `model_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\nbase_url="http://127.0.0.1:12345/v1"\nwire_api="responses"\nrequires_openai_auth=false\nenv_key="${name}"\n[model_providers.fixture.env_http_headers]\nX-Account="FIXTURE_ACCOUNT"`,
  });
}
function build(configuration = selected(), transportEnvironment: Record<string, string> = {}) {
  return buildActivityCodexEnvironment({
    configuration,
    authentication: { environment: configuration.credentialEnvironment },
    workspace,
    transportEnvironment,
  });
}
function parsed(configuration: string) {
  return parse(configuration) as {
    model: string;
    model_providers: {
      fixture: { env_key: string; env_http_headers: { "X-Account": string }; base_url: string };
    };
  };
}
describe("isolated activity provider environment", () => {
  it("rewrites selected key/header references to private names with identical values", () => {
    const result = build();
    const config = parsed(result.configuration);
    expect(result.environment[config.model_providers.fixture.env_key]).toBe(
      "synthetic-selected-key",
    );
    expect(result.environment[config.model_providers.fixture.env_http_headers["X-Account"]]).toBe(
      "synthetic-account",
    );
    expect(config.model_providers.fixture.base_url).toBe("http://127.0.0.1:12345/v1");
    expect(config.model).toBe("gpt-6.1-sol");
    expect(result.environment).not.toHaveProperty("FIXTURE_KEY");
    expect(result.environment).not.toHaveProperty("FIXTURE_ACCOUNT");
    expect(JSON.stringify(config)).not.toContain("synthetic-selected-key");
  });
  it("does not activate ambient runtime behavior through a selected credential name", () => {
    const result = build(selected("GIT_SSH_COMMAND"));
    expect(result.environment).not.toHaveProperty("GIT_SSH_COMMAND");
    const config = parsed(result.configuration);
    expect(result.environment[config.model_providers.fixture.env_key]).toBe(
      "synthetic-selected-key",
    );
  });
  it("uses fixed private homes, paths and locale instead of inherited authority", () => {
    const result = build(selected(), {
      HOME: "/personal",
      PATH: "/untrusted",
      CODEX_HOME: "/personal-codex",
      NODE_OPTIONS: "--require bad",
      DYLD_INSERT_LIBRARIES: "/bad",
      DJL_WORK_TOKEN: "host-secret",
      SSH_AUTH_SOCK: "/personal-socket",
      OTHER_API_KEY: "other-secret",
    });
    expect(result.environment.HOME).toBe(workspace.home);
    expect(result.environment.CODEX_HOME).toBe(workspace.codexHome);
    expect(result.environment.PATH).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
    expect(result.environment.XDG_CONFIG_HOME).toBe(workspace.config);
    expect(result.environment.XDG_DATA_HOME).toBe(workspace.data);
    expect(result.environment.XDG_CACHE_HOME).toBe(workspace.cache);
    expect(result.environment.XDG_STATE_HOME).toBe(workspace.state);
    expect(result.environment.TMPDIR).toBe(workspace.temp);
    for (const name of [
      "NODE_OPTIONS",
      "DYLD_INSERT_LIBRARIES",
      "DJL_WORK_TOKEN",
      "SSH_AUTH_SOCK",
      "OTHER_API_KEY",
    ])
      expect(result.environment).not.toHaveProperty(name);
    expect(JSON.stringify(result)).not.toContain("host-secret");
  });
  it("preserves only deliberate proxy and certificate transport values", () => {
    const result = build(selected(), {
      HTTPS_PROXY: "http://fixture:synthetic@127.0.0.1:1234",
      NO_PROXY: "localhost,127.0.0.1",
      SSL_CERT_FILE: "/private/tmp/fixture-ca.pem",
      OTHER_API_KEY: "must-not-copy",
    });
    expect(result.environment.HTTPS_PROXY).toBe("http://fixture:synthetic@127.0.0.1:1234");
    expect(result.environment.NO_PROXY).toBe("localhost,127.0.0.1");
    expect(result.environment.SSL_CERT_FILE).toBe("/private/tmp/fixture-ca.pem");
    expect(result.environment).not.toHaveProperty("OTHER_API_KEY");
  });
  it.each([
    { HTTPS_PROXY: "file:///private/fixture" },
    { HTTP_PROXY: "http://example.test\nheader" },
    { SSL_CERT_FILE: "relative-certificate" },
    { NO_PROXY: "x".repeat(8193) },
  ])("refuses invalid transport values", (transport) => {
    expect(() => build(selected(), transport)).toThrow("provider-unavailable");
  });
  it("keeps the API exec credential only for the API-auth path", () => {
    const configuration = resolveActivityCodexConfig({ model: "gpt-6.1-sol", environment: {} });
    const result = buildActivityCodexEnvironment({
      configuration,
      authentication: { environment: { CODEX_API_KEY: "synthetic-api-key" } },
      workspace,
      transportEnvironment: {},
    });
    expect(result.environment.CODEX_API_KEY).toBe("synthetic-api-key");
    expect(() =>
      buildActivityCodexEnvironment({
        configuration: selected(),
        authentication: {
          environment: { ...selected().credentialEnvironment, CODEX_API_KEY: "unselected" },
        },
        workspace,
        transportEnvironment: {},
      }),
    ).toThrow("provider-unavailable");
  });
  it("aliases an explicit CODEX_API_KEY transport without enabling unrelated exec auth", () => {
    const result = build(selected("CODEX_API_KEY"));
    expect(result.environment).not.toHaveProperty("CODEX_API_KEY");
    const config = parsed(result.configuration);
    expect(result.environment[config.model_providers.fixture.env_key]).toBe(
      "synthetic-selected-key",
    );
  });
  it("retains required API exec auth when the same source key is also a selected header", () => {
    const configuration = resolveActivityCodexConfig({
      model: "gpt-6.1-sol",
      environment: { CODEX_API_KEY: "synthetic-api-key" },
      source:
        'model_provider="fixture"\n[model_providers.fixture]\nrequires_openai_auth=true\n[model_providers.fixture.env_http_headers]\nX-Account="CODEX_API_KEY"',
    });
    const result = buildActivityCodexEnvironment({
      configuration,
      authentication: { environment: configuration.credentialEnvironment },
      workspace,
      transportEnvironment: {},
    });
    expect(result.environment.CODEX_API_KEY).toBe("synthetic-api-key");
    expect(
      result.environment[
        parsed(result.configuration).model_providers.fixture.env_http_headers["X-Account"]
      ],
    ).toBe("synthetic-api-key");
  });
  it("rejects forged credential authority even after authentication material merging", () => {
    const configuration = selected();
    for (const name of ["DJL_WORK_TOKEN", "NODE_OPTIONS", "HOME"]) {
      expect(() =>
        buildActivityCodexEnvironment({
          configuration: { ...configuration, credentialEnvironment: { [name]: "forged" } },
          authentication: { environment: { [name]: "forged" } },
          workspace,
          transportEnvironment: {},
        }),
      ).toThrow("provider-unavailable");
    }
    expect(() =>
      buildActivityCodexEnvironment({
        configuration,
        authentication: {
          environment: { ...configuration.credentialEnvironment, FIXTURE_KEY: "changed-key" },
        },
        workspace,
        transportEnvironment: {},
      }),
    ).toThrow("provider-unavailable");
  });
  it("rejects a private-directory override that is not absolute", () => {
    expect(() =>
      buildActivityCodexEnvironment({
        configuration: selected(),
        authentication: { environment: selected().credentialEnvironment },
        workspace: { ...workspace, home: "relative" },
        transportEnvironment: {},
      }),
    ).toThrow("provider-unavailable");
  });
});
