import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComputerUseHistoryEvent } from "@synara/contracts";
import { ComputerUseHistory } from "./computerUseHistory";

const directories: string[] = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "djl-computer-history-"));
  directories.push(directory);
  return { directory, history: new ComputerUseHistory(directory) };
}
const event = (id: string, at = new Date().toISOString()): ComputerUseHistoryEvent => ({
  id,
  at,
  source: "agent",
  type: "action",
  sessionId: "session",
  actionType: "type",
  target: { bundleId: "dev.djl.fixture", pid: 123, windowId: 12 },
  acknowledgement: "dispatched",
  effect: "unverified",
});
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("sanitized computer-use history", () => {
  it("caps retained storage and paginates with stable event IDs", () => {
    const { directory, history } = setup();
    const settings = history.getSettings();
    const events = Array.from({ length: 5_000 }, (_, index) => ({
      threadId: "owner",
      event: event(`id-${index}`),
    }));
    writeFileSync(
      join(directory, "operations.json"),
      JSON.stringify({ version: 1, settings, events }),
    );
    const reloaded = new ComputerUseHistory(directory);
    reloaded.append("owner", event("newest"));
    const stored = JSON.parse(readFileSync(join(directory, "operations.json"), "utf8"));
    expect(stored.events).toHaveLength(5_000);
    expect(stored.events[0].event.id).toBe("id-1");
    const first = reloaded.list({ threadId: "owner", limit: 2 });
    expect(first.events.map((item) => item.id)).toEqual(["newest", "id-4999"]);
    expect(
      reloaded
        .list({ threadId: "owner", cursor: first.nextCursor!, limit: 2 })
        .events.map((item) => item.id),
    ).toEqual(["id-4998", "id-4997"]);
    expect(reloaded.list({ threadId: "someone-else", cursor: first.nextCursor! }).events).toEqual(
      [],
    );
  });

  it("applies retention on reloading and keeps settings independent of the action log", () => {
    const { directory, history } = setup();
    const settings = {
      ...history.getSettings(),
      enabled: true,
      paused: true,
      retentionDays: 1,
      excludedDomains: ["example.test"],
    };
    history.configure(settings);
    writeFileSync(
      join(directory, "operations.json"),
      JSON.stringify({
        version: 1,
        settings,
        events: [
          {
            threadId: "owner",
            event: event("old", new Date(Date.now() - 2 * 86_400_000).toISOString()),
          },
          { threadId: "owner", event: event("current") },
        ],
      }),
    );
    const reloaded = new ComputerUseHistory(directory);
    expect(reloaded.getSettings()).toEqual(settings);
    expect(reloaded.list({}).events.map((item) => item.id)).toEqual(["current"]);
    expect(readFileSync(join(directory, "operations.json"), "utf8")).not.toContain('"id":"old"');
    reloaded.clear();
    expect(new ComputerUseHistory(directory).getSettings()).toEqual(settings);
    expect(new ComputerUseHistory(directory).list({}).events).toEqual([]);
  });

  it("deletes expired persisted records when history is read after the retention window", () => {
    const { directory, history } = setup();
    history.append("owner", event("expired"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 86_400_000);
    try {
      expect(history.list({}).events).toEqual([]);
      expect(readFileSync(join(directory, "operations.json"), "utf8")).not.toContain(
        '"id":"expired"',
      );
    } finally {
      clock.mockRestore();
    }
  });

  it("rejects content-bearing event fields and oversized files instead of loading them", () => {
    const { directory, history } = setup();
    expect(() =>
      history.append("owner", { ...event("secret"), text: "SECRET" } as ComputerUseHistoryEvent),
    ).toThrow();
    writeFileSync(join(directory, "operations.json"), Buffer.alloc(8 * 1024 * 1024 + 1, 120));
    expect(() => new ComputerUseHistory(directory)).toThrow("Invalid computer-use history file");
  });
});

describe("persisted host pause", () => {
  it("restarts with a canonical deadline, preserves policy edits and clears resume/disable/indefinite", () => {
    const { directory, history } = setup();
    const settings = { ...history.getSettings(), enabled: true, paused: true };
    const deadline = "2026-12-31T12:00:00.000Z";
    history.configure(settings, deadline);
    const reloaded = new ComputerUseHistory(directory);
    expect(reloaded.getState()).toEqual({ ...settings, pauseResumeAt: deadline });
    expect(reloaded.getSettings()).toEqual(settings);
    reloaded.configure({ ...settings, retentionDays: 10 });
    expect(reloaded.getState().pauseResumeAt).toBe(deadline);
    reloaded.configure({ ...settings, paused: false });
    expect(reloaded.getState().pauseResumeAt).toBeUndefined();
    reloaded.configure(settings, deadline);
    reloaded.configure({ ...settings, enabled: false });
    expect(reloaded.getState().pauseResumeAt).toBeUndefined();
    reloaded.configure(settings, deadline);
    reloaded.configure(settings, null);
    expect(new ComputerUseHistory(directory).getState()).toEqual(settings);
  });
  it("rejects invalid persisted deadlines and rolls back settings/deadline/pruned events on rename failure", () => {
    const { directory, history } = setup();
    const settings = { ...history.getSettings(), enabled: true, paused: true };
    history.configure(settings, "2026-12-31T12:00:00.000Z");
    history.append("owner", event("retained", new Date(Date.now() - 2 * 86_400_000).toISOString()));
    const previous = history.getState();
    rmSync(join(directory, "operations.json"));
    mkdirSync(join(directory, "operations.json"));
    expect(() => history.configure({ ...settings, retentionDays: 1 }, null)).toThrow();
    expect(history.getState()).toEqual(previous);
    expect(history.list({}).events.map((item) => item.id)).toEqual(["retained"]);
    rmSync(join(directory, "operations.json"), { recursive: true });
    for (const state of [
      { settings, pauseResumeAt: "bad" },
      { settings: { ...settings, paused: false }, pauseResumeAt: "2026-12-31T12:00:00.000Z" },
      { settings, pauseResumeAt: "2026-12-31T12:00:00Z" },
    ]) {
      writeFileSync(
        join(directory, "operations.json"),
        JSON.stringify({ version: 1, events: [], ...state }),
      );
      expect(() => new ComputerUseHistory(directory)).toThrow();
    }
  });
});

it("rolls back action append and clear memory after a failed atomic replacement", () => {
  const { directory, history } = setup();
  history.append("owner", event("kept"));
  rmSync(join(directory, "operations.json"));
  mkdirSync(join(directory, "operations.json"));
  expect(() => history.append("owner", event("not-committed"))).toThrow();
  expect(history.list({}).events.map((item) => item.id)).toEqual(["kept"]);
  expect(() => history.clear()).toThrow();
  expect(history.list({}).events.map((item) => item.id)).toEqual(["kept"]);
});

it("rolls back an actual temporary-file write failure without leaking temporary files", () => {
  const { directory, history } = setup();
  const previous = history.getState();
  renameSync(directory, `${directory}-moved`);
  try {
    expect(() =>
      history.configure(
        { ...history.getSettings(), enabled: true, paused: true },
        "2026-12-31T12:00:00.000Z",
      ),
    ).toThrow();
    expect(history.getState()).toEqual(previous);
  } finally {
    renameSync(`${directory}-moved`, directory);
  }
  expect(readdirSync(directory)).toEqual(["operations.json"]);
});

it("reloads a strict pending clear marker without exposing it as history settings", () => {
  const { directory, history } = setup();
  const file = join(directory, "operations.json");
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      settings: history.getSettings(),
      events: [],
      pendingActivityClear: {},
    }),
  );
  const reopened = new ComputerUseHistory(directory);
  expect(JSON.parse(readFileSync(file, "utf8")).pendingActivityClear).toEqual({});
  expect(reopened.getState()).not.toHaveProperty("pendingActivityClear");
});

it("preserves and clones pending scope across operations rewrites and rolls back failed marker commits", () => {
  const { history, directory } = setup();
  const deadline = "2026-12-31T12:00:00.000Z";
  history.configure({ ...history.getSettings(), enabled: true, paused: true }, deadline);
  const scope = { bundleId: "org.djl.fixture", since: "2026-10-28T12:00:00.000Z" };
  history.beginActivityClear(scope);
  scope.bundleId = "caller.changed";
  const returned = history.getPendingActivityClear()!;
  (returned as { bundleId?: string }).bundleId = "returned.changed";
  history.append("owner", event("kept"));
  history.list({});
  history.clear();
  history.configure({ ...history.getSettings(), retentionDays: 7 });
  const reopened = new ComputerUseHistory(directory);
  expect(reopened.getPendingActivityClear()).toEqual({
    bundleId: "org.djl.fixture",
    since: scope.since,
  });
  expect(reopened.getState().pauseResumeAt).toBe(deadline);
  expect(() => reopened.beginActivityClear({})).toThrow();
  expect(() => reopened.finishActivityClear({})).toThrow();
  rmSync(join(directory, "operations.json"));
  mkdirSync(join(directory, "operations.json"));
  expect(() =>
    reopened.finishActivityClear({ since: scope.since, bundleId: "org.djl.fixture" }),
  ).toThrow();
  expect(reopened.getPendingActivityClear()).toEqual({
    bundleId: "org.djl.fixture",
    since: scope.since,
  });
  rmSync(join(directory, "operations.json"), { recursive: true });
  reopened.finishActivityClear({ since: scope.since, bundleId: "org.djl.fixture" });
  expect(new ComputerUseHistory(directory).getPendingActivityClear()).toBeUndefined();
});

it.each([
  null,
  { extra: true },
  { since: "2026-10-28T12:00:00Z" },
  { since: "2026-10-29T12:00:00.000Z", until: "2026-10-28T12:00:00.000Z" },
  { bundleId: " " },
])("fails closed on malformed pending clear %j", (marker) => {
  const { directory, history } = setup();
  writeFileSync(
    join(directory, "operations.json"),
    JSON.stringify({
      version: 1,
      settings: history.getSettings(),
      events: [],
      pendingActivityClear: marker,
    }),
  );
  expect(() => new ComputerUseHistory(directory)).toThrow();
});

it.each([
  {},
  { since: "2026-10-28T12:00:00.000Z" },
  { until: "2026-10-28T12:00:00.000Z" },
  { bundleId: "org.djl.fixture" },
  {
    since: "2026-10-28T12:00:00.000Z",
    until: "2026-10-28T12:00:00.000Z",
    bundleId: "org.djl.fixture",
  },
])("persists valid pending scope %j and rolls back initial marker failure", (scope) => {
  const { directory, history } = setup();
  renameSync(directory, `${directory}-moved`);
  try {
    expect(() => history.beginActivityClear(scope)).toThrow();
    expect(history.getPendingActivityClear()).toBeUndefined();
  } finally {
    renameSync(`${directory}-moved`, directory);
  }
  history.beginActivityClear(scope);
  expect(new ComputerUseHistory(directory).getPendingActivityClear()).toEqual(scope);
});
