import { createNativeAcpDriver } from "./acp";
import { NativeRpc, object, type JsonObject } from "./protocol";

// The official iFlow CLI can replace its account login with an API key from
// the environment. Subscription sessions always use the CLI's stored login.
export function iflowSubscriptionEnvironment(base: NodeJS.ProcessEnv = process.env) {
  const env = { ...base };
  delete env.IFLOW_API_KEY;
  delete env.IFLOW_BASE_URL;
  return env;
}

// iFlow reports the stored login state at initialize. Its `authenticate`
// method starts a browser login, which only the explicit Accounts sign-in may do.
export async function authenticateIFlow(_rpc: NativeRpc, init: JsonObject) {
  if (init.isAuthenticated !== true)
    throw new Error("Sign in with the official iFlow CLI before using this subscription.");
}

export const createIFlowDriver = createNativeAcpDriver({
  label: "iFlow",
  source: "iflow.acp",
  command: (input) => ({
    command: input.providerOptions?.iflow?.binaryPath?.trim() || "iflow",
    args: ["--experimental-acp"],
    env: iflowSubscriptionEnvironment(),
  }),
  authenticate: authenticateIFlow,
  modeId(session, turn) {
    const state = object(session.modes ?? {});
    const available = Array.isArray(state.availableModes) ? state.availableModes.map(object) : [];
    const desired = turn.interactionMode === "plan" ? "plan" : "default";
    if (!available.some((mode) => mode.id === desired))
      throw new Error(`iFlow does not advertise ${desired} mode.`);
    return desired;
  },
});

export async function probeIFlowSubscriptionAccount(binary: string, cwd: string) {
  const rpc = new NativeRpc(binary, ["--experimental-acp"], cwd, iflowSubscriptionEnvironment());
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
    return init.isAuthenticated === true ? ("ready" as const) : ("required" as const);
  } catch {
    return "unknown" as const;
  } finally {
    rpc.close();
  }
}
