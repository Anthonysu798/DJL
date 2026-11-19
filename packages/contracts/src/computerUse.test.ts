import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ComputerUseAction,
  ComputerUseActionResult,
  ComputerUseElementReference,
  ComputerUseHistoryEvent,
  ComputerUseHistorySettings,
  ComputerUseHistoryState,
  ComputerUseObservation,
  decodeComputerUseRequest,
  decodeComputerUseResponse,
  ComputerUseStatus,
} from "./computerUse";

const decode = (schema: Parameters<typeof Schema.decodeUnknownSync>[0], input: unknown) =>
  Schema.decodeUnknownSync(schema)(input, { onExcessProperty: "error" });

const target = { bundleId: "com.djl.fixture", pid: 123, windowId: 45 };
const point = { kind: "point", x: 20, y: 30 };
const element = { kind: "element", snapshotId: "snapshot-1", elementId: 1 };
const session = { sessionId: "session-1", threadId: "thread-1", target };
const observation = {
  sessionId: session.sessionId,
  snapshotId: "snapshot-1",
  target,
  capturedAt: "2026-10-28T12:00:00.000Z",
  bounds: { x: -600, y: 10, width: 500, height: 400 },
  elements: [{ elementId: 1, role: "AXButton", label: "Save", actions: ["press"] }],
  truncated: false,
};

// Removing a bound, discriminator, or required identity must make these cases fail.
describe("native computer use contracts", () => {
  it("accepts explicit permissions and truthful independent capabilities", () => {
    expect(
      decode(ComputerUseStatus, {
        platform: "darwin",
        available: true,
        permissions: { accessibility: "granted", screenRecording: "denied" },
        capabilities: {
          observation: true,
          screenshots: false,
          backgroundActions: ["click"],
          virtualCursor: false,
          passiveHistory: false,
        },
      }),
    ).toMatchObject({ available: true });
  });

  it("decodes advertised actions including paste and selection without duplicates", () => {
    const status = {
      platform: "darwin",
      available: true,
      permissions: { accessibility: "granted", screenRecording: "granted" },
      capabilities: {
        observation: true,
        screenshots: true,
        virtualCursor: true,
        passiveHistory: true,
        backgroundActions: [
          "click",
          "setValue",
          "performAction",
          "drag",
          "type",
          "paste",
          "pressKey",
          "scroll",
        ],
      },
    };
    expect(decode(ComputerUseStatus, status)).toEqual(status);
    expect(
      decode(ComputerUseStatus, {
        ...status,
        capabilities: {
          ...status.capabilities,
          backgroundActions: [...status.capabilities.backgroundActions, "selectText"],
        },
      }),
    ).toBeDefined();
    expect(() =>
      decode(ComputerUseStatus, {
        ...status,
        capabilities: {
          ...status.capabilities,
          backgroundActions: [...status.capabilities.backgroundActions, "paste"],
        },
      }),
    ).toThrow();
  });

  it("accepts the complete session request flow without model-supplied thread identity", () => {
    const requests = [
      { method: "status" },
      { method: "apps.list" },
      { method: "session.open", target },
      {
        method: "session.observe",
        sessionId: session.sessionId,
        screenshot: true,
        maxElements: 100,
      },
      {
        method: "session.perform",
        sessionId: session.sessionId,
        action: { type: "click", target: element },
      },
      { method: "session.close", sessionId: session.sessionId },
      { method: "stop", sessionId: session.sessionId },
      { method: "stop" },
    ];
    for (const request of requests) expect(decodeComputerUseRequest(request)).toEqual(request);
    expect(() =>
      decodeComputerUseRequest({ method: "session.open", target, threadId: "other" }),
    ).toThrow();
  });

  it("accepts all finite action variants including Unicode typing", () => {
    for (const action of [
      { type: "click", target: point, button: "left", count: 2 },
      { type: "drag", from: point, to: { ...point, x: 120 }, durationMs: 250 },
      { type: "type", target: element, text: "你好 👋" },
      { type: "selectText", target: element, text: "你好" },
      { type: "pressKey", target: element, key: "Enter", modifiers: ["command"] },
      { type: "scroll", target: point, deltaX: 0, deltaY: -200 },
      { type: "setValue", target: element, value: "" },
      { type: "performAction", target: element, action: "press" },
    ])
      expect(decode(ComputerUseAction, action)).toEqual(action);
  });

  it.each(["text", "md", "html"])("accepts explicit %s paste with a fresh element", (format) => {
    const action = { type: "paste", target: element, text: "Synthetic café ✓", format };
    expect(decode(ComputerUseAction, action)).toEqual(action);
    expect(() => decode(ComputerUseAction, { ...action, target: point })).toThrow();
    expect(() => decode(ComputerUseAction, { ...action, text: "" })).toThrow();
    expect(() => decode(ComputerUseAction, { ...action, text: "x".repeat(16_385) })).toThrow();
    expect(() => decode(ComputerUseAction, { ...action, format: "rtf" })).toThrow();
    expect(() => decode(ComputerUseAction, { ...action, clipboardName: "other" })).toThrow();
  });

  it.each(["text", "cursor_before", "cursor_after"])(
    "accepts %s selection with a snapshot element and bounded context",
    (selection) => {
      const action = {
        type: "selectText",
        target: element,
        text: "café 🧪",
        prefix: " ",
        suffix: "",
        selection,
      };
      expect(decode(ComputerUseAction, action)).toEqual(action);
      for (const invalid of [
        { ...action, target: point },
        { ...action, text: "" },
        { ...action, text: "x".repeat(16_385) },
        { ...action, prefix: "x".repeat(16_385) },
        { ...action, suffix: "x".repeat(16_385) },
        { ...action, selection: "all" },
        { ...action, sourceOffsets: [1, 2] },
      ])
        expect(() => decode(ComputerUseAction, invalid)).toThrow();
    },
  );

  it("decodes measured selection readback and rejects invalid ranges", () => {
    const selected = {
      ...observation,
      elements: [{ ...observation.elements[0], selectedTextRange: { location: 3, length: 4 } }],
    };
    expect(decode(ComputerUseObservation, selected)).toEqual(selected);
    for (const range of [
      { location: -1, length: 0 },
      { location: 0.5, length: 1 },
      { location: 0, length: Infinity },
      { location: 1_048_576, length: 1 },
    ])
      expect(() =>
        decode(ComputerUseObservation, {
          ...selected,
          elements: [{ ...selected.elements[0], selectedTextRange: range }],
        }),
      ).toThrow();
    expect(
      decode(ComputerUseObservation, {
        ...selected,
        elements: [
          { ...selected.elements[0], selectedTextRange: { location: 1_048_576, length: 0 } },
        ],
      }),
    ).toBeDefined();
  });

  it.each([NaN, Infinity, -1, 100_001])("rejects invalid local coordinates %s", (x) => {
    expect(() => decode(ComputerUseAction, { type: "click", target: { ...point, x } })).toThrow();
  });

  it("requires snapshot scoped integer references; freshness is enforced by the runtime", () => {
    expect(decode(ComputerUseElementReference, element)).toEqual(element);
    for (const invalid of [
      { kind: "element", elementId: 1 },
      { ...element, snapshotId: "" },
      { ...element, snapshotId: "x".repeat(129) },
      { ...element, elementId: -1 },
      { ...element, elementId: 1.5 },
      { ...element, elementId: 501 },
      { ...element, target },
    ])
      expect(() => decode(ComputerUseElementReference, invalid)).toThrow();
    expect(
      decode(ComputerUseElementReference, { ...element, snapshotId: "previous-snapshot" }),
    ).toMatchObject({ snapshotId: "previous-snapshot" });
  });

  it("rejects malformed actions and oversized input", () => {
    for (const action of [
      { type: "launch", target: point },
      { type: "click", target: { ...point, ...element } },
      { type: "click", target: point, count: 4 },
      { type: "type", target: element, text: "x".repeat(16_385) },
      { type: "pressKey", target: element, key: "" },
      { type: "pressKey", target: element, key: "Enter", modifiers: ["hyper"] },
      { type: "drag", from: point, to: point, durationMs: 10_001 },
      { type: "performAction", target: element, action: "arbitrary-selector" },
    ])
      expect(() => decode(ComputerUseAction, action)).toThrow();
  });

  it("bounds observations, identities, and screenshot payloads", () => {
    expect(decode(ComputerUseObservation, observation)).toEqual(observation);
    expect(
      decode(ComputerUseObservation, {
        ...observation,
        screenshot: {
          width: 500,
          height: 400,
          mimeType: "image/png",
          payload: { kind: "reference", id: "capture-1" },
        },
      }),
    ).toMatchObject({ screenshot: { payload: { kind: "reference" } } });
    for (const invalid of [
      { ...observation, target: { ...target, pid: 0 } },
      { ...observation, bounds: { ...observation.bounds, width: 0 } },
      { ...observation, elements: Array(501).fill(observation.elements[0]) },
      { ...observation, elements: [{ ...observation.elements[0], label: "x".repeat(513) }] },
      {
        ...observation,
        screenshot: {
          width: 500,
          height: 400,
          mimeType: "image/png",
          payload: { kind: "data", base64: "x".repeat(4_000_001) },
        },
      },
    ])
      expect(() => decode(ComputerUseObservation, invalid)).toThrow();
  });

  it("separates action acknowledgement from independently observed effect", () => {
    expect(
      decode(ComputerUseActionResult, {
        acknowledgement: "dispatched",
        effect: "unverified",
      }),
    ).toEqual({ acknowledgement: "dispatched", effect: "unverified" });
    expect(
      decode(ComputerUseActionResult, {
        acknowledgement: "dispatched",
        effect: "observed-change",
        observation,
      }),
    ).toMatchObject({ effect: "observed-change" });
    expect(
      decodeComputerUseResponse({
        method: "session.open",
        result: session,
      }),
    ).toMatchObject({ result: { target } });
    expect(
      decodeComputerUseResponse({
        method: "session.perform",
        error: { code: "stale-snapshot", message: "Observe again" },
      }),
    ).toMatchObject({ error: { code: "stale-snapshot" } });
  });

  it("requires observation evidence before reporting an observed action effect", () => {
    expect(() =>
      decode(ComputerUseActionResult, {
        acknowledgement: "dispatched",
        effect: "observed-change",
      }),
    ).toThrow();
    expect(() =>
      decode(ComputerUseActionResult, {
        acknowledgement: "rejected",
        effect: "observed-change",
        observation,
      }),
    ).toThrow();
  });

  it("validates history pagination and opt-in passive capture controls", () => {
    const settings = {
      enabled: false,
      paused: true,
      retentionDays: 7,
      intervalSeconds: 30,
      excludedBundleIds: [target.bundleId],
      excludedDomains: ["example.com"],
    };
    expect(decode(ComputerUseHistorySettings, settings)).toEqual(settings);
    expect(decodeComputerUseRequest({ method: "history.configure", settings })).toMatchObject({
      settings,
    });
    expect(
      decodeComputerUseRequest({
        method: "history.list",
        limit: 25,
        cursor: "event-1",
        source: "agent",
      }),
    ).toMatchObject({ limit: 25 });
    for (const request of [
      { method: "history.list", limit: 0 },
      { method: "history.list", limit: 201 },
      { method: "history.list", cursor: "" },
      { method: "history.list", cursor: "x".repeat(129) },
      { method: "history.delete" },
      { method: "session.observe", sessionId: "" },
      { method: "session.observe", sessionId: "s", maxElements: 501 },
      { method: "history.configure", settings: { ...settings, retentionDays: 366 } },
      {
        method: "history.configure",
        settings: { ...settings, excludedDomains: Array(101).fill("example.com") },
      },
    ])
      expect(() => decodeComputerUseRequest(request)).toThrow();
  });

  it("supports reading history settings and clearing selected history", () => {
    const settings = {
      enabled: false,
      paused: false,
      retentionDays: 7,
      intervalSeconds: 30,
      excludedBundleIds: [],
      excludedDomains: [],
    };
    for (const request of [
      { method: "history.settings" },
      { method: "history.clear" },
      { method: "history.clear", source: "agent" },
      { method: "history.clear", source: "passive" },
    ])
      expect(decodeComputerUseRequest(request)).toEqual(request);
    expect(
      decodeComputerUseResponse({ method: "history.settings", result: settings }),
    ).toMatchObject({ result: settings });
    expect(
      decodeComputerUseResponse({ method: "history.clear", result: { deletedCount: 0 } }),
    ).toMatchObject({ result: { deletedCount: 0 } });
    for (const deletedCount of [-1, 0.5, Infinity, 1_000_000_001]) {
      expect(() =>
        decodeComputerUseResponse({ method: "history.clear", result: { deletedCount } }),
      ).toThrow();
    }
    expect(() =>
      decodeComputerUseRequest({ method: "history.clear", threadId: "other" }),
    ).toThrow();
    expect(() =>
      decodeComputerUseRequest({ method: "history.clear", source: "unknown" }),
    ).toThrow();
  });

  it("strict integration decoders reject mixed targets and ambiguous response envelopes", () => {
    expect(() =>
      decodeComputerUseRequest({
        method: "session.perform",
        sessionId: session.sessionId,
        action: {
          type: "click",
          target: { ...point, snapshotId: element.snapshotId, elementId: element.elementId },
        },
      }),
    ).toThrow();
    expect(() =>
      decodeComputerUseResponse({
        method: "session.open",
        result: session,
        error: { code: "target-unavailable", message: "Unavailable" },
      }),
    ).toThrow();
  });

  it("history action metadata has no typed text or full action payload", () => {
    const event = {
      id: "event-1",
      source: "agent",
      type: "action",
      at: observation.capturedAt,
      sessionId: session.sessionId,
      target,
      actionType: "type",
      acknowledgement: "dispatched",
      effect: "unverified",
    };
    expect(decode(ComputerUseHistoryEvent, event)).toEqual(event);
    expect(() => decode(ComputerUseHistoryEvent, { ...event, text: "secret" })).toThrow();
    expect(() =>
      decode(ComputerUseHistoryEvent, { ...event, action: { type: "type", text: "secret" } }),
    ).toThrow();
  });
});

it("admits only explicit permission requests for the trusted desktop UI", () => {
  expect(
    decodeComputerUseRequest({ method: "permissions.request", permission: "accessibility" }),
  ).toEqual({ method: "permissions.request", permission: "accessibility" });
  expect(() =>
    decodeComputerUseRequest({ method: "permissions.request", permission: "all" }),
  ).toThrow();
});

describe("host pause readback contracts", () => {
  const settings = {
    enabled: true,
    paused: true,
    retentionDays: 30,
    intervalSeconds: 30,
    excludedBundleIds: [],
    excludedDomains: [],
  };
  it("accepts legacy state and fixed actions, but rejects scheduling input and invalid state", () => {
    expect(decode(ComputerUseHistoryState, settings)).toEqual(settings);
    for (const action of ["30m", "1h", "tomorrow09", "indefinite", "resume"])
      expect(decodeComputerUseRequest({ method: "history.pause", action })).toEqual({
        method: "history.pause",
        action,
      });
    for (const pauseResumeAt of ["2026-10-28T12:00:00Z", "2026-02-30T12:00:00.000Z", "bad"])
      expect(() => decode(ComputerUseHistoryState, { ...settings, pauseResumeAt })).toThrow();
    const state = { ...settings, pauseResumeAt: "2026-10-28T12:00:00.000Z" };
    expect(decodeComputerUseResponse({ method: "history.pause", result: state })).toEqual({
      method: "history.pause",
      result: state,
    });
    expect(() => decode(ComputerUseHistoryState, { ...state, enabled: false })).toThrow();
    expect(() => decode(ComputerUseHistoryState, { ...state, paused: false })).toThrow();
    expect(() =>
      decode(ComputerUseHistoryState, { ...settings, pauseResumeError: "raw cause" }),
    ).toThrow();
    expect(() =>
      decodeComputerUseRequest({ method: "history.configure", settings: state }),
    ).toThrow();
    expect(() =>
      decodeComputerUseRequest({
        method: "history.pause",
        action: "custom",
        pauseResumeAt: state.pauseResumeAt,
      }),
    ).toThrow();
    expect(() =>
      decodeComputerUseRequest({ method: "activity.observe", epoch: "one", settings: state }),
    ).toThrow();
  });
});
