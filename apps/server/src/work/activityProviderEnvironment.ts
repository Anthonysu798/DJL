import path from "node:path";
import { parse, stringify } from "smol-toml";
import {
  permittedActivityCredentialName,
  type resolveActivityCodexConfig,
} from "./computerActivityProviderConfig";
import { ComputerActivityGenerationError } from "./computerActivitySummarization";

const unavailable = () => new ComputerActivityGenerationError("provider-unavailable");
const proxies = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
] as const;
const certificates = ["SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"] as const;
const privateNames = ["home", "codexHome", "config", "data", "cache", "state", "temp"] as const;
const valueIsBounded = (value: unknown): value is string =>
  typeof value === "string" &&
  Buffer.byteLength(value) <= 8192 &&
  !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

// No original credential name is imported into the child. This prevents a
// selected env_key from accidentally becoming interpreter/git/runtime authority.
export function buildActivityCodexEnvironment(input: {
  readonly configuration: ReturnType<typeof resolveActivityCodexConfig>;
  readonly authentication: Readonly<{ environment: Readonly<Record<string, string>> }>;
  readonly workspace: Readonly<Record<(typeof privateNames)[number], string>>;
  readonly transportEnvironment: Readonly<Record<string, string | undefined>>;
}): Readonly<{ configuration: string; environment: Readonly<Record<string, string>> }> {
  try {
    for (const name of privateNames) {
      if (!valueIsBounded(input.workspace[name]) || !path.isAbsolute(input.workspace[name]))
        throw unavailable();
    }
    const environment: Record<string, string> = {
      HOME: input.workspace.home,
      CODEX_HOME: input.workspace.codexHome,
      XDG_CONFIG_HOME: input.workspace.config,
      XDG_DATA_HOME: input.workspace.data,
      XDG_CACHE_HOME: input.workspace.cache,
      XDG_STATE_HOME: input.workspace.state,
      TMPDIR: input.workspace.temp,
      TMP: input.workspace.temp,
      TEMP: input.workspace.temp,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "en_US.UTF-8",
      TERM: "dumb",
    };
    for (const name of [...proxies, "NO_PROXY", "no_proxy", ...certificates]) {
      if (!Object.hasOwn(input.transportEnvironment, name)) continue;
      const value = input.transportEnvironment[name];
      if (value === undefined || value === "") continue;
      if (!valueIsBounded(value)) throw unavailable();
      if (certificates.some((item) => item === name)) {
        if (!path.isAbsolute(value)) throw unavailable();
      } else if (proxies.some((item) => item === name)) {
        const proxy = new URL(value);
        if (
          !["http:", "https:", "socks5:", "socks5h:"].includes(proxy.protocol) ||
          !proxy.hostname ||
          proxy.hash
        )
          throw unavailable();
      }
      environment[name] = value;
    }
    const aliases = new Map<string, string>();
    for (const name of Object.keys(input.configuration.credentialEnvironment).toSorted()) {
      if (!permittedActivityCredentialName(name)) throw unavailable();
      const value = input.configuration.credentialEnvironment[name];
      if (
        !Object.hasOwn(input.authentication.environment, name) ||
        input.authentication.environment[name] !== value
      )
        throw unavailable();
      const alias = `DJL_ACTIVITY_SECRET_${aliases.size}`;
      aliases.set(name, alias);
      environment[alias] = value!;
    }
    for (const name of Object.keys(input.authentication.environment)) {
      if (aliases.has(name)) continue;
      if (name !== "CODEX_API_KEY" || input.configuration.authentication !== "api")
        throw unavailable();
    }
    if (
      input.configuration.authentication === "api" &&
      Object.hasOwn(input.authentication.environment, "CODEX_API_KEY")
    )
      environment.CODEX_API_KEY = input.authentication.environment.CODEX_API_KEY!;
    const config = parse(input.configuration.configuration);
    const tables = config.model_providers as Record<string, Record<string, unknown>> | undefined;
    const transport = tables?.[input.configuration.provider];
    const aliasFor = (name: unknown) => {
      if (typeof name !== "string" || !aliases.has(name)) throw unavailable();
      return aliases.get(name)!;
    };
    if (transport?.env_key !== undefined) transport.env_key = aliasFor(transport.env_key);
    if (transport?.env_http_headers !== undefined) {
      const headers = transport.env_http_headers as Record<string, unknown>;
      for (const key of Object.keys(headers)) headers[key] = aliasFor(headers[key]);
    }
    // Final authority check after all merges, including future changes here.
    const fixed = new Set([
      "HOME",
      "CODEX_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "XDG_STATE_HOME",
      "TMPDIR",
      "TMP",
      "TEMP",
      "PATH",
      "LANG",
      "TERM",
      "CODEX_API_KEY",
      ...proxies,
      "NO_PROXY",
      "no_proxy",
      ...certificates,
    ]);
    if (
      Object.keys(environment).some(
        (name) => !fixed.has(name) && !/^DJL_ACTIVITY_SECRET_[0-9]+$/.test(name),
      )
    )
      throw unavailable();
    return Object.freeze({
      configuration: stringify(config),
      environment: Object.freeze(environment),
    });
  } catch {
    throw unavailable();
  }
}
