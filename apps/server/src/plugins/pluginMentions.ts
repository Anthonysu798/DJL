// FILE: pluginMentions.ts
// Purpose: Turns an "@plugin" mention of a DJL catalog plugin into a plain instruction: the
//          plugin's own instructions if it has them, otherwise which tool server to use.
//          Harnesses only understand their own mention paths, so DJL's must not reach them.

import { DJL_PLUGIN_MENTION_PREFIX, type ProviderMentionReference } from "@synara/contracts";

import { DOCUMENT_PLUGIN_INSTRUCTIONS } from "./documentPlugins";
import { gatewayServerName } from "./PluginGateway";

export function resolveDjlPluginMentions<
  T extends { messageText: string; mentions?: readonly ProviderMentionReference[] },
>(input: T): T {
  const selected = (input.mentions ?? []).filter((mention) =>
    mention.path.startsWith(DJL_PLUGIN_MENTION_PREFIX),
  );
  if (selected.length === 0) return input;
  const instructions = selected.map((mention) => {
    const pluginId = mention.path.slice(DJL_PLUGIN_MENTION_PREFIX.length);
    const own = DOCUMENT_PLUGIN_INSTRUCTIONS.get(pluginId);
    if (own) return own;
    const server = gatewayServerName(pluginId);
    return `The user selected the ${JSON.stringify(mention.name)} plugin. Its tools come from the MCP server whose name starts with ${JSON.stringify(server)}. Use them for this request; if they are unavailable, say so instead of claiming the work was done.`;
  });
  return {
    ...input,
    mentions: (input.mentions ?? []).filter((mention) => !selected.includes(mention)),
    messageText: `${input.messageText}\n\nDJL selected plugin instructions:\n${instructions.join("\n")}`,
  };
}
