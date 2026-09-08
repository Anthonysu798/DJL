import { buildCursorAgentCommand } from "../../provider/acp/CursorAcpCommand";
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
  modeId: (_session, turn) => (turn.interactionMode === "plan" ? "plan" : "agent"),
});
