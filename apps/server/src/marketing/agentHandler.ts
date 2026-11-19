import { Effect, Schema } from "effect";
import type { ServerConfigShape } from "../config";
import { executeMarketingTool } from "./chatTools";
import { SOURCE_TOOLS } from "./sourceTools";
import { VIDEO_TOOLS } from "./videoTools";
import { WORKFLOW_TOOLS } from "./agentWorkflowTools";
import { CAMPAIGN_LINK_TOOLS } from "./campaignLinkTools";
import { MarketingError } from "./store";

const requestSchema = Schema.Struct({
  threadId: Schema.String,
  tool: Schema.String,
  args: Schema.Record(Schema.String, Schema.Unknown),
});
const uiTools = new Set(
  [...SOURCE_TOOLS, ...VIDEO_TOOLS, ...WORKFLOW_TOOLS, ...CAMPAIGN_LINK_TOOLS].map(
    (tool) => tool.name,
  ),
);
export function executeAgentRequest(
  config: Pick<ServerConfigShape, "stateDir" | "secretsDir" | "cwd">,
  raw: unknown,
) {
  return Effect.gen(function* () {
    const input = yield* Effect.try({
      try: () => {
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.keys(raw).some((key) => !["threadId", "tool", "args"].includes(key))
        )
          throw new Error("Invalid request keys");
        return Schema.decodeUnknownSync(requestSchema)(raw);
      },
      catch: () => new MarketingError("Invalid social workspace request."),
    });
    if (!input.threadId.trim() || input.threadId.length > 128 || !uiTools.has(input.tool))
      return yield* Effect.fail(
        new MarketingError("Choose a supported tool in this conversation."),
      );
    return yield* executeMarketingTool(
      {
        threadId: input.threadId,
        authorizedRoot: config.cwd,
        attachmentFiles: [],
        stateDir: config.stateDir,
        secretsDir: config.secretsDir,
      },
      input.tool,
      input.args,
    );
  });
}
