import { Schema } from "effect";
import { parse, stringify } from "smol-toml";
import { ComputerActivityGenerationError } from "./computerActivitySummarization";

const unavailable = () => new ComputerActivityGenerationError("provider-unavailable");
const headerName = Schema.String.check(Schema.isPattern(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/));
const headerValue = Schema.String.check(
  Schema.isMaxLength(65_536),
  Schema.isPattern(/^[\t\x20-\x7e]*$/),
);
const envName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
  Schema.isMaxLength(256),
);
const retries = Schema.Number.check(
  Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0 && n <= 8),
);
const idleTimeout = Schema.Number.check(
  Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 1 && n <= 180_000),
);
const endpoint = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      return (
        value.length <= 8192 &&
        !/[\s\\?#]/.test(value) &&
        !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
        ["http:", "https:"].includes(url.protocol) &&
        !!url.hostname &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }),
);
const Transport = Schema.Struct({
  name: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(512))),
  base_url: Schema.optionalKey(endpoint),
  wire_api: Schema.optionalKey(Schema.Literal("responses")),
  env_key: Schema.optionalKey(envName),
  http_headers: Schema.optionalKey(Schema.Record(headerName, headerValue)),
  env_http_headers: Schema.optionalKey(Schema.Record(headerName, envName)),
  requires_openai_auth: Schema.optionalKey(Schema.Boolean),
  supports_websockets: Schema.optionalKey(Schema.Literal(false)),
  request_max_retries: Schema.optionalKey(retries),
  stream_max_retries: Schema.optionalKey(retries),
  stream_idle_timeout_ms: Schema.optionalKey(idleTimeout),
});
function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
  );
}
const authorityNames = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SHELL",
  "BASH_ENV",
  "ENV",
  "ZDOTDIR",
  "PROMPT_COMMAND",
  "TMP",
  "TEMP",
  "TMPDIR",
  "CODEX_HOME",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_CONFIG_CONTENT",
  "DJL_BROWSER_USE_PIPE_PATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "ELECTRON_RUN_AS_NODE",
  "OPENAI_BASE_URL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "SSLKEYLOGFILE",
  "LANG",
  "LANGUAGE",
  "TERM",
  "TERMINFO",
  "TERMINFO_DIRS",
]);
export function permittedActivityCredentialName(name: string): boolean {
  const upper = name.toUpperCase();
  if (upper === "CODEX_API_KEY") return true;
  return (
    !authorityNames.has(upper) &&
    !/^(DJL_COMPUTER_USE_BRIDGE_|DJL_WORK_|NODE_|BUN_|DYLD_|LD_|XDG_|CODEX_|OPENCODE_|RUST_|LC_)/.test(
      upper,
    ) &&
    !/(?:_SOCKET|_SOCKET_PATH|_PIPE_PATH)$/.test(upper)
  );
}

// Extracts data only. This does not authorize authentication or launch a provider:
// the runner still has to verify static auth, runtime identity and its no-tools recipe.
// configuration/credentialEnvironment may contain selected secrets; never log them.
export function resolveActivityCodexConfig(input: {
  readonly source?: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly model: string;
}): Readonly<{
  provider: string;
  configuration: string;
  credentialEnvironment: Readonly<Record<string, string>>;
  sourceCredentialStore: "auto" | "file";
  authentication: "api" | "transport";
}> {
  if (!input.model.trim() || input.model.length > 256 || /[\x00-\x1f\x7f]/.test(input.model))
    throw unavailable();
  let root: Record<string, unknown>;
  try {
    if (input.source !== undefined && Buffer.byteLength(input.source) > 1024 * 1024)
      throw unavailable();
    root = input.source === undefined ? {} : parse(input.source);
  } catch {
    throw unavailable();
  }
  if (
    Object.hasOwn(root, "profile") ||
    (root.forced_login_method !== undefined && root.forced_login_method !== "api")
  )
    throw unavailable();
  const store = root.cli_auth_credentials_store ?? "auto";
  if (store !== "auto" && store !== "file") throw unavailable();
  const provider = root.model_provider ?? "openai";
  if (typeof provider !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(provider))
    throw unavailable();
  if (root.model_providers !== undefined && !object(root.model_providers)) throw unavailable();
  const tables = root.model_providers ?? {};
  const selected = Object.hasOwn(tables, provider)
    ? (tables as Record<string, unknown>)[provider]
    : undefined;
  if (provider === "openai" && selected !== undefined) throw unavailable();
  if (selected === undefined && provider !== "openai") throw unavailable();
  let transport: typeof Transport.Type | undefined;
  try {
    if (selected !== undefined)
      transport = Schema.decodeUnknownSync(Transport)(selected, { onExcessProperty: "error" });
  } catch {
    throw unavailable();
  }
  if (
    (provider === "openai" || transport?.requires_openai_auth === true) &&
    ((provider !== "openai" && Object.hasOwn(root, "openai_base_url")) ||
      Object.hasOwn(root, "chatgpt_base_url") ||
      input.environment.OPENAI_BASE_URL !== undefined)
  )
    throw unavailable();
  let builtinEndpoint: string | undefined;
  if (provider === "openai" && Object.hasOwn(root, "openai_base_url")) {
    try {
      builtinEndpoint = Schema.decodeUnknownSync(endpoint)(root.openai_base_url);
    } catch {
      throw unavailable();
    }
  }

  const names = new Set<string>(Object.values(transport?.env_http_headers ?? {}));
  if (transport?.env_key) names.add(transport.env_key);
  const environment: Record<string, string> = {};
  let credentialBytes = 0;
  for (const name of names) {
    if (!permittedActivityCredentialName(name)) throw unavailable();
    if (!Object.hasOwn(input.environment, name))
      throw new ComputerActivityGenerationError("authentication");
    const value = input.environment[name];
    if (typeof value !== "string" || !value.trim() || /[\r\n\x00]/.test(value))
      throw new ComputerActivityGenerationError("authentication");
    credentialBytes += Buffer.byteLength(name) + Buffer.byteLength(value);
    if (credentialBytes > 65_536) throw new ComputerActivityGenerationError("authentication");
    Object.defineProperty(environment, name, { value, enumerable: true });
  }
  const configuration = stringify({
    model_provider: provider,
    model: input.model,
    ...(builtinEndpoint !== undefined ? { openai_base_url: builtinEndpoint } : {}),
    ...(transport ? { model_providers: { [provider]: transport } } : {}),
  });
  return Object.freeze({
    provider,
    configuration,
    credentialEnvironment: Object.freeze(environment),
    sourceCredentialStore: store,
    authentication:
      !transport?.env_key && (provider === "openai" || transport?.requires_openai_auth === true)
        ? "api"
        : "transport",
  });
}
