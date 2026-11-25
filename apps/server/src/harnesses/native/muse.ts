import { createNativeAcpDriver } from "./acp";
import { NativeRpc, object } from "./protocol";

// META_API_KEY takes priority over the Muse account login, so a stray key would bill the
// API instead of the user's subscription. Subscription sessions use only the CLI's login.
export function museSubscriptionEnvironment(base: NodeJS.ProcessEnv = process.env) {
  const env = { ...base };
  delete env.META_API_KEY;
  return env;
}

// Muse Code serves ACP v1 from `muse acp`; its own sandbox and approval modes stay in force.
export const createMuseDriver = createNativeAcpDriver({
  label: "Muse Code",
  source: "muse.acp",
  defaultModelSlug: "default",
  command: (input) => ({
    command: input.providerOptions?.muse?.binaryPath?.trim() || "muse",
    args: ["acp"],
    env: museSubscriptionEnvironment(),
  }),
  modeId(session, turn) {
    const state = object(session.modes ?? {});
    const available = Array.isArray(state.availableModes) ? state.availableModes.map(object) : [];
    if (turn.interactionMode === "plan") {
      if (!available.some((mode) => mode.id === "plan"))
        throw new Error("Muse Code does not advertise plan mode.");
      return "plan";
    }
    // Keep Muse's current mode for normal turns; it names its modes itself.
    return undefined;
  },
});

// `muse acp` refuses `session/new` with "log in to Muse before opening a session" when the
// CLI has no account login, which is exactly the signed-out signal.
export async function probeMuseSubscriptionAccount(binary: string, cwd: string) {
  const rpc = new NativeRpc(binary, ["acp"], cwd, museSubscriptionEnvironment());
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
