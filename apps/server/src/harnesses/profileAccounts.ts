import { access } from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";
import type {
  HarnessId,
  HarnessProfileAccount,
  HarnessProfileAccountInput,
  ServerSettings,
} from "@synara/contracts";
import { buildProfileTerminalLaunch } from "./terminalProfiles";
import { resolveCodexTerminalBinary } from "./codexTerminalBinary";
import { probe, type ProbeOutput, parseHarnessAccountStatus } from "./accounts";
import { NativeRpc } from "./native/protocol";
import { buildOpenCodeProcessInvocation } from "../provider/opencodeRuntime";

type Identity = Pick<HarnessProfileAccount, "status" | "email">;
const empty = (status: Identity["status"]): Identity => ({ status, email: null });
function email(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim();
  return address.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseProfileAccountOutput(provider: HarnessId, output: ProbeOutput): Identity {
  if (output.missing) return empty("unavailable");
  const status = parseHarnessAccountStatus(provider, output);
  if (status !== "ready") return empty(status === "required" ? "signedOut" : "unknown");
  // Only explicit identity fields/status lines are allowed out. Never return raw CLI output.
  let address: string | null = null;
  if (provider === "claudeAgent") {
    try {
      address = email(record(JSON.parse(output.stdout)).email);
    } catch {
      /* Status parser owns invalid JSON. */
    }
  } else if (provider === "cursor") {
    const text = stripVTControlCharacters(`${output.stdout}\n${output.stderr}`);
    address = email(text.match(/(?:logged in as|authenticated as)\s+([^\s<>]+@[^\s<>]+)/i)?.[1]);
  }
  return { status: "signedIn", email: address };
}

export async function readProfileAccount(
  input: HarnessProfileAccountInput,
  settings: ServerSettings,
  root: string,
): Promise<HarnessProfileAccount> {
  // Reuse the exact CLI/profile isolation used to launch this account's terminals.
  const launch = buildProfileTerminalLaunch(
    { ...input, action: "status" },
    settings,
    root,
    process.env,
    "account-status",
  );
  const result = (identity: Identity): HarnessProfileAccount => ({ ...input, ...identity });
  if (!settings.providers[input.provider].enabled) return result(empty("unavailable"));
  try {
    await access(launch.directory);
  } catch {
    return result(empty("signedOut"));
  }
  const env = { ...process.env, ...launch.env };
  for (const name of launch.command.removeEnv) delete env[name];
  if (input.provider === "codex") {
    let rpc: NativeRpc | undefined;
    try {
      const binary = await resolveCodexTerminalBinary(launch.command.executable, env);
      rpc = new NativeRpc(binary, [...launch.prefixArgs, "app-server"], launch.directory, env);
      await rpc.request(
        "initialize",
        { clientInfo: { name: "djl_account_status", title: "DJL", version: "1.0.0" } },
        8_000,
      );
      rpc.notify("initialized");
      const reply = record(await rpc.request("account/read", { refreshToken: false }, 8_000));
      if (reply.account === null) return result(empty("signedOut"));
      const account = record(reply.account);
      if (account.type === "chatgpt")
        return result({ status: "signedIn", email: email(account.email) });
      if (account.type === "apiKey") return result(empty("signedIn"));
      return result(empty("unknown"));
    } catch (error) {
      return result(
        empty((error as NodeJS.ErrnoException)?.code === "ENOENT" ? "unavailable" : "unknown"),
      );
    } finally {
      rpc?.close();
    }
  }
  try {
    const invocation =
      input.provider === "opencode"
        ? buildOpenCodeProcessInvocation(launch.command.executable, launch.command.args)
        : { command: launch.command.executable, args: launch.command.args };
    return result(
      parseProfileAccountOutput(
        input.provider,
        await probe(invocation.command, [...invocation.args], env),
      ),
    );
  } catch {
    return result(empty("unknown"));
  }
}
