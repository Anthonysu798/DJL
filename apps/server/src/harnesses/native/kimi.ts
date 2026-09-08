import type { ServerSettings } from "@synara/contracts";
import { createNativeAcpDriver } from "./acp";
import { NativeRpc, object } from "./protocol";
import { resolveKimiBinaryPath } from "../kimiExecutable";

export function kimiSubscriptionEnvironment(
  base: NodeJS.ProcessEnv = process.env,
  region: ServerSettings["providers"]["kimi"]["region"] = "existing",
) {
  const env: NodeJS.ProcessEnv = { ...base, KIMI_CODE_NO_AUTO_UPDATE: "1" };
  // The official CLI lets these replace the managed subscription in memory.
  // Subscription sessions select managed models from the advertised catalog.
  delete env.KIMI_MODEL_NAME;
  delete env.KIMI_MODEL_API_KEY;
  delete env.KIMI_MODEL_BASE_URL;
  if (region !== "existing") {
    const domain = region === "global" ? "kimi.ai" : "kimi.com";
    env.KIMI_CODE_OAUTH_HOST = `https://auth.${domain}`;
    env.KIMI_CODE_BASE_URL = `https://api.${domain}/coding/v1`;
  }
  return env;
}

async function authenticateKimi(rpc: NativeRpc, init: Record<string, unknown>) {
  const methods = Array.isArray(init.authMethods) ? init.authMethods.map(object) : [];
  if (!methods.some((method) => method.id === "login"))
    throw new Error("Sign in with the current official Kimi Code CLI.");
  await rpc.request("authenticate", { methodId: "login" }, 10_000);
}

// Official Node-based Kimi Code CLI: authenticate validates existing credentials;
// the separate `kimi login` command owns the interactive device-code flow.
export const createKimiDriver = createNativeAcpDriver({
  label: "Kimi Code",
  source: "kimi.acp",
  command: (input) => ({
    command: resolveKimiBinaryPath(input.providerOptions?.kimi?.binaryPath),
    args: ["acp"],
    env: kimiSubscriptionEnvironment(process.env, input.providerOptions?.kimi?.region),
  }),
  authenticate: authenticateKimi,
  modelFilter: (id) => id.startsWith("kimi-code/"),
  modeId(session, turn) {
    const state = object(session.modes ?? {});
    const available = Array.isArray(state.availableModes) ? state.availableModes.map(object) : [];
    const desired = turn.interactionMode === "plan" ? "plan" : "default";
    if (!available.some((mode) => mode.id === desired))
      throw new Error(`Kimi Code does not advertise ${desired} mode.`);
    return desired;
  },
});

export async function probeKimiSubscriptionAccount(
  binary: string,
  cwd: string,
  region?: ServerSettings["providers"]["kimi"]["region"],
) {
  const rpc = new NativeRpc(binary, ["acp"], cwd, kimiSubscriptionEnvironment(process.env, region));
  try {
    const init = object(
      await rpc.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        },
        10_000,
      ),
    );
    if (init.protocolVersion !== 1) return "incompatible" as const;
    await authenticateKimi(rpc, init);
    return "ready" as const;
  } catch (error) {
    return error instanceof Error &&
      /auth|sign.?in|log.?in|credential|subscription model/i.test(error.message)
      ? ("required" as const)
      : ("unknown" as const);
  } finally {
    rpc.close();
  }
}
