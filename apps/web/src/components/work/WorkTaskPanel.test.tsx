import type {
  OrchestrationThreadActivity,
  WorkListPreparedDocumentsResult,
  WorkTask,
} from "@synara/contracts";
import { DocumentArtifactId, EventId } from "@synara/contracts";
import { readFileSync } from "node:fs";
import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it } from "vitest";

import englishCatalog from "../../i18n/locales/en.json";
import { formatLocaleDateTime } from "../../i18n/intl";
import { getTimestampFormatOptions } from "../../timestampFormat";
import {
  DocumentIntelligenceStatusCard,
  PreparedDocumentsPanel,
  WorkTaskPanel,
} from "./WorkTaskPanel";

const testI18n = createInstance();
void testI18n.use(initReactI18next).init({
  defaultNS: "common",
  fallbackLng: "en",
  initAsync: false,
  interpolation: { escapeValue: false },
  lng: "en",
  resources: { en: englishCatalog },
});

function renderLocalized(node: ReactNode): string {
  return renderToStaticMarkup(<I18nextProvider i18n={testI18n}>{node}</I18nextProvider>);
}

const task = {
  threadId: "thread-1",
  phase: "review",
  condition: "active",
  status: "needs_review",
  resumePhase: "review",
  progress: 90,
  statusReason: "Work is ready for review",
  lastTransitionCommandId: "provider:turn-1",
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:02:00.000Z",
  completedAt: null,
} as WorkTask;

const activities = [
  {
    id: EventId.makeUnsafe("activity-plan"),
    tone: "info",
    kind: "turn.tasks.updated",
    summary: "Tasks updated",
    payload: {
      tasks: [
        { task: "Read source workbook", status: "completed" },
        { task: "Draft quarterly report", status: "inProgress" },
      ],
    },
    turnId: null,
    createdAt: "2026-07-13T10:01:00.000Z",
  },
  {
    id: EventId.makeUnsafe("activity-output"),
    tone: "tool",
    kind: "studio.outputs.captured",
    summary: "Captured output",
    payload: { data: { files: [{ path: "Outbox/Q2-report.docx" }] } },
    turnId: null,
    createdAt: "2026-07-13T10:02:00.000Z",
  },
] satisfies ReadonlyArray<OrchestrationThreadActivity>;

describe("WorkTaskPanel", () => {
  it("stores semantic error codes instead of translated display strings", () => {
    const source = readFileSync(new URL("./WorkTaskPanel.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/set(?:Error|PreparedDocumentsError|DeliverableError)\(t\(/);
    expect(source).toContain('workErrorFromCause("loadPreviews", cause)');
    expect(source).toContain('workErrorFromCause("openFile", cause)');
  });

  it("shows progress, deliverables, and review actions without duplicate status chrome", () => {
    const markup = renderLocalized(
      <WorkTaskPanel
        task={task}
        activities={activities}
        timestampFormat="locale"
        busy={false}
        onComplete={() => undefined}
        onRequestChanges={() => undefined}
        onRetry={() => undefined}
        onReopen={() => undefined}
        onCancel={() => undefined}
        onProvideInput={() => undefined}
      />,
    );

    expect(markup).not.toContain("Needs review");
    expect(markup).toContain("Work is ready for review");
    expect(markup).toContain('aria-valuenow="90"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).not.toContain("Read source workbook");
    expect(markup).not.toContain(">Plan<");
    expect(markup).toContain("Outbox/Q2-report.docx");
    expect(markup).toContain("Request changes");
    expect(markup).toContain("Complete task");
  });

  it("offers a local-only reader install with an explicit cloud disclosure", () => {
    const markup = renderLocalized(
      <DocumentIntelligenceStatusCard
        status={{
          state: "not_installed",
          installAvailable: true,
          version: null,
          engineVersion: null,
          detail: null,
        }}
        busy={false}
        error={null}
        onInstall={() => undefined}
        onRepair={() => undefined}
      />,
    );

    expect(markup).toContain("Install local reader");
    expect(markup).toContain("never sends a document to cloud OCR without explicit consent");
  });

  it("shows the document reader gate only for a matching preparation blocker", () => {
    const needsInputTask = {
      ...task,
      phase: "planning",
      condition: "needs_input",
      status: "needs_input",
      progress: 10,
    } as WorkTask;
    const blockedActivities = [
      ...activities,
      {
        id: EventId.makeUnsafe("activity-ocr"),
        tone: "info",
        kind: "work.preparation.needs_document_intelligence",
        summary: "Document intelligence is required",
        payload: {},
        turnId: null,
        createdAt: "2026-07-13T10:03:00.000Z",
      },
    ] satisfies ReadonlyArray<OrchestrationThreadActivity>;

    const markup = renderLocalized(
      <WorkTaskPanel
        task={needsInputTask}
        activities={blockedActivities}
        timestampFormat="locale"
        busy={false}
        onComplete={() => undefined}
        onRequestChanges={() => undefined}
        onRetry={() => undefined}
        onReopen={() => undefined}
        onCancel={() => undefined}
        onProvideInput={() => undefined}
      />,
    );

    expect(markup).toContain("Checking the local document reader");
    expect(markup).toContain("Provide input");
  });

  it("shows prepared excerpts with citations and a low-confidence review warning", () => {
    const prepared = {
      artifacts: [
        {
          id: DocumentArtifactId.makeUnsafe("artifact-1"),
          originalName: "scanned-invoice.pdf",
          extractionMethod: "ocr",
          warnings: ["Low-confidence OCR on page 2"],
          blocks: [
            {
              id: "block-1",
              kind: "text",
              text: "Invoice total: $1,234.50",
              locator: { page: 2 },
              confidence: 0.61,
            },
          ],
          engineVersion: "paddle-test-1",
          createdAt: "2026-07-13T10:02:00.000Z",
        },
      ],
    } satisfies WorkListPreparedDocumentsResult;

    const markup = renderLocalized(<PreparedDocumentsPanel artifacts={prepared.artifacts} />);

    expect(markup).toContain("Prepared documents");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Review recommended");
    expect(markup).toContain("scanned-invoice.pdf");
    expect(markup).toContain("Page 2");
    expect(markup).toContain("Invoice total: $1,234.50");
    expect(markup).toContain("61% confidence");
  });

  it("bounds its height so document previews cannot push the composer off screen", () => {
    const markup = renderLocalized(
      <WorkTaskPanel
        task={task}
        activities={activities}
        timestampFormat="locale"
        busy={false}
        onComplete={() => undefined}
        onRequestChanges={() => undefined}
        onRetry={() => undefined}
        onReopen={() => undefined}
        onCancel={() => undefined}
        onProvideInput={() => undefined}
      />,
    );

    expect(markup).toContain("max-h-[45vh]");
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("overscroll-contain");
  });

  it("honors explicit 12/24-hour settings for real activity timestamps", () => {
    const renderWith = (timestampFormat: "12-hour" | "24-hour") =>
      renderLocalized(
        <WorkTaskPanel
          task={task}
          activities={activities}
          timestampFormat={timestampFormat}
          busy={false}
          onComplete={() => undefined}
          onRequestChanges={() => undefined}
          onRetry={() => undefined}
          onReopen={() => undefined}
          onCancel={() => undefined}
          onProvideInput={() => undefined}
        />,
      );
    const latestTimestamp = activities.at(-1)!.createdAt;
    const expected12 = formatLocaleDateTime(
      latestTimestamp,
      "en",
      getTimestampFormatOptions("12-hour", false),
    );
    const expected24 = formatLocaleDateTime(
      latestTimestamp,
      "en",
      getTimestampFormatOptions("24-hour", false),
    );
    expect(expected12).not.toBe(expected24);
    expect(renderWith("12-hour")).toContain(expected12);
    expect(renderWith("24-hour")).toContain(expected24);
  });
});
