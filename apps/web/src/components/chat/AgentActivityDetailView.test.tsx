import { createInstance, type i18n } from "i18next";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";
import englishCatalog from "../../i18n/locales/en.json";
import { AgentActivityDetailView } from "./AgentActivityDetailView";

let testI18n: i18n;

beforeAll(async () => {
  testI18n = createInstance();
  await testI18n.use(initReactI18next).init({ lng: "en", resources: { en: englishCatalog } });
});

function renderLocalized(element: ReactElement) {
  return renderToStaticMarkup(<I18nextProvider i18n={testI18n}>{element}</I18nextProvider>);
}

describe("AgentActivityDetailView", () => {
  it("renders a full agent activity detail surface", () => {
    const markup = renderLocalized(
      <AgentActivityDetailView
        detail={{
          id: "agent-task-1",
          title: "Find changelog implementation",
          summary: "Agent found the relevant files.",
          primaryEntry: {
            id: "agent-task-1",
            createdAt: "2026-06-05T00:00:00.000Z",
            label: "Find changelog implementation",
            tone: "tool",
            itemType: "collab_agent_tool_call",
            detail: "Agent found the relevant files.",
            subagentAction: {
              tool: "task",
              status: "completed",
              summaryText: "Agent activity",
              prompt: "Explore the changelog implementation.",
            },
          },
          entries: [
            {
              id: "agent-task-1",
              createdAt: "2026-06-05T00:00:00.000Z",
              label: "Find changelog implementation",
              tone: "tool",
              itemType: "collab_agent_tool_call",
              detail: "Agent found the relevant files.",
              subagentAction: {
                tool: "task",
                status: "completed",
                summaryText: "Agent activity",
                prompt: "Explore the changelog implementation.",
              },
            },
          ],
        }}
        chatFontSizePx={14}
        markdownCwd={undefined}
        onBack={() => {}}
        onImageExpand={() => {}}
        timestampFormat="locale"
      />,
    );

    expect(markup).toContain("Back");
    expect(markup).toContain("Find changelog implementation");
    expect(markup).toContain("Explore the changelog implementation.");
    expect(markup).toContain("Agent found the relevant files.");
  });
});
