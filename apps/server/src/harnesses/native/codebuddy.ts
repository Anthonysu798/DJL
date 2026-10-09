import { createNativeAcpDriver } from "./acp";
import { NativeRpc, object } from "./protocol";

// https://www.codebuddy.ai/docs/cli/acp — `codebuddy --acp` speaks ACP on stdio.
// The CLI stores its own account login; these variables would replace it with
// an API key or a different endpoint, so sessions never inherit them.
export function codeBuddySubscriptionEnvironment(base: NodeJS.ProcessEnv = process.env) {
  const env: NodeJS.ProcessEnv = {
    ...base,
    DISABLE_AUTOUPDATER: "1",
    CODEBUDDY_DISABLE_IDE: "1",
  };
  for (const key of [
    "CODEBUDDY_API_KEY",
    "CODEBUDDY_AUTH_TOKEN",
    "CODEBUDDY_BASE_URL",
    "CODEBUDDY_INTERNET_ENVIRONMENT",
    "CODEBUDDY_INTERNET_ENVIROMENT",
    "CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT",
    "CODEBUDDY_MODEL",
    "CODEBUDDY_CUSTOM_HEADERS",
  ])
    delete env[key];
  return env;
}

// Never call ACP `authenticate`: on a signed-in CLI it logs the account out and
// starts a browser flow. `session/new` reports "Authentication required" instead.
export const createCodeBuddyDriver = createNativeAcpDriver({
  label: "CodeBuddy Code",
  source: "codebuddy.acp",
  command: (input) => ({
    command: input.providerOptions?.codebuddy?.binaryPath?.trim() || "codebuddy",
    args: ["--acp"],
    env: codeBuddySubscriptionEnvironment(),
  }),
  modeId(session, turn) {
    const state = object(session.modes ?? {});
    const available = Array.isArray(state.availableModes) ? state.availableModes.map(object) : [];
    const desired = turn.interactionMode === "plan" ? "plan" : "default";
    if (!available.some((mode) => mode.id === desired))
      throw new Error(`CodeBuddy Code does not advertise ${desired} mode.`);
    return desired;
  },
});

export async function probeCodeBuddySubscriptionAccount(binary: string, cwd: string) {
  const rpc = new NativeRpc(binary, ["--acp"], cwd, codeBuddySubscriptionEnvironment());
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
        15_000,
      ),
    );
    if (init.protocolVersion !== 1) return "incompatible" as const;
    initialized = true;
    await rpc.request("session/new", { cwd, mcpServers: [] }, 20_000);
    return "ready" as const;
  } catch (error) {
    return initialized &&
      error instanceof Error &&
      /auth|sign.?in|log.?in|credential/i.test(error.message)
      ? ("required" as const)
      : ("unknown" as const);
  } finally {
    rpc.close();
  }
}
