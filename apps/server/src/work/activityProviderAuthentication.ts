import type { resolveActivityCodexConfig } from "./computerActivityProviderConfig";
import { ComputerActivityGenerationError } from "./computerActivitySummarization";

const authentication = () => new ComputerActivityGenerationError("authentication");
const unavailable = () => new ComputerActivityGenerationError("provider-unavailable");
function apiKey(value: unknown): string {
  if (typeof value !== "string" || value.length > 65_536 || !/^[\x21-\x7e]+$/.test(value))
    throw authentication();
  return value;
}

// Returns private invocation material only. The caller must bound the source-file
// read before allocating it, and write authFile only inside the owned 0700 root.
// OAuth/keyring/helpers require a different refresh-safe implementation.
export async function resolveActivityCodexAuthentication(input: {
  readonly configuration: ReturnType<typeof resolveActivityCodexConfig>;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly readAuth: () => Promise<string | undefined>;
  readonly signal: AbortSignal;
}): Promise<
  Readonly<{
    environment: Readonly<Record<string, string>>;
    authFile?: string;
    accountHeaders?: Readonly<Record<string, string>>;
  }>
> {
  const check = () => {
    if (input.signal.aborted) throw new ComputerActivityGenerationError("generation-failed");
  };
  check();
  const environment = { ...input.configuration.credentialEnvironment };
  if (input.configuration.authentication === "transport")
    return Object.freeze({ environment: Object.freeze(environment) });

  const account: Record<string, string> = {};
  if (input.configuration.provider === "openai") {
    for (const [name, header] of [
      ["OPENAI_ORGANIZATION", "openai-organization"],
      ["OPENAI_PROJECT", "openai-project"],
    ] as const) {
      if (!Object.hasOwn(input.environment, name) || input.environment[name] === undefined)
        continue;
      const value = input.environment[name];
      if (typeof value !== "string" || value.length > 512 || !/^[\x21-\x7e]+$/.test(value))
        throw authentication();
      account[header] = value;
    }
  }
  const scope = Object.keys(account).length ? { accountHeaders: Object.freeze(account) } : {};

  // The verified exec recipe uses CODEX_API_KEY. OPENAI_API_KEY is not an
  // implicit exec credential; an explicit transport env_key still works.
  const execKey = Object.hasOwn(input.environment, "CODEX_API_KEY")
    ? input.environment.CODEX_API_KEY
    : undefined;
  if (execKey !== undefined) {
    environment.CODEX_API_KEY = apiKey(execKey);
    check();
    return Object.freeze({ environment: Object.freeze(environment), ...scope });
  }
  let source: string | undefined;
  try {
    const readAuth = input.readAuth;
    source = await readAuth();
  } catch (error) {
    check();
    throw error instanceof ComputerActivityGenerationError ? error : authentication();
  }
  check();
  let value: unknown;
  try {
    if (source === undefined || Buffer.byteLength(source) > 65_536) throw authentication();
    value = JSON.parse(source);
  } catch {
    throw authentication();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw authentication();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !["auth_mode", "OPENAI_API_KEY", "tokens", "last_refresh"].includes(key),
    ) ||
    (record.auth_mode !== undefined && record.auth_mode !== "apikey") ||
    (record.tokens !== undefined && record.tokens !== null) ||
    (record.last_refresh !== undefined &&
      record.last_refresh !== null &&
      typeof record.last_refresh !== "string")
  )
    throw unavailable();
  const key = apiKey(record.OPENAI_API_KEY);
  check();
  return Object.freeze({
    environment: Object.freeze(environment),
    authFile: JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: key }),
    ...scope,
  });
}
