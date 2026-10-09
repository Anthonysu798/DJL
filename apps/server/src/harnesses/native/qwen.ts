import { createNativeAcpDriver } from "./acp";
import { NativeRpc, object } from "./protocol";

// Qwen Code lets environment variables replace the credentials and model that
// the CLI has stored. Subscription sessions use only what the CLI itself holds.
export function qwenSubscriptionEnvironment(base: NodeJS.ProcessEnv = process.env) {
  const env = { ...base };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_BASE_URL;
  delete env.OPENAI_MODEL;
  delete env.QWEN_MODEL;
  delete env.QWEN_DEFAULT_AUTH_TYPE;
  return env;
}

// Qwen Code's ACP has no cached-credential check before `session/new`; the
// runtime rejects the session itself when the CLI has not been set up.
export const createQwenDriver = createNativeAcpDriver({
  label: "Qwen Code",
  source: "qwen.acp",
  command: (input) => ({
    command: input.providerOptions?.qwen?.binaryPath?.trim() || "qwen",
    args: ["--acp"],
    env: qwenSubscriptionEnvironment(),
  }),
  modeId(session, turn) {
    const state = object(session.modes ?? {});
    const available = Array.isArray(state.availableModes) ? state.availableModes.map(object) : [];
    const desired = turn.interactionMode === "plan" ? "plan" : "default";
    if (!available.some((mode) => mode.id === desired))
      throw new Error(`Qwen Code does not advertise ${desired} mode.`);
    return desired;
  },
});

export async function probeQwenSubscriptionAccount(binary: string, cwd: string) {
  const rpc = new NativeRpc(binary, ["--acp"], cwd, qwenSubscriptionEnvironment());
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
