import { createNativeAcpDriver } from "./acp";
import { resolveGrokBinaryPath } from "../grokExecutable";
import { NativeRpc, object, type JsonObject } from "./protocol";

// https://docs.x.ai/build/cli/headless-scripting#acp
// Only explicit Accounts sign-in opens a browser. Discovery and conversations
// authenticate with the CLI's existing subscription, never a metered API fallback.
export async function authenticateGrokSubscription(rpc: NativeRpc, init: JsonObject) {
  const methods = Array.isArray(init.authMethods) ? init.authMethods.map(object) : [];
  if (!methods.some((method) => method.id === "cached_token"))
    throw new Error(
      "Sign in to Grok with the official Grok Build CLI before using this subscription.",
    );
  await rpc.request("authenticate", { methodId: "cached_token", _meta: { headless: true } });
}

export function grokSubscriptionEnvironment(base: NodeJS.ProcessEnv = process.env) {
  const env = { ...base };
  delete env.XAI_API_KEY;
  delete env.GROK_CODE_XAI_API_KEY;
  return env;
}

export async function probeGrokSubscriptionAccount(binary: string, cwd: string) {
  const rpc = new NativeRpc(
    binary,
    ["--no-auto-update", "agent", "stdio"],
    cwd,
    grokSubscriptionEnvironment(),
  );
  let initialized = false;
  try {
    const init = object(
      await rpc.request(
        "initialize",
        {
          protocolVersion: 1,
          clientInfo: { name: "djl_native", version: "1.0.0" },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        },
        10_000,
      ),
    );
    if (init.protocolVersion !== 1) return "incompatible" as const;
    initialized = true;
    await authenticateGrokSubscription(rpc, init);
    return "ready" as const;
  } catch (error) {
    if (
      initialized &&
      error instanceof Error &&
      /sign.?in|log.?in|auth|expired|credential/i.test(error.message)
    )
      return "required" as const;
    return "unknown" as const;
  } finally {
    rpc.close();
  }
}

export const createGrokDriver = createNativeAcpDriver({
  label: "Grok",
  source: "grok.acp",
  command: (input) => ({
    command: resolveGrokBinaryPath(input.providerOptions?.grok?.binaryPath),
    args: ["--no-auto-update", "agent", "stdio"],
    env: grokSubscriptionEnvironment(),
  }),
  authenticate: authenticateGrokSubscription,
  modeId(session, turn) {
    const modes = object(session.modes ?? {});
    const available = Array.isArray(modes.availableModes) ? modes.availableModes.map(object) : [];
    if (turn.interactionMode === "plan") {
      if (!available.some((mode) => mode.id === "plan"))
        throw new Error("This Grok runtime does not advertise Plan mode.");
      return "plan";
    }
    const normal = available.find((mode) => mode.id === "default" || mode.id === "agent");
    if (normal && typeof normal.id === "string") return normal.id;
    if (modes.currentModeId === "plan")
      throw new Error("This Grok runtime does not advertise an execution mode.");
    return typeof modes.currentModeId === "string" ? modes.currentModeId : undefined;
  },
});
