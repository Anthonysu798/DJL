import { createNativeAcpDriver } from "./acp";
import { NativeRpc, object } from "./protocol";

// https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server
// `copilot --acp --stdio` speaks ACP over stdio (public preview).
export const COPILOT_ACP_ARGS = ["--acp", "--stdio"] as const;

// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
// BYOK variables replace the user's GitHub Copilot subscription with another
// provider and model, so subscription sessions never inherit them. The GitHub
// token variables (COPILOT_GITHUB_TOKEN, GH_TOKEN, GITHUB_TOKEN) are a
// documented way to sign in to the subscription and stay.
export function copilotSubscriptionEnvironment(base: NodeJS.ProcessEnv = process.env) {
  const env = { ...base };
  for (const key of Object.keys(env)) if (key.startsWith("COPILOT_PROVIDER_")) delete env[key];
  delete env.COPILOT_PROVIDERS_CONFIG;
  delete env.COPILOT_MODEL;
  return env;
}

// Copilot's ACP has no documented cached-credential check before `session/new`;
// the runtime rejects the session itself when no GitHub login is stored.
export const createCopilotDriver = createNativeAcpDriver({
  label: "GitHub Copilot",
  source: "copilot.acp",
  command: (input) => ({
    command: input.providerOptions?.copilot?.binaryPath?.trim() || "copilot",
    args: COPILOT_ACP_ARGS,
    env: copilotSubscriptionEnvironment(),
  }),
  // The ACP docs do not list Copilot's mode ids, so plan turns use the advertised
  // plan mode and other turns return to the mode the session started in.
  modeId(session, turn) {
    const state = object(session.modes ?? {});
    const available = Array.isArray(state.availableModes) ? state.availableModes.map(object) : [];
    if (turn.interactionMode !== "plan")
      return typeof state.currentModeId === "string" ? state.currentModeId : undefined;
    const plan = available
      .map((mode) => mode.id)
      .find((id): id is string => typeof id === "string" && /(?:^|[#/])plan$/i.test(id));
    if (!plan) throw new Error("GitHub Copilot does not advertise plan mode.");
    return plan;
  },
});

export async function probeCopilotSubscriptionAccount(binary: string, cwd: string) {
  const rpc = new NativeRpc(binary, [...COPILOT_ACP_ARGS], cwd, copilotSubscriptionEnvironment());
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
