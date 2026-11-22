import { buildGeminiProbeEnv } from "../../provider/geminiAcpProbe";
import { createNativeAcpDriver } from "./acp";
import { NativeRpc, object } from "./protocol";
import type { NativeDriverFactory } from "./types";

// Gemini CLI signs in through its own stored login. The probe environment blocks
// the OAuth browser so a background session never opens a sign-in window.
export function geminiSubscriptionEnvironment(base: NodeJS.ProcessEnv = process.env) {
  return buildGeminiProbeEnv(base);
}

const acpDriver = createNativeAcpDriver({
  label: "Gemini CLI",
  source: "gemini.acp",
  command: (input) => ({
    command: input.providerOptions?.gemini?.binaryPath?.trim() || "gemini",
    args: ["--acp"],
    env: geminiSubscriptionEnvironment(),
  }),
  modeId(session, turn) {
    const state = object(session.modes ?? {});
    const available = Array.isArray(state.availableModes) ? state.availableModes.map(object) : [];
    const desired = turn.interactionMode === "plan" ? "plan" : "default";
    if (!available.some((mode) => mode.id === desired))
      throw new Error(`Gemini CLI does not advertise ${desired} mode.`);
    return desired;
  },
});

// An older CLI rejects `--acp` and exits before answering the handshake.
const EARLY_EXIT = /^Native runtime (exited|input closed)/;

export const createGeminiDriver: NativeDriverFactory = async (input, sink, workTools, plugins) => {
  try {
    return await acpDriver(input, sink, workTools, plugins);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (EARLY_EXIT.test(message))
      throw new Error(
        `Gemini CLI could not start in agent mode. Update Gemini CLI and try again. (${message})`,
        { cause: error },
      );
    throw error;
  }
};

export async function probeGeminiSubscriptionAccount(binary: string, cwd: string) {
  const rpc = new NativeRpc(binary, ["--acp"], cwd, geminiSubscriptionEnvironment());
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
