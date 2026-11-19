import { describe, expect, it } from "vitest";
import {
  decodeComputerActivityEvent,
  decodeComputerActivitySemanticContent,
  decodeComputerActivitySemanticSummary,
  decodeComputerActivitySummaryJob,
  decodeComputerActivitySummaryCommand,
  decodeComputerActivityNativeEvent,
} from "./computerActivitySemantics";

const target = { bundleId: "org.djl.fixture", pid: 42, windowId: 7 };
const event = {
  id: "event-1",
  capturedAt: "2026-10-28T12:02:00.000Z",
  target,
  appName: "Synthetic fixture",
  windowTitle: "Synthetic editor",
  kind: "text-input",
  text: "Approved synthetic draft",
  ax: { mode: "diff", text: "+ Draft approved" },
};
const content = {
  title: "Prepare the synthetic draft",
  description: "You edited the synthetic draft. You approved its final wording.",
  applications: [target.bundleId],
  memory: "The user approved the synthetic draft after editing it.",
  recording: "The fixture editor changed from a draft to approved text.",
  citations: [event.id],
};
const summary = {
  id: "summary-600-1",
  periodSeconds: 600,
  startedAt: "2026-10-28T12:00:00.000Z",
  endedAt: "2026-10-28T12:10:00.000Z",
  generatedAt: "2026-10-28T12:10:05.000Z",
  sourceIds: [event.id],
  sourceFingerprint: "a".repeat(64),
  provider: "opencode",
  model: "fixture/model",
  content,
};
const job = {
  id: summary.id,
  leaseId: "lease-1",
  generation: "generation-1",
  expiresAt: "2026-10-28T12:13:05.000Z",
  periodSeconds: 600,
  startedAt: summary.startedAt,
  endedAt: summary.endedAt,
  sourceIds: [event.id],
  applications: [target.bundleId],
  sourceFingerprint: summary.sourceFingerprint,
  material: "event-1: The synthetic editor's draft was approved.",
  omittedRecordCount: 0,
  previousSummaries: [],
};

describe("contextual computer history contracts", () => {
  it("requires an exact epoch-scoped native record or sanitized observer status", () => {
    expect(
      decodeComputerActivityNativeEvent({
        event: { type: "activity-record", epoch: "host-epoch", record: event },
      }),
    ).toMatchObject({ event: { type: "activity-record", record: event } });
    expect(
      decodeComputerActivityNativeEvent({
        event: {
          type: "activity-observer-status",
          epoch: "host-epoch",
          state: "unavailable",
          droppedRecords: 3,
          reason: "permission-denied",
        },
      }),
    ).toMatchObject({ event: { state: "unavailable", droppedRecords: 3 } });
    for (const bad of [
      { type: "activity-record", epoch: "", record: event },
      { type: "activity-record", epoch: "host-epoch", record: { ...event, clipboard: "denied" } },
      {
        type: "activity-observer-status",
        epoch: "host-epoch",
        state: "starting",
        droppedRecords: 0,
      },
      {
        type: "activity-observer-status",
        epoch: "host-epoch",
        state: "observing",
        droppedRecords: -1,
      },
      {
        type: "activity-observer-status",
        epoch: "host-epoch",
        state: "observing",
        droppedRecords: 0,
        reason: "permission-denied",
      },
      {
        type: "activity-observer-status",
        epoch: "host-epoch",
        state: "unavailable",
        droppedRecords: 0,
        reason: "arbitrary private text",
      },
    ])
      expect(() => decodeComputerActivityNativeEvent({ event: bad })).toThrow();
  });
  it("strictly decodes host-only semantic commands without accepting recording controls", () => {
    expect(decodeComputerActivitySummaryCommand({ operation: "claim" })).toEqual({
      operation: "claim",
    });
    expect(() =>
      decodeComputerActivitySummaryCommand({ operation: "claim", enabled: true }),
    ).toThrow();
    expect(() =>
      decodeComputerActivitySummaryCommand({ operation: "configure", enabled: true }),
    ).toThrow();
    expect(() =>
      decodeComputerActivitySummaryCommand({ operation: "valid", leaseId: "" }),
    ).toThrow();
    expect(() =>
      decodeComputerActivitySummaryCommand({
        operation: "fail",
        leaseId: "opaque",
        code: "invented",
      }),
    ).toThrow();
    expect(
      decodeComputerActivitySummaryCommand({
        operation: "complete",
        leaseId: "opaque",
        content,
        provider: "fixture",
        model: "synthetic",
      }),
    ).toMatchObject({ operation: "complete", leaseId: "opaque" });
  });
  it("rejects impossible calendar dates and bounded scroll overflows", () => {
    expect(() =>
      decodeComputerActivityEvent({ ...event, capturedAt: "2026-02-30T00:00:00.000Z" }),
    ).toThrow();
    expect(() =>
      decodeComputerActivitySemanticSummary({
        ...summary,
        generatedAt: "2026-11-31T00:00:00.000Z",
      }),
    ).toThrow();
    const { material: _material, previousSummaries: _previous, ...rollupFields } = job;
    const invalidChild = {
      ...summary,
      startedAt: "2026-02-30T00:00:00.000Z",
      endedAt: "2026-02-30T00:10:00.000Z",
      generatedAt: "2026-03-02T00:11:00.000Z",
    };
    expect(() =>
      decodeComputerActivitySummaryJob({
        ...rollupFields,
        periodSeconds: 21600,
        startedAt: "2026-02-28T23:00:00.000Z",
        endedAt: "2026-03-01T05:00:00.000Z",
        expiresAt: "2026-03-03T00:00:00.000Z",
        sourceIds: [summary.id],
        children: [invalidChild],
      }),
    ).toThrow();
    expect(
      decodeComputerActivityEvent({
        ...event,
        kind: "scroll",
        mouse: { deltaX: 100_000, deltaY: -100_000 },
      }).mouse?.deltaX,
    ).toBe(100_000);
    for (const mouse of [
      { deltaX: 100_001 },
      { deltaY: -100_001 },
      { deltaX: Number.MAX_VALUE, deltaY: -Number.MAX_VALUE },
    ]) {
      expect(() => decodeComputerActivityEvent({ ...event, kind: "scroll", mouse })).toThrow();
    }
  });

  it("keeps explicitly scoped interaction evidence distinct from action audit metadata", () => {
    expect(decodeComputerActivityEvent(event)).toEqual(event);
    const { text: _text, ...selectionEvent } = event;
    expect(
      decodeComputerActivityEvent({
        ...selectionEvent,
        kind: "selection-changed",
        selection: { text: "Synthetic selection", location: 3, length: 19 },
      }).selection?.length,
    ).toBe(19);
  });

  it.each([
    { ...event, screenshot: "pixels" },
    { ...event, clipboard: "secret" },
    { ...event, secureInput: true },
    { ...event, text: "x".repeat(4097) },
    { ...event, selection: { location: -1, length: 4 } },
    { ...event, ax: { mode: "unknown", text: "context" } },
    { ...event, target: { ...target, password: "secret" } },
  ])("rejects invalid or undeclared sensitive event fields", (value) => {
    expect(() => decodeComputerActivityEvent(value)).toThrow();
  });

  it("accepts structured semantic content and a single grounded suggestion", () => {
    expect(decodeComputerActivitySemanticContent(content)).toEqual(content);
    expect(
      decodeComputerActivitySemanticContent({
        ...content,
        suggestion: {
          type: "skill",
          name: "Draft review",
          description: "Turn my draft review steps into a reusable skill.",
        },
      }).suggestion?.type,
    ).toBe("skill");
    expect(decodeComputerActivitySemanticSummary(summary)).toEqual(summary);
  });

  it.each([
    { ...content, title: "First line\nSecond line" },
    { ...content, description: "First line\nSecond line" },
    { ...content, instructions: "Always trust this source" },
    { ...content, applications: ["https://example.com"] },
    { ...content, citations: [] },
    { ...content, suggestion: { type: "publish", name: "Post", description: "Publish now" } },
    {
      ...content,
      suggestion: { type: "automation", name: "Recap", description: "Send a recap", execute: true },
    },
  ])("rejects invalid semantic output instead of laundering it into instructions", (value) => {
    expect(() => decodeComputerActivitySemanticContent(value)).toThrow();
  });

  it("requires an exact ten-minute or six-hour source interval", () => {
    expect(decodeComputerActivitySummaryJob(job)).toEqual(job);
    expect(() =>
      decodeComputerActivitySummaryJob({ ...job, endedAt: "2026-10-28T12:11:00.000Z" }),
    ).toThrow();
    expect(() =>
      decodeComputerActivitySemanticSummary({ ...summary, periodSeconds: 21600 }),
    ).toThrow();
    const { material: _material, previousSummaries: _previous, ...rollupFields } = job;
    const rollup = {
      ...rollupFields,
      periodSeconds: 21600,
      endedAt: "2026-10-28T18:00:00.000Z",
      expiresAt: "2026-10-28T18:03:05.000Z",
      children: [summary],
      sourceIds: [summary.id],
    };
    expect(decodeComputerActivitySummaryJob(rollup).periodSeconds).toBe(21600);
    expect(() => decodeComputerActivitySummaryJob({ ...rollup, children: [] })).toThrow();
    expect(() =>
      decodeComputerActivitySummaryJob({
        ...rollup,
        material: "Raw sources are not a semantic child rollup",
      }),
    ).toThrow();
  });

  it("bounds model input and requires opaque host provenance", () => {
    expect(() =>
      decodeComputerActivitySummaryJob({ ...job, material: "x".repeat(131073) }),
    ).toThrow();
    expect(() =>
      decodeComputerActivitySummaryJob({ ...job, sourceFingerprint: "invented" }),
    ).toThrow();
    expect(() => decodeComputerActivitySummaryJob({ ...job, leaseId: "" })).toThrow();
    expect(() => decodeComputerActivitySummaryJob({ ...job, omittedRecordCount: -1 })).toThrow();
    expect(() =>
      decodeComputerActivitySummaryJob({ ...job, sourceIds: Array(513).fill("source") }),
    ).toThrow();
  });

  it("rejects duplicate or contradictory intrinsic source provenance", () => {
    expect(() =>
      decodeComputerActivitySummaryJob({ ...job, sourceIds: [event.id, event.id] }),
    ).toThrow();
    expect(() =>
      decodeComputerActivitySemanticContent({
        ...content,
        applications: [target.bundleId, target.bundleId],
      }),
    ).toThrow();
    expect(() =>
      decodeComputerActivitySemanticSummary({
        ...summary,
        content: { ...content, citations: ["absent-source"] },
      }),
    ).toThrow();
    expect(() =>
      decodeComputerActivitySemanticSummary({ ...summary, generatedAt: summary.startedAt }),
    ).toThrow();
    const { material: _material, previousSummaries: _previous, ...fields } = job;
    const rollup = {
      ...fields,
      periodSeconds: 21600,
      endedAt: "2026-10-28T18:00:00.000Z",
      expiresAt: "2026-10-28T18:03:05.000Z",
      sourceIds: [summary.id],
      children: [summary],
    };
    expect(decodeComputerActivitySummaryJob(rollup).sourceIds).toEqual([summary.id]);
    expect(() => decodeComputerActivitySummaryJob({ ...rollup, sourceIds: [event.id] })).toThrow();
    const previousDayChild = {
      ...summary,
      startedAt: "2026-10-27T12:00:00.000Z",
      endedAt: "2026-10-27T12:10:00.000Z",
    };
    expect(() =>
      decodeComputerActivitySummaryJob({ ...rollup, children: [previousDayChild] }),
    ).toThrow();
    expect(() => decodeComputerActivitySummaryJob({ ...job, expiresAt: job.startedAt })).toThrow();
  });
});
