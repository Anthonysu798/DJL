import type { BrowserFindingDraft } from "@synara/contracts";
import { appendBrowserFindingsBlock } from "@synara/shared/browserFindings";
import { translateRendererCopy } from "../i18n";

export function buildKanbanBrowserFindingDispatch(input: {
  prompt: string;
  messageText: string;
  findings: readonly BrowserFindingDraft[];
}): { messageText: string; titleSeed: string | null } {
  const prompt = input.prompt.trim();
  return {
    messageText: appendBrowserFindingsBlock(input.messageText, input.findings),
    titleSeed:
      prompt ||
      (input.findings.length > 0
        ? translateRendererCopy(
            "work:kanban.dispatch.browserFinding",
            input.findings.length === 1 ? "Browser finding" : "Browser findings",
            { count: input.findings.length },
          )
        : null),
  };
}
