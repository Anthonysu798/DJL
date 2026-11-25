import type * as EffectAcpSchema from "effect-acp/schema";
import { buildCursorAgentCommand } from "../../provider/acp/CursorAcpCommand";
import { resolveCursorAcpModelId } from "../../provider/acp/CursorAcpSupport";
import { createNativeAcpDriver } from "./acp";

// https://cursor.com/docs/cli/acp — ACP v1, provider-owned login.
export const createCursorDriver = createNativeAcpDriver({
  label: "Cursor",
  source: "cursor.acp",
  command(input) {
    const options = input.providerOptions?.cursor;
    return buildCursorAgentCommand(options?.binaryPath, [
      ...(options?.apiEndpoint ? ["-e", options.apiEndpoint] : []),
      "acp",
    ]);
  },
  // cursor-agent only accepts its advertised values, e.g. `claude-opus-5-5[context=300k,…]`.
  resolveModelId: (session, model) =>
    resolveCursorAcpModelId(
      (Array.isArray(session.configOptions)
        ? session.configOptions
        : []) as ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
      model,
    ),
  modeId: (_session, turn) => (turn.interactionMode === "plan" ? "plan" : "agent"),
});
