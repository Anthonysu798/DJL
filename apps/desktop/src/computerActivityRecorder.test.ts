import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComputerActivitySnapshot, ComputerUseHistorySettings } from "@synara/contracts";
import { ComputerActivityRecorder } from "./computerActivityRecorder";
import { ComputerActivitySummaries } from "./computerActivitySummaries";

const directories: string[] = [];
const recorders: ComputerActivityRecorder[] = [];
const settings: ComputerUseHistorySettings = {
  enabled: true,
  paused: false,
  retentionDays: 1,
  intervalSeconds: 5,
  excludedBundleIds: [],
  excludedDomains: [],
};
const baseTime = new Date("2026-10-28T12:00:00.000Z");
function snapshot(
  id = "one",
  fields: Partial<ComputerActivitySnapshot> = {},
): ComputerActivitySnapshot {
  return {
    id,
    capturedAt: baseTime.toISOString(),
    target: { bundleId: "org.djl.fixture", pid: 123, windowId: 1 },
    appName: "Fixture",
    windowTitle: id,
    labels: ["Visible static label"],
    ...fields,
  };
}
function setup(options: Partial<ConstructorParameters<typeof ComputerActivityRecorder>[0]> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "djl-activity-test-"));
  directories.push(directory);
  const recorder = new ComputerActivityRecorder({
    directory,
    settings,
    now: () => baseTime,
    capture: async () => snapshot(),
    ...options,
  });
  recorders.push(recorder);
  return { recorder, directory };
}
afterEach(() => {
  for (const recorder of recorders.splice(0)) recorder.dispose();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("private passive activity recorder", () => {
  it("paginates contextual events and label snapshots together with app/time filters", async () => {
    const { recorder } = setup({ settings: { ...settings, interactionCaptureEnabled: true } });
    await recorder.captureNow();
    const { labels: _labels, ...base } = snapshot("z-event");
    recorder.recordEvent(recorder.observationEpoch, {
      ...base,
      kind: "selection-changed",
      selection: { text: "Synthetic selection" },
    });
    const first = recorder.list({ limit: 1 });
    expect(first.events?.map((record) => record.id)).toEqual(["z-event"]);
    expect(first.snapshots).toEqual([]);
    expect(first.nextCursor).toBe("z-event");
    const second = recorder.list({ cursor: first.nextCursor!, limit: 1 });
    expect(second.snapshots.map((record) => record.id)).toEqual(["one"]);
    expect(second.nextCursor).toBeUndefined();
    expect(recorder.list({ bundleId: "other.app" }).snapshots).toEqual([]);
    expect(recorder.list({ until: "2026-10-28T11:59:59.999Z" }).events).toBeUndefined();
  });

  it("paginates large contextual records within the bridge byte budget", () => {
    const { recorder, directory } = setup();
    recorder.dispose();
    const { labels: _labels, ...base } = snapshot();
    writeFileSync(
      join(directory, "activity.json"),
      JSON.stringify({
        version: 1,
        snapshots: [],
        events: Array.from({ length: 50 }, (_, index) => ({
          ...base,
          id: `event-${index}`,
          kind: "accessibility",
          ax: { mode: "full", text: "\0".repeat(16_384) },
        })),
      }),
    );
    const reopened = new ComputerActivityRecorder({
      directory,
      settings,
      now: () => baseTime,
      capture: async () => null,
    });
    recorders.push(reopened);
    const first = reopened.list({ limit: 200 });
    expect(first.events!.length).toBeLessThan(50);
    expect(first.nextCursor).toBeDefined();
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(2 * 1024 * 1024 + 4096);
    const all = [...first.events!];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = reopened.list({ cursor, limit: 200 });
      all.push(...(page.events ?? []));
      cursor = page.nextCursor;
    }
    expect(all).toHaveLength(50);
    expect(new Set(all.map((record) => record.id)).size).toBe(50);
  });

  it("uses the same half-open endpoints for reading and clearing activity", async () => {
    const { recorder } = setup();
    await recorder.captureNow();
    expect(recorder.list({ until: baseTime.toISOString() }).snapshots).toEqual([]);
    expect(
      recorder.list({ since: baseTime.toISOString(), until: baseTime.toISOString() }).snapshots,
    ).toEqual([]);
    expect(recorder.clear({ since: baseTime.toISOString(), until: baseTime.toISOString() })).toBe(
      0,
    );
    expect(recorder.clear({ until: baseTime.toISOString() })).toBe(0);
    expect(recorder.list({ since: baseTime.toISOString() }).snapshots).toHaveLength(1);
    expect(recorder.clear({ since: baseTime.toISOString() })).toBe(1);
  });

  it.each(["buckets", "contexts"] as const)("reports internally truncated count %s", (kind) => {
    const { recorder, directory } = setup();
    recorder.dispose();
    const records = Array.from({ length: kind === "buckets" ? 101 : 201 }, (_, index) =>
      snapshot(`${kind}-${index}`, {
        capturedAt: new Date(
          baseTime.getTime() - (kind === "buckets" ? index * 600_000 : 0),
        ).toISOString(),
      }),
    );
    writeFileSync(
      join(directory, "activity.json"),
      JSON.stringify({ version: 1, snapshots: records }),
    );
    const reopened = new ComputerActivityRecorder({
      directory,
      settings,
      now: () => baseTime,
      capture: async () => null,
    });
    recorders.push(reopened);
    const page = reopened.list({ limit: 200 });
    expect(page.countsTruncated).toBe(true);
    if (kind === "contexts")
      expect(page.summaries[0]).toMatchObject({ snapshotCount: 201, contexts: expect.any(Array) });
  });
  it("requires separate interaction consent and a current host epoch for contextual events", () => {
    const { recorder, directory } = setup();
    const { labels: _labels, ...base } = snapshot("event");
    const raw = { ...base, kind: "text-input", text: "Synthetic revision" };
    const oldEpoch = recorder.observationEpoch;
    expect(recorder.recordEvent(oldEpoch, raw)).toBe(false);
    recorder.configure({ ...settings, interactionCaptureEnabled: true });
    expect(recorder.recordEvent(oldEpoch, raw)).toBe(false);
    expect(recorder.recordEvent(recorder.observationEpoch, raw)).toBe(true);
    expect(recorder.recordEvent(recorder.observationEpoch, raw)).toBe(false);
    expect(recorder.readEvidence()).toMatchObject([{ id: "event", text: "Synthetic revision" }]);
    expect(JSON.parse(readFileSync(join(directory, "activity.json"), "utf8")).events).toHaveLength(
      1,
    );
    const epoch = recorder.observationEpoch;
    recorder.pause();
    expect(recorder.recordEvent(epoch, { ...raw, id: "late" })).toBe(false);
    recorder.pause(false);
    expect(recorder.recordEvent(epoch, { ...raw, id: "old-epoch" })).toBe(false);
  });

  it("rechecks contextual-event policy, redacts text, and clears only selected evidence", async () => {
    const { recorder, directory } = setup({
      settings: { ...settings, interactionCaptureEnabled: true },
    });
    await recorder.captureNow();
    const { labels: _labels, ...base } = snapshot("interaction");
    const raw = {
      ...base,
      kind: "text-input",
      text: "password=synthetic-credential",
      selection: { text: "Bearer ABCDEFGHIJKLMNOP" },
    };
    expect(recorder.recordEvent(recorder.observationEpoch, raw)).toBe(true);
    expect(readFileSync(join(directory, "activity.json"), "utf8")).not.toContain(
      "synthetic-credential",
    );
    expect(
      recorder.recordEvent(recorder.observationEpoch, {
        ...raw,
        id: "malformed",
        clipboard: "not allowed",
      }),
    ).toBe(false);
    recorder.configure({
      ...settings,
      interactionCaptureEnabled: true,
      excludedBundleIds: [base.target.bundleId],
    });
    expect(recorder.recordEvent(recorder.observationEpoch, { ...raw, id: "excluded" })).toBe(false);
    expect(recorder.clear({ bundleId: "other.app" })).toBe(0);
    expect(
      recorder.clear({
        since: baseTime.toISOString(),
        until: new Date(baseTime.getTime() + 1).toISOString(),
        bundleId: base.target.bundleId,
      }),
    ).toBe(2);
    expect(recorder.readEvidence()).toEqual([]);
    expect(() => recorder.clear({ since: "invalid" })).toThrow();
  });

  it("persists contextual evidence across restart and expires it by retention", () => {
    let now = baseTime;
    const { recorder, directory } = setup({
      settings: { ...settings, interactionCaptureEnabled: true },
      now: () => now,
    });
    const { labels: _labels, ...base } = snapshot("persisted-event");
    expect(
      recorder.recordEvent(recorder.observationEpoch, {
        ...base,
        kind: "selection-changed",
        selection: { text: "Owned fixture selection" },
      }),
    ).toBe(true);
    recorder.dispose();
    const reopened = new ComputerActivityRecorder({
      directory,
      settings,
      now: () => now,
      capture: async () => null,
    });
    recorders.push(reopened);
    expect(reopened.readEvidence()).toHaveLength(1);
    now = new Date(baseTime.getTime() + 86_400_001);
    expect(reopened.readEvidence()).toEqual([]);
    expect(JSON.parse(readFileSync(join(directory, "activity.json"), "utf8")).events).toEqual([]);
  });

  it.each(["stop", "clear", "dispose"] as const)(
    "rejects old native events after %s",
    (operation) => {
      const { recorder } = setup({ settings: { ...settings, interactionCaptureEnabled: true } });
      const epoch = recorder.observationEpoch;
      const { labels: _labels, ...base } = snapshot("late-event");
      recorder[operation]();
      expect(recorder.recordEvent(epoch, { ...base, kind: "click" })).toBe(false);
      expect(recorder.readEvidence()).toEqual([]);
    },
  );

  it("rejects unresolved web interaction context under a domain policy", () => {
    const { recorder } = setup({
      settings: {
        ...settings,
        interactionCaptureEnabled: true,
        excludedDomains: ["excluded.example"],
      },
    });
    const { labels: _labels, ...base } = snapshot("web-event");
    expect(
      recorder.recordEvent(recorder.observationEpoch, {
        ...base,
        kind: "text-input",
        webContext: true,
        text: "Unknown page",
      }),
    ).toBe(false);
    expect(
      recorder.recordEvent(recorder.observationEpoch, {
        ...base,
        kind: "text-input",
        webContext: true,
        domain: "sub.excluded.example",
        text: "Excluded page",
      }),
    ).toBe(false);
    expect(recorder.readEvidence()).toEqual([]);
  });

  it("keeps redacted event and label text within reloadable schema bounds", async () => {
    const { recorder, directory } = setup({
      settings: { ...settings, interactionCaptureEnabled: true },
      capture: async () => snapshot("long-label", { labels: ["secret=x ".repeat(28)] }),
    });
    await recorder.captureNow();
    const { labels: _labels, ...base } = snapshot("redacted-event");
    expect(
      recorder.recordEvent(recorder.observationEpoch, {
        ...base,
        kind: "text-input",
        text: "secret=x ".repeat(455),
        appName: "secret=x ".repeat(56),
        windowTitle: "secret=x ".repeat(56),
        keyEquivalent: "secret=x ".repeat(7),
        selection: { text: "secret=x ".repeat(455) },
        ax: { mode: "full", text: "secret=x ".repeat(1820) },
      }),
    ).toBe(true);
    const reopened = new ComputerActivityRecorder({
      directory,
      settings,
      now: () => baseTime,
      capture: async () => null,
    });
    recorders.push(reopened);
    expect(reopened.readEvidence()).toHaveLength(2);
    expect(JSON.stringify(reopened.readEvidence())).not.toContain("secret=x");
    const summaries = new ComputerActivitySummaries({
      directory: join(directory, "semantic"),
      settings: { ...settings, semanticSummariesEnabled: true },
      readEvidence: () => reopened.readEvidence(),
      now: () => new Date("2026-10-28T12:10:31.000Z"),
    });
    expect(summaries.claim()).not.toBeNull();
    summaries.dispose();
  });

  it("rejects impossible calendar bounds without invalidating or deleting evidence", async () => {
    const { recorder } = setup();
    await recorder.captureNow();
    const epoch = recorder.observationEpoch;
    expect(() => recorder.clear({ since: "2026-02-30T00:00:00.000Z" })).toThrow();
    expect(() => recorder.clear({ until: "2026-10-28" })).toThrow();
    expect(recorder.observationEpoch).toBe(epoch);
    expect(recorder.readEvidence()).toHaveLength(1);
  });

  it("notifies the host only after a distinct eligible observation is stored", async () => {
    const onRecorded = vi.fn();
    const { recorder } = setup({ onRecorded });
    await recorder.captureNow();
    expect(onRecorded).toHaveBeenCalledOnce();
    expect(recorder.list().snapshots).toHaveLength(1);
    await recorder.captureNow();
    recorder.pause();
    await recorder.captureNow();
    expect(onRecorded).toHaveBeenCalledOnce();
  });
  it("never calls capture while disabled or paused", async () => {
    let calls = 0;
    const { recorder } = setup({
      settings: { ...settings, enabled: false },
      capture: async () => {
        calls++;
        return snapshot();
      },
    });
    expect(await recorder.captureNow()).toBeNull();
    recorder.configure({ ...settings, paused: true });
    expect(await recorder.captureNow()).toBeNull();
    expect(calls).toBe(0);
    expect(recorder.list({}).snapshots).toEqual([]);
  });

  it.each([
    [{ excludedBundleIds: ["org.djl.fixture"] }, {}],
    [{ includedBundleIds: ["org.other.app"] }, {}],
    [{ excludedDomains: ["example.com"] }, { domain: "child.example.com", webContext: true }],
    [{ includedDomains: ["allowed.example"] }, { domain: "other.example", webContext: true }],
    [{ excludedDomains: ["example.com"] }, { webContext: true }],
    [
      { excludedDomains: ["example.com"] },
      { target: { bundleId: "com.apple.Safari", pid: 123, windowId: 1 } },
    ],
    [
      { includedDomains: ["example.com"], excludedDomains: ["example.com"] },
      { domain: "example.com", webContext: true },
    ],
  ])("does not persist excluded or unresolved web contexts %j", async (policy, fields) => {
    const { recorder } = setup({
      settings: { ...settings, ...policy },
      capture: async () => snapshot("blocked", fields),
    });
    expect(await recorder.captureNow()).toBeNull();
    expect(recorder.list({}).snapshots).toEqual([]);
  });

  it("allows included subdomains, permits nonweb apps under domain policy, and rejects unknown raw fields", async () => {
    let next = snapshot("allowed", { domain: "sub.example.com", webContext: true });
    const { recorder } = setup({
      settings: { ...settings, includedDomains: ["example.com"] },
      capture: async () => next,
    });
    await recorder.captureNow();
    next = snapshot("native");
    await recorder.captureNow();
    next = { ...snapshot("bad"), value: "private input" } as ComputerActivitySnapshot;
    await expect(recorder.captureNow()).rejects.toThrow();
    expect(recorder.list({}).snapshots.map((item) => item.id)).toEqual(["native", "allowed"]);
  });

  it.each(["pause", "stop", "clear", "dispose", "configure"] as const)(
    "prevents late writes after %s and never overlaps capture",
    async (action) => {
      let resolve!: (value: ComputerActivitySnapshot) => void;
      let calls = 0;
      const { recorder } = setup({
        capture: () => {
          calls++;
          return new Promise((done) => {
            resolve = done;
          });
        },
      });
      const pending = recorder.captureNow();
      expect(await recorder.captureNow()).toBeNull();
      if (action === "configure")
        recorder.configure({ ...settings, excludedBundleIds: ["org.djl.fixture"] });
      else recorder[action]();
      resolve(snapshot());
      expect(await pending).toBeNull();
      expect(calls).toBe(1);
      expect(recorder.list({}).snapshots).toEqual([]);
    },
  );

  it("treats aborted capture rejection as cancellation", async () => {
    const { recorder } = setup({
      capture: (signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    });
    const pending = recorder.captureNow();
    recorder.pause();
    await expect(pending).resolves.toBeNull();
  });

  it("records an unchanged context again after its previous record expires", async () => {
    let now = baseTime;
    let next = snapshot("old");
    const { recorder } = setup({ now: () => now, capture: async () => next });
    await recorder.captureNow();
    now = new Date(baseTime.getTime() + 86_400_001);
    next = { ...next, id: "fresh", capturedAt: now.toISOString() };
    expect((await recorder.captureNow())?.id).toBe("fresh");
    expect(recorder.list({}).snapshots.map((item) => item.id)).toEqual(["fresh"]);
  });

  it("deduplicates adjacent contexts and writes private durable state", async () => {
    let next = snapshot("one");
    const { recorder, directory } = setup({ capture: async () => next });
    await recorder.captureNow();
    next = { ...next, id: "two", capturedAt: new Date(baseTime.getTime() + 1000).toISOString() };
    expect(await recorder.captureNow()).toBeNull();
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(directory, "activity.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(directory, "activity.json"), "utf8")).not.toContain("two");
    recorder.dispose();
    const reopened = new ComputerActivityRecorder({
      directory,
      settings,
      now: () => baseTime,
      capture: async () => null,
    });
    recorders.push(reopened);
    expect(reopened.list({}).snapshots).toHaveLength(1);
  });

  it("retains records by age, paginates and clears stored history", async () => {
    let now = baseTime;
    let next = snapshot("old");
    const { recorder, directory } = setup({ now: () => now, capture: async () => next });
    await recorder.captureNow();
    now = new Date(baseTime.getTime() + 86_400_001);
    next = snapshot("fresh", { capturedAt: now.toISOString() });
    await recorder.captureNow();
    next = snapshot("newest", { capturedAt: now.toISOString() });
    await recorder.captureNow();
    const first = recorder.list({ limit: 1 });
    expect(first.snapshots.map((item) => item.id)).toEqual(["newest"]);
    expect(
      recorder.list({ cursor: first.nextCursor!, limit: 1 }).snapshots.map((item) => item.id),
    ).toEqual(["fresh"]);
    expect(
      recorder.list({ since: now.toISOString(), until: new Date(now.getTime() + 1).toISOString() })
        .snapshots,
    ).toHaveLength(2);
    expect(recorder.list({ cursor: "missing" }).snapshots).toEqual([]);
    expect(recorder.clear()).toBe(2);
    expect(JSON.parse(readFileSync(join(directory, "activity.json"), "utf8")).snapshots).toEqual(
      [],
    );
  });

  it("summarizes only observed facts in deterministic 10-minute and 6-hour buckets", async () => {
    let next = snapshot("one");
    const { recorder } = setup({ capture: async () => next });
    await recorder.captureNow();
    next = snapshot("two", { capturedAt: "2026-10-28T11:59:00.000Z" });
    await recorder.captureNow();
    const page = recorder.list({});
    expect(page.summaries.filter((item) => item.periodSeconds === 600)).toHaveLength(2);
    expect(page.summaries.filter((item) => item.periodSeconds === 21600)).toHaveLength(2);
    for (const summary of page.summaries) {
      expect(summary.snapshotCount).toBe(1);
      expect(summary.contexts[0]?.count).toBe(1);
      expect(summary.contexts[0]?.appName).toBe("Fixture");
      expect(["one", "two"]).toContain(summary.contexts[0]?.windowTitle);
    }
    expect(recorder.list({}).summaries).toEqual(page.summaries);
    expect(() => recorder.list({ limit: 201 })).toThrow();
  });

  it("rejects malformed domain rules rather than silently ignoring exclusions", () => {
    expect(() =>
      setup({ settings: { ...settings, excludedDomains: ["https://example.com/private"] } }),
    ).toThrow();
  });

  it("enforces the hard count and byte caps on real persisted records", async () => {
    for (const large of [false, true]) {
      const { recorder, directory } = setup();
      recorder.dispose();
      const records = Array.from({ length: large ? 940 : 5000 }, (_, index) =>
        snapshot(`saved-${index}`, large ? { labels: Array(32).fill("x".repeat(256)) } : {}),
      );
      if (large) {
        while (
          Buffer.byteLength(JSON.stringify({ version: 1, snapshots: records })) + 8600 <
          8 * 1024 * 1024
        )
          records.push(
            snapshot(`saved-${records.length}`, { labels: Array(32).fill("x".repeat(256)) }),
          );
      }
      writeFileSync(
        join(directory, "activity.json"),
        JSON.stringify({ version: 1, snapshots: records }),
      );
      const reopened = new ComputerActivityRecorder({
        directory,
        settings,
        now: () => baseTime,
        capture: async () =>
          snapshot("newest", large ? { labels: Array(32).fill("x".repeat(256)) } : {}),
      });
      recorders.push(reopened);
      await reopened.captureNow();
      const stored = JSON.parse(readFileSync(join(directory, "activity.json"), "utf8"));
      expect(stored.snapshots.length).toBeLessThanOrEqual(5000);
      expect(statSync(join(directory, "activity.json")).size).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(stored.snapshots.at(-1).id).toBe("newest");
      expect(stored.snapshots.some((item: ComputerActivitySnapshot) => item.id === "saved-0")).toBe(
        false,
      );
    }
  });

  it("schedules only while enabled and resumes after pause", async () => {
    vi.useFakeTimers();
    let count = 0;
    const { recorder } = setup({ capture: async () => snapshot(String(++count)) });
    recorder.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(recorder.list({}).snapshots).toHaveLength(1);
    recorder.pause();
    await vi.advanceTimersByTimeAsync(10000);
    expect(recorder.list({}).snapshots).toHaveLength(1);
    recorder.pause(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(recorder.list({}).snapshots).toHaveLength(2);
    recorder.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(recorder.list({}).snapshots).toHaveLength(2);
  });
});

it("restores raw records after failed clear replacement while retaining its new epoch", async () => {
  const { recorder, directory } = setup();
  await recorder.captureNow();
  const epoch = recorder.observationEpoch;
  rmSync(join(directory, "activity.json"));
  mkdirSync(join(directory, "activity.json"));
  expect(() => recorder.clear()).toThrow();
  expect(recorder.observationEpoch).not.toBe(epoch);
  expect(recorder.list().snapshots.map((item) => item.id)).toEqual(["one"]);
});

it("rolls back pruning caused by a failed clear without resurrecting a pending capture", async () => {
  let now = baseTime;
  const { recorder, directory } = setup({ now: () => now });
  await recorder.captureNow();
  now = new Date(baseTime.getTime() + 2 * 86_400_000);
  rmSync(join(directory, "activity.json"));
  mkdirSync(join(directory, "activity.json"));
  expect(() => recorder.clear({ since: now.toISOString() })).toThrow();
  now = baseTime;
  expect(recorder.list().snapshots.map((item) => item.id)).toEqual(["one"]);
});

it("counts matched raw records before unrelated retention maintenance", async () => {
  let now = baseTime;
  let sample = snapshot("old", { target: { bundleId: "other.app", pid: 42, windowId: 1 } });
  const { recorder } = setup({ now: () => now, capture: async () => sample });
  await recorder.captureNow();
  now = new Date(baseTime.getTime() + 2 * 86_400_000);
  sample = snapshot("current", { capturedAt: now.toISOString() });
  await recorder.captureNow();
  expect(recorder.clear({ bundleId: "org.djl.fixture" })).toBe(1);
  expect(recorder.list().snapshots).toEqual([]);
});
