import { describe, expect, it } from "vitest";
import {
  decodeComputerActivityPage,
  decodeComputerActivitySnapshot,
  decodeComputerActivityScope,
} from "./computerActivity";
import { decodeComputerUseRequest } from "./computerUse";

const snapshot = {
  id: "fixture-1",
  capturedAt: "2026-10-28T12:00:00.000Z",
  target: { bundleId: "org.djl.fixture", pid: 42, windowId: 7 },
  appName: "Fixture",
  windowTitle: "Controlled window",
  labels: ["Static fixture label"],
};

describe("passive activity contracts", () => {
  it("uses canonical, ordered app/time scopes for reading and human clearing", () => {
    const scope = {
      since: "2026-10-28T12:00:00.000Z",
      until: "2026-10-28T13:00:00.000Z",
      bundleId: snapshot.target.bundleId,
    };
    expect(decodeComputerActivityScope(scope)).toEqual(scope);
    expect(decodeComputerUseRequest({ method: "activity.clear", ...scope })).toEqual({
      method: "activity.clear",
      ...scope,
    });
    expect(
      decodeComputerUseRequest({
        method: "activity.list",
        ...scope,
        semanticCursor: "semantic-id",
      }),
    ).toMatchObject({ semanticCursor: "semantic-id" });
    for (const bounds of [
      { since: "2026-02-30T00:00:00.000Z" },
      { until: "2026-10-28" },
      { since: scope.until, until: scope.since },
    ]) {
      expect(() => decodeComputerActivityScope(bounds)).toThrow();
      expect(() => decodeComputerUseRequest({ method: "activity.clear", ...bounds })).toThrow();
    }
  });
  it("accepts bounded snapshot metadata and a separate summary timeline", () => {
    expect(decodeComputerActivitySnapshot(snapshot)).toEqual(snapshot);
    expect(
      decodeComputerActivityPage({ snapshots: [snapshot], summaries: [] }).snapshots,
    ).toHaveLength(1);
  });

  it.each(["value", "typedText", "clipboard", "screenshot", "keySequences"])(
    "rejects %s at snapshot boundary",
    (field) => {
      expect(() => decodeComputerActivitySnapshot({ ...snapshot, [field]: "secret" })).toThrow();
    },
  );

  it("rejects nested unknown fields and invalid timestamps or domains", () => {
    expect(() =>
      decodeComputerActivitySnapshot({
        ...snapshot,
        target: { ...snapshot.target, text: "secret" },
      }),
    ).toThrow();
    expect(() => decodeComputerActivitySnapshot({ ...snapshot, capturedAt: "tomorrow" })).toThrow();
    expect(() =>
      decodeComputerActivitySnapshot({ ...snapshot, domain: "https://example.com/private" }),
    ).toThrow();
  });

  it("bounds labels and pages", () => {
    expect(() =>
      decodeComputerActivitySnapshot({ ...snapshot, labels: Array(33).fill("label") }),
    ).toThrow();
    expect(() =>
      decodeComputerActivitySnapshot({ ...snapshot, labels: ["x".repeat(257)] }),
    ).toThrow();
    expect(() =>
      decodeComputerActivityPage({ snapshots: Array(201).fill(snapshot), summaries: [] }),
    ).toThrow();
    expect(() =>
      decodeComputerActivityPage({ snapshots: [], summaries: [], intent: "working" }),
    ).toThrow();
  });
});
