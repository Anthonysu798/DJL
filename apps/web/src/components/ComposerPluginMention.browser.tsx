import "../index.css";
import { mcpMention, SOCIAL_PLUGIN_MENTION } from "@djl/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { formatComposerMentionToken } from "~/lib/composerMentions";
import { ComposerPromptEditor } from "./ComposerPromptEditor";

afterEach(cleanup);

it("keeps the MCP server and parent plugin visible in the selected reference", async () => {
  const mention = mcpMention("DJL Work Tools", SOCIAL_PLUGIN_MENTION);
  const value = `${formatComposerMentionToken(mention.name)} `;
  await render(
    <ComposerPromptEditor
      value={value}
      cursor={value.length}
      terminalContexts={[]}
      mentionReferences={[mention]}
      disabled={false}
      placeholder="QA draft"
      onRemoveTerminalContext={vi.fn()}
      onChange={vi.fn()}
      onPaste={vi.fn()}
    />,
  );
  await expect.element(page.getByText(mention.name, { exact: true })).toBeVisible();
});
