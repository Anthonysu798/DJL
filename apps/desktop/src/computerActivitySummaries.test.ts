import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ComputerActivitySemanticContent,
  ComputerActivitySnapshot,
  ComputerActivitySummaryJob,
  ComputerUseHistorySettings,
} from "@synara/contracts";
import { ComputerActivitySummaries } from "./computerActivitySummaries";

const directories: string[] = [];
const settings: ComputerUseHistorySettings = {
  enabled: true,
  paused: false,
  semanticSummariesEnabled: true,
  interactionCaptureEnabled: false,
  retentionDays: 30,
  intervalSeconds: 30,
  excludedBundleIds: [],
  excludedDomains: [],
};
function evidence(
  id: string,
  at = "2026-10-28T12:01:00.000Z",
  bundleId = "org.djl.fixture",
): ComputerActivitySnapshot {
  return {
    id,
    capturedAt: at,
    target: { bundleId, pid: 42, windowId: 7 },
    appName: "Synthetic fixture",
    windowTitle: "Draft review",
    labels: ["The synthetic draft was approved"],
  };
}
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "djl-semantic-history-test-"));
  directories.push(directory);
  const state = { now: new Date("2026-10-28T12:10:31.000Z"), evidence: [evidence("source-1")] };
  const options = { directory, settings, readEvidence: () => state.evidence, now: () => state.now };
  return { directory, state, store: new ComputerActivitySummaries(options), options };
}
function claim(store: ComputerActivitySummaries): ComputerActivitySummaryJob {
  const job = store.claim();
  expect(job).not.toBeNull();
  if (!job) throw new Error("Expected a synthetic job");
  return job;
}
function content(
  job: ComputerActivitySummaryJob,
  extra: Partial<ComputerActivitySemanticContent> = {},
): ComputerActivitySemanticContent {
  return {
    title: "Approve the synthetic draft",
    description: "You revised the synthetic draft. You approved its wording.",
    applications: job.applications,
    memory: "The user revised and approved the synthetic draft.",
    recording: "The fixture changed from a draft to approved text.",
    citations: job.sourceIds,
    ...extra,
  };
}
function complete(
  store: ComputerActivitySummaries,
  job: ComputerActivitySummaryJob,
  extra: Partial<ComputerActivitySemanticContent> = {},
) {
  return store.complete(job.leaseId, content(job, extra), {
    provider: "opencode",
    model: "synthetic/model",
  });
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("durable semantic activity jobs", () => {
  it("matches semantic app/time filters against the same observed lineage used for clearing", () => {
    const { store } = setup();
    complete(store, claim(store));
    expect(store.list({ until: "2026-10-28T12:01:00.000Z" }).summaries).toEqual([]);
    expect(
      store.list({ since: "2026-10-28T12:01:00.000Z", until: "2026-10-28T12:01:00.000Z" })
        .summaries,
    ).toEqual([]);
    expect(store.clear({ until: "2026-10-28T12:01:00.000Z" })).toBe(0);
    expect(
      store.list({
        since: "2026-10-28T12:01:00.000Z",
        until: "2026-10-28T12:01:00.001Z",
        bundleId: "org.djl.fixture",
      }).summaries,
    ).toHaveLength(1);
    expect(
      store.clear({
        since: "2026-10-28T12:01:00.000Z",
        until: "2026-10-28T12:01:00.001Z",
        bundleId: "org.djl.fixture",
      }),
    ).toBe(1);
  });
  it("matches application and time on one contributing observation", () => {
    const { store, state } = setup();
    complete(store, claim(store));
    state.evidence.push(evidence("source-b", "2026-10-28T12:12:00.000Z", "org.djl.other"));
    state.now = new Date("2026-10-28T12:20:31.000Z");
    complete(store, claim(store));
    const scope = {
      since: "2026-10-28T12:10:00.000Z",
      until: "2026-10-28T12:20:00.000Z",
      bundleId: "org.djl.fixture",
    };
    expect(store.list(scope).summaries).toEqual([]);
    expect(store.clear(scope)).toBe(0);
    expect(store.list().summaries).toHaveLength(2);
  });

  it("paginates semantic content under a byte budget and validates scoped bounds", () => {
    const { store, state } = setup();
    for (let index = 0; index < 25; index++) {
      if (index)
        state.evidence.push(
          evidence(
            `source-${index + 1}`,
            new Date(Date.parse("2026-10-28T12:01:00.000Z") + index * 600_000).toISOString(),
          ),
        );
      state.now = new Date(Date.parse("2026-10-28T12:10:31.000Z") + index * 600_000);
      complete(store, claim(store), { memory: "\0".repeat(8192), recording: "\0".repeat(8192) });
    }
    const first = store.list({ limit: 200 });
    expect(first.summaries.length).toBeLessThan(25);
    expect(first.nextCursor).toBeDefined();
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(2 * 1024 * 1024 + 4096);
    const second = store.list({ cursor: first.nextCursor!, limit: 200 });
    expect(
      new Set([...first.summaries, ...second.summaries].map((summary) => summary.id)).size,
    ).toBe(25);
    expect(() => store.clear({ until: "2026-02-30T00:00:00.000Z" })).toThrow();
    expect(() => store.list({ since: "2026-02-30T00:00:00.000Z" })).toThrow();
    expect(store.list({ cursor: "missing" }).summaries).toEqual([]);
  });
  it("requires separate semantic consent and a settled closed window", () => {
    const { store, state } = setup();
    store.configure({ ...settings, semanticSummariesEnabled: false });
    expect(store.claim()).toBeNull();
    store.configure(settings);
    state.now = new Date("2026-10-28T12:10:29.000Z");
    expect(store.claim()).toBeNull();
    state.now = new Date("2026-10-28T12:10:31.000Z");
    const job = claim(store);
    expect(job.periodSeconds).toBe(600);
    expect(job.sourceIds).toEqual(["source-1"]);
    if (job.periodSeconds === 600) expect(job.material).toContain("draft was approved");
    expect(store.claim()).toBeNull();
  });

  it("persists semantic content and provenance without regenerating completed windows", () => {
    const { store, directory, options } = setup();
    const job = claim(store);
    expect(complete(store, job)).toBe(true);
    expect(store.list().summaries[0]).toMatchObject({
      id: job.id,
      provider: "opencode",
      model: "synthetic/model",
      sourceIds: ["source-1"],
      content: { title: "Approve the synthetic draft" },
    });
    expect(store.claim()).toBeNull();
    const reopened = new ComputerActivitySummaries(options);
    expect(reopened.claim()).toBeNull();
    expect(reopened.list().summaries).toHaveLength(1);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(directory, "semantic-summaries.json")).mode & 0o777).toBe(0o600);
  });

  it("recovers interrupted jobs with a fresh generation and lease", () => {
    const { store, options } = setup();
    const first = claim(store);
    store.dispose();
    expect(complete(store, first)).toBe(false);
    const reopened = new ComputerActivitySummaries(options);
    const resumed = claim(reopened);
    expect(resumed.id).toBe(first.id);
    expect(resumed.leaseId).not.toBe(first.leaseId);
    expect(resumed.generation).not.toBe(first.generation);
    expect(reopened.valid(first.leaseId)).toBe(false);
  });

  it("rejects late output after pause, policy change and deletion", () => {
    const { store, state } = setup();
    const first = claim(store);
    store.configure({ ...settings, paused: true });
    expect(store.valid(first.leaseId)).toBe(false);
    expect(complete(store, first)).toBe(false);
    store.configure(settings);
    const second = claim(store);
    store.configure({ ...settings, excludedBundleIds: ["org.djl.fixture"] });
    expect(complete(store, second)).toBe(false);
    expect(store.claim()).toBeNull();
    store.configure(settings);
    const third = claim(store);
    state.evidence = [];
    store.clear();
    expect(complete(store, third)).toBe(false);
    expect(store.list().summaries).toEqual([]);
    expect(store.claim()).toBeNull();
  });

  it("rejects invented application and citation provenance", () => {
    const { store } = setup();
    const job = claim(store);
    expect(() => complete(store, job, { applications: ["org.unobserved.app"] })).toThrow();
    expect(() => complete(store, job, { citations: ["unobserved-source"] })).toThrow();
    expect(store.valid(job.leaseId)).toBe(true);
    expect(store.list().summaries).toEqual([]);
  });

  it("backs off provider failure without substituting counts, then supports explicit retry", () => {
    const { store, state } = setup();
    let job = claim(store);
    expect(store.fail(job.leaseId, "authentication")).toBe(true);
    expect(store.list()).toMatchObject({
      summaries: [],
      status: { lastFailure: "authentication", running: false },
    });
    expect(store.claim()).toBeNull();
    state.now = new Date(state.now.getTime() + 60_001);
    job = claim(store);
    store.fail(job.leaseId, "provider-unavailable");
    state.now = new Date(state.now.getTime() + 120_001);
    job = claim(store);
    store.fail(job.leaseId, "generation-failed");
    state.now = new Date(state.now.getTime() + 600_000);
    expect(store.claim()).toBeNull();
    store.retry();
    expect(claim(store).id).toBe(job.id);
  });

  it("expires leases and rejects completion of expired work", () => {
    const { store, state } = setup();
    const job = claim(store);
    state.now = new Date(Date.parse(job.expiresAt) + 1);
    expect(store.valid(job.leaseId)).toBe(false);
    expect(complete(store, job)).toBe(false);
    expect(store.list().status.lastFailure).toBe("timeout");
  });

  it("builds a real six-hour job from all completed semantic children", () => {
    const { store, state } = setup();
    state.evidence.push(evidence("source-2", "2026-10-28T12:12:00.000Z"));
    state.now = new Date("2026-10-28T18:00:31.000Z");
    const first = claim(store);
    expect(first.periodSeconds).toBe(600);
    complete(store, first);
    const second = claim(store);
    expect(second.periodSeconds).toBe(600);
    complete(store, second);
    const parent = claim(store);
    expect(parent.periodSeconds).toBe(21600);
    if (parent.periodSeconds === 21600)
      expect(parent.children.map((child) => child.id)).toEqual([first.id, second.id]);
    expect(parent.sourceIds).toEqual([first.id, second.id]);
    complete(store, parent);
    expect(store.list().summaries.some((summary) => summary.periodSeconds === 21600)).toBe(true);
  });

  it("hides covered children before limit-one pagination while retaining their provenance", () => {
    const { store, state, directory, options } = setup();
    state.evidence.push(evidence("source-2", "2026-10-28T12:12:00.000Z"));
    state.now = new Date("2026-10-28T18:00:31.000Z");
    const first = claim(store);
    complete(store, first);
    const second = claim(store);
    complete(store, second);
    expect(store.list().summaries.map((summary) => summary.id)).toEqual([second.id, first.id]);
    const parent = claim(store);
    expect(store.list().summaries.map((summary) => summary.id)).toEqual([second.id, first.id]);
    complete(store, parent);
    state.evidence.push(evidence("newer-source", "2026-10-28T18:01:00.000Z"));
    state.now = new Date("2026-10-28T18:10:31.000Z");
    const newer = claim(store);
    complete(store, newer);
    const file = join(directory, "semantic-summaries.json");
    const retained = readFileSync(file, "utf8");

    const page = store.list({ limit: 1 });
    expect(page.summaries.map((summary) => summary.id)).toEqual([newer.id]);
    expect(page.nextCursor).toBe(newer.id);
    const next = store.list({ limit: 1, cursor: page.nextCursor! });
    expect(next.summaries.map((summary) => summary.id)).toEqual([parent.id]);
    expect(next.nextCursor).toBeUndefined();
    expect(store.list({ cursor: second.id }).summaries).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(retained);
    const entries = JSON.parse(retained).entries;
    expect(entries.find((entry: { id: string }) => entry.id === first.id).summary).toMatchObject({
      sourceIds: ["source-1"],
      content: { citations: ["source-1"] },
    });
    expect(entries.find((entry: { id: string }) => entry.id === parent.id).summary).toMatchObject({
      sourceIds: [first.id, second.id],
      content: { citations: [first.id, second.id] },
    });
    const reopened = new ComputerActivitySummaries(options);
    expect(reopened.list().summaries.map((summary) => summary.id)).toEqual([newer.id, parent.id]);
  });

  it("requires both explicit rollup references and full interval containment in valid persisted fixtures", () => {
    const { store, state, directory, options } = setup();
    state.evidence.push(
      evidence("source-2", "2026-10-28T12:12:00.000Z"),
      evidence("unreferenced-source", "2026-10-28T12:22:00.000Z"),
      evidence("late-source", "2026-10-28T18:01:00.000Z"),
    );
    state.now = new Date("2026-10-28T18:10:31.000Z");
    const first = claim(store);
    complete(store, first);
    const second = claim(store);
    complete(store, second);
    const unrelated = claim(store);
    complete(store, unrelated);
    const parent = claim(store);
    complete(store, parent);
    const late = claim(store);
    complete(store, late);
    const file = join(directory, "semantic-summaries.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    const rollup = saved.entries.find((entry: { id: string }) => entry.id === parent.id);
    // Valid persisted synthetic interval: first/late cross its bounds; second is contained.
    rollup.startedAt = rollup.summary.startedAt = "2026-10-28T12:05:00.000Z";
    rollup.endedAt = rollup.summary.endedAt = "2026-10-28T18:05:00.000Z";
    rollup.sourceIds = rollup.summary.sourceIds = [first.id, second.id, late.id];
    rollup.summary.content.citations = [first.id, second.id, late.id];
    writeFileSync(file, JSON.stringify(saved));

    const reopened = new ComputerActivitySummaries({
      ...options,
      settings: { ...settings, paused: true },
    });
    expect(reopened.list().summaries.map((summary) => summary.id)).toEqual([
      late.id,
      unrelated.id,
      parent.id,
      first.id,
    ]);
  });

  it("does not use a scoped nonmatching rollup to hide a matching child", () => {
    const { store, state, directory, options } = setup();
    state.evidence.push(evidence("source-2", "2026-10-28T12:12:00.000Z", "org.djl.other"));
    state.now = new Date("2026-10-28T18:00:31.000Z");
    const first = claim(store);
    complete(store, first);
    const second = claim(store);
    complete(store, second);
    const parent = claim(store);
    complete(store, parent);
    const file = join(directory, "semantic-summaries.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    const rollup = saved.entries.find((entry: { id: string }) => entry.id === parent.id);
    // Valid persisted synthetic lineage with no parent observation in the queried app/time.
    rollup.contexts = [rollup.contexts[0]];
    writeFileSync(file, JSON.stringify(saved));
    const reopened = new ComputerActivitySummaries({
      ...options,
      settings: { ...settings, paused: true },
    });
    expect(reopened.list().summaries.map((summary) => summary.id)).toEqual([parent.id]);
    expect(
      reopened
        .list({
          since: "2026-10-28T12:10:00.000Z",
          until: "2026-10-28T12:20:00.000Z",
          bundleId: "org.djl.other",
        })
        .summaries.map((summary) => summary.id),
    ).toEqual([second.id]);
  });

  it("reveals retained children after their rollup is removed from a valid persisted store", () => {
    const { store, state, directory, options } = setup();
    state.now = new Date("2026-10-28T18:00:31.000Z");
    const child = claim(store);
    complete(store, child);
    const parent = claim(store);
    complete(store, parent);
    expect(store.list().summaries.map((summary) => summary.id)).toEqual([parent.id]);
    const file = join(directory, "semantic-summaries.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved.entries = saved.entries.filter((entry: { id: string }) => entry.id !== parent.id);
    writeFileSync(file, JSON.stringify(saved));
    const reopened = new ComputerActivitySummaries({
      ...options,
      settings: { ...settings, paused: true },
    });
    expect(reopened.list().summaries.map((summary) => summary.id)).toEqual([child.id]);
    expect(reopened.list().status).toMatchObject({ enabled: false, pending: 0, running: false });
  });

  it("clears overlapping sources and rollups while preserving unrelated summaries", () => {
    const { store, state } = setup();
    state.now = new Date("2026-10-28T18:00:31.000Z");
    const first = claim(store);
    complete(store, first);
    complete(store, claim(store));
    state.evidence.push(evidence("source-2", "2026-10-29T12:12:00.000Z", "org.djl.other"));
    state.now = new Date("2026-10-29T18:00:31.000Z");
    const second = claim(store);
    complete(store, second);
    const rollup = claim(store);
    state.evidence = state.evidence.filter((record) => record.id !== "source-1");
    store.clear({ since: "2026-10-28T12:00:00.000Z", until: "2026-10-28T12:10:00.000Z" });
    expect(complete(store, rollup)).toBe(false);
    expect(store.list().summaries.map((summary) => summary.id)).toEqual([second.id]);
    const replacement = claim(store);
    expect(replacement.periodSeconds).toBe(21600);
    expect(replacement.sourceIds).toEqual([second.id]);
  });

  it("tracks provided prior summaries and cascades deletion even without a model citation", () => {
    const { store, state, options } = setup();
    const first = claim(store);
    complete(store, first);
    state.evidence.push(evidence("source-2", "2026-10-28T12:12:00.000Z"));
    state.now = new Date("2026-10-28T12:20:31.000Z");
    const second = claim(store);
    expect(second.sourceIds).toEqual(["source-2", first.id]);
    if (second.periodSeconds === 600)
      expect(second.previousSummaries.map((summary) => summary.id)).toEqual([first.id]);
    complete(store, second, { citations: ["source-2"] });
    const reopened = new ComputerActivitySummaries(options);
    state.evidence = state.evidence.filter((record) => record.id !== "source-1");
    expect(reopened.clear({ until: "2026-10-28T12:10:00.000Z" })).toBe(2);
    expect(reopened.list().summaries).toEqual([]);
    const clean = claim(reopened);
    expect(clean.sourceIds).toEqual(["source-2"]);
    if (clean.periodSeconds === 600) expect(clean.previousSummaries).toEqual([]);
  });

  it("never sends excluded prior summary context into a later allowed job", () => {
    const { store, state } = setup();
    const first = claim(store);
    complete(store, first, { memory: "Synthetic excluded-app context." });
    state.evidence.push(evidence("source-2", "2026-10-28T12:12:00.000Z", "org.djl.other"));
    state.now = new Date("2026-10-28T12:20:31.000Z");
    store.configure({ ...settings, excludedBundleIds: ["org.djl.fixture"] });
    const job = claim(store);
    expect(job.sourceIds).toEqual(["source-2"]);
    if (job.periodSeconds === 600) expect(job.previousSummaries).toEqual([]);
  });

  it("expires every derivation of older context and regenerates from retained evidence", () => {
    const { store, state } = setup();
    complete(store, claim(store));
    state.evidence.push(evidence("source-2", "2026-10-28T12:12:00.000Z"));
    state.now = new Date("2026-10-28T12:20:31.000Z");
    const second = claim(store);
    complete(store, second, { citations: ["source-2"] });
    state.now = new Date("2026-10-29T12:05:31.000Z");
    store.configure({ ...settings, retentionDays: 1 });
    expect(store.list().summaries).toEqual([]);
    const clean = claim(store);
    expect(clean.sourceIds).toEqual(["source-2"]);
    if (clean.periodSeconds === 600) expect(clean.previousSummaries).toEqual([]);
    expect(complete(store, second)).toBe(false);
  });

  it("rejects an in-flight derivation once any provided observation expires", () => {
    const { store, state } = setup();
    const first = claim(store);
    complete(store, first);
    state.evidence.push(evidence("source-2", "2026-10-28T12:12:00.000Z"));
    store.configure({ ...settings, retentionDays: 1 });
    state.now = new Date("2026-10-29T12:00:00.000Z");
    const second = claim(store);
    expect(second.sourceIds).toContain(first.id);
    // Keep the lease TTL live while the wall clock crosses the oldest source horizon.
    state.now = new Date("2026-10-29T12:01:01.000Z");
    expect(Date.parse(second.expiresAt)).toBeGreaterThan(state.now.getTime());
    expect(complete(store, second)).toBe(false);
    expect(store.list().summaries).toEqual([]);
  });

  it("reports a non-generatable oversized rollup while unrelated jobs still proceed", () => {
    const { store, state, options } = setup();
    state.evidence = Array.from({ length: 51 }, (_, index) =>
      evidence(`a-${index}`, "2026-10-28T12:01:00.000Z", `org.a.${index}`),
    );
    state.evidence.push(
      ...Array.from({ length: 51 }, (_, index) =>
        evidence(`b-${index}`, "2026-10-28T12:11:00.000Z", `org.b.${index}`),
      ),
    );
    state.now = new Date("2026-10-28T12:20:31.000Z");
    complete(store, claim(store));
    complete(store, claim(store));
    state.now = new Date("2026-10-28T18:00:31.000Z");
    expect(() => store.list()).not.toThrow();
    expect(store.list()).toMatchObject({
      summaries: expect.any(Array),
      status: { lastFailure: "generation-failed" },
    });
    expect(store.list().summaries).toHaveLength(2);
    expect(store.claim()).toBeNull();
    store.retry();
    expect(store.claim()).toBeNull();
    const reopened = new ComputerActivitySummaries(options);
    expect(reopened.list().status.lastFailure).toBe("generation-failed");
    state.evidence.push(evidence("unrelated", "2026-10-28T18:01:00.000Z", "org.unrelated"));
    state.now = new Date("2026-10-28T18:10:31.000Z");
    expect(claim(reopened).sourceIds[0]).toBe("unrelated");
  });

  it("keeps oversized transitive context unions from blocking an otherwise valid store", () => {
    const { store, state, options, directory } = setup();
    complete(store, claim(store));
    state.evidence.push(evidence("source-2", "2026-10-28T12:12:00.000Z"));
    state.now = new Date("2026-10-28T12:20:31.000Z");
    complete(store, claim(store));
    const file = join(directory, "semantic-summaries.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    // Two individually bounded synthetic private lineage sets, one union over capacity.
    saved.entries.forEach((entry: { contexts: unknown[] }, index: number) => {
      entry.contexts = Array.from({ length: 10_000 }, (_, window) => ({
        target: { bundleId: "org.djl.fixture", pid: 42, windowId: index * 10_000 + window + 1 },
        observedAt: index === 0 ? "2026-10-28T12:01:00.000Z" : "2026-10-28T12:12:00.000Z",
      }));
    });
    writeFileSync(file, JSON.stringify(saved));
    state.now = new Date("2026-10-28T18:00:31.000Z");
    const reopened = new ComputerActivitySummaries(options);
    expect(reopened.list().summaries).toHaveLength(2);
    expect(reopened.list().status.lastFailure).toBe("generation-failed");
    expect(reopened.claim()).toBeNull();
    const failure = JSON.parse(readFileSync(file, "utf8")).entries.find(
      (entry: { periodSeconds: number }) => entry.periodSeconds === 21600,
    );
    expect(failure).toMatchObject({
      phase: "failed",
      blockedByCapacity: true,
      contexts: [],
      applications: [],
    });
    expect(failure.sourceIds).toHaveLength(2);
    expect(failure.summary).toBeUndefined();
  });

  it("does not allow callers to mutate leased evidence or persisted content", () => {
    const { store } = setup();
    const job = claim(store);
    const output = content(job);
    store.complete(job.leaseId, output, { provider: "fixture", model: "synthetic" });
    (output as { title: string }).title = "Changed after commit";
    const page = store.list();
    (page.summaries[0]!.content as { title: string }).title = "Changed returned page";
    expect(store.list().summaries[0]!.content.title).toBe("Approve the synthetic draft");
  });

  it("fails closed for symlinked and oversized persistence", () => {
    const { directory, options } = setup();
    const file = join(directory, "semantic-summaries.json");
    const other = join(directory, "untouched.json");
    writeFileSync(other, "synthetic untouched file");
    symlinkSync(other, file);
    expect(() => new ComputerActivitySummaries(options)).toThrow();
    expect(readFileSync(other, "utf8")).toBe("synthetic untouched file");
    rmSync(file);
    writeFileSync(file, "");
    truncateSync(file, 32 * 1024 * 1024 + 1);
    expect(() => new ComputerActivitySummaries(options)).toThrow();
  });

  it("rejects corrupted interval provenance and invalid runtime failure codes", () => {
    const { store, directory, options } = setup();
    const job = claim(store);
    expect(() => store.fail(job.leaseId, "invented" as never)).toThrow();
    expect(store.valid(job.leaseId)).toBe(true);
    complete(store, job);
    const file = join(directory, "semantic-summaries.json");
    const stored = JSON.parse(readFileSync(file, "utf8"));
    stored.entries[0].summary.startedAt = "2026-10-28T13:00:00.000Z";
    stored.entries[0].summary.endedAt = "2026-10-28T13:10:00.000Z";
    stored.entries[0].summary.generatedAt = "2026-10-28T13:10:31.000Z";
    writeFileSync(file, JSON.stringify(stored));
    expect(() => new ComputerActivitySummaries(options)).toThrow();
  });

  it("deduplicates prior-hour suggestions and limits rollups to an existing child suggestion", () => {
    const { store, state } = setup();
    const suggestion = {
      type: "skill" as const,
      name: "Draft review",
      description: "Turn my draft review steps into a reusable skill.",
    };
    const first = claim(store);
    complete(store, first, { suggestion });
    state.evidence.push(evidence("source-2", "2026-10-28T12:12:00.000Z"));
    state.now = new Date("2026-10-28T18:00:31.000Z");
    const second = claim(store);
    complete(store, second, { suggestion });
    expect(
      store.list().summaries.find((summary) => summary.id === second.id)?.content.suggestion,
    ).toBeUndefined();
    const parent = claim(store);
    expect(() =>
      complete(store, parent, { suggestion: { ...suggestion, name: "Invented workflow" } }),
    ).toThrow();
    complete(store, parent, { suggestion });
    state.now = new Date("2026-10-31T18:00:31.000Z");
    expect(store.list().summaries.every((summary) => !summary.content.suggestion)).toBe(true);
  });

  it("redacts known secret patterns before model input and persisted semantic text", () => {
    const { store, state, directory } = setup();
    const secret = "sk-proj-" + "A".repeat(40);
    state.evidence[0] = {
      ...state.evidence[0]!,
      labels: [`API_KEY=${secret}`, "Card 4111 1111 1111 1111"],
    };
    const job = claim(store);
    if (job.periodSeconds === 600) {
      expect(job.material).not.toContain(secret);
      expect(job.material).not.toContain("4111 1111 1111 1111");
    }
    complete(store, job, { memory: `The user saw API_KEY=${secret}.` });
    expect(readFileSync(join(directory, "semantic-summaries.json"), "utf8")).not.toContain(secret);
  });
});

it("remains unclaimable when disposal persistence fails", () => {
  const { store, directory, options } = setup();
  claim(store);
  rmSync(join(directory, "semantic-summaries.json"));
  mkdirSync(join(directory, "semantic-summaries.json"));
  expect(() => store.dispose()).toThrow();
  rmSync(join(directory, "semantic-summaries.json"), { recursive: true });
  options.readEvidence = () => {
    throw new Error("Unexpected evidence read after disposal");
  };
  expect(store.claim()).toBeNull();
});

it("holds leases and every semantic entry point without persistence or evidence reads", () => {
  const { store, options, directory } = setup();
  const job = claim(store);
  const before = readFileSync(join(directory, "semantic-summaries.json"), "utf8");
  options.readEvidence = () => {
    throw new Error("Unexpected evidence read");
  };
  store.holdActivityClear();
  expect(readFileSync(join(directory, "semantic-summaries.json"), "utf8")).toBe(before);
  expect(store.claim()).toBeNull();
  expect(store.valid(job.leaseId)).toBe(false);
  expect(store.complete(job.leaseId, null, { provider: "synthetic", model: "synthetic" })).toBe(
    false,
  );
  expect(store.fail(job.leaseId, "generation-failed")).toBe(false);
  expect(() => store.retry()).not.toThrow();
  expect(() => store.list()).toThrow("History clear recovery is required");
  expect(store.clear()).toBe(0);
  store.releaseActivityClear();
  options.readEvidence = () => [];
  expect(store.valid(job.leaseId)).toBe(false);
  expect(store.list().summaries).toEqual([]);
});

it("keeps the last confirmed semantic state private after failed clear and permits a real retry", () => {
  const { store, directory, state } = setup();
  complete(store, claim(store));
  const file = join(directory, "semantic-summaries.json");
  const before = readFileSync(file, "utf8");
  store.holdActivityClear();
  rmSync(file);
  mkdirSync(file);
  expect(() => store.clear()).toThrow();
  expect(() => store.list()).toThrow("History clear recovery is required");
  expect(store.claim()).toBeNull();
  rmSync(file, { recursive: true });
  writeFileSync(file, before);
  state.evidence = [];
  expect(store.clear()).toBe(1);
  store.releaseActivityClear();
  expect(store.list().summaries).toEqual([]);
  expect(JSON.parse(readFileSync(file, "utf8")).entries).toEqual([]);
});
