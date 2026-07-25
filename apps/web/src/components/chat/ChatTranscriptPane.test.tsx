import { MessageId, ThreadId } from "@synara/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { createInstance, type i18n } from "i18next";
import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";
import englishCatalog from "../../i18n/locales/en.json";
import { ChatTranscriptPane } from "./ChatTranscriptPane";

let testI18n: i18n;

beforeAll(async () => {
  testI18n = createInstance();
  await testI18n.use(initReactI18next).init({ lng: "en", resources: { en: englishCatalog } });
});

function renderTranscriptPaneMarkup(
  props: Partial<ComponentProps<typeof ChatTranscriptPane>> = {},
) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={testI18n}>
      <ChatTranscriptPane
        activeThreadId="thread-1"
        activeTurnId={null}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        chatFontSizePx={14}
        emptyStateProjectName={undefined}
        hasMessages
        isRevertingCheckpoint={false}
        isWorking={false}
        worktreeSetup={null}
        followLiveOutput={false}
        listRef={createRef<LegendListRef | null>()}
        markdownCwd={undefined}
        onExpandTimelineImage={() => {}}
        onIsAtEndChange={() => {}}
        onMessagesClickCapture={() => {}}
        onMessagesMouseUp={() => {}}
        onMessagesPointerCancel={() => {}}
        onMessagesPointerDown={() => {}}
        onMessagesPointerUp={() => {}}
        onMessagesScroll={() => {}}
        onMessagesTouchEnd={() => {}}
        onMessagesTouchMove={() => {}}
        onMessagesTouchStart={() => {}}
        onMessagesWheel={() => {}}
        onOpenTurnDiff={() => {}}
        onOpenThread={(_threadId: ThreadId) => {}}
        onRevertUserMessage={(_messageId: MessageId) => {}}
        onScrollToBottom={() => {}}
        resolvedTheme="light"
        revertTurnCountByUserMessageId={new Map()}
        scrollButtonVisible
        terminalWorkspaceTerminalTabActive={false}
        timelineEntries={[]}
        timestampFormat="locale"
        turnDiffSummaryByAssistantMessageId={new Map()}
        workspaceRoot={undefined}
        {...props}
      />
    </I18nextProvider>,
  );
}

describe("ChatTranscriptPane", () => {
  it("renders agent activity detail in place of the message timeline", () => {
    const markup = renderTranscriptPaneMarkup({
      agentActivityDetail: {
        id: "agent-task-1",
        title: "Agent task",
        summary: "Checked the sidebar issue.",
        primaryEntry: {
          id: "agent-task-1",
          createdAt: "2026-06-05T00:00:00.000Z",
          label: "Agent task",
          tone: "tool",
          itemType: "collab_agent_tool_call",
          detail: "Checked the sidebar issue.",
        },
        entries: [
          {
            id: "agent-task-1",
            createdAt: "2026-06-05T00:00:00.000Z",
            label: "Agent task",
            tone: "tool",
            itemType: "collab_agent_tool_call",
            detail: "Checked the sidebar issue.",
          },
        ],
      },
      onCloseAgentActivityDetail: () => {},
    });

    expect(markup).toContain('data-agent-activity-detail="true"');
    expect(markup).toContain("Back");
    expect(markup).toContain("Checked the sidebar issue.");
    expect(markup).not.toContain("Scroll to bottom");
  });

  it("centers the scroll button inside the inset chat column", () => {
    const markup = renderTranscriptPaneMarkup({
      contentInsetRightPx: 360,
      scrollButtonVisible: true,
    });

    expect(markup).toContain('style="padding-right:360px"');
    expect(markup).toContain("Scroll to bottom");
  });
});
