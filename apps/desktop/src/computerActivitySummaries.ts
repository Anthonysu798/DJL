import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import {
  ComputerActivitySemanticSummary,
  ComputerUseHistorySettings,
  ComputerUseTarget,
  decodeComputerActivityEvent,
  decodeComputerActivitySemanticContent,
  decodeComputerActivitySemanticSummary,
  decodeComputerActivitySnapshot,
  decodeComputerActivitySummaryJob,
  decodeComputerActivityScope,
  type ComputerActivityEvent,
  type ComputerActivitySnapshot,
  type ComputerActivitySummaryJob,
  type ComputerActivitySummaryStatus,
} from "@synara/contracts";
import { isComputerActivityAllowed, boundedActivityItems } from "./computerActivityRecorder";
import { redactComputerActivityText as redact } from "./computerActivityRedaction";

type Evidence = ComputerActivitySnapshot | ComputerActivityEvent;
type Failure = NonNullable<ComputerActivitySummaryStatus["lastFailure"]>;
const MAX_ENTRIES = 5_000;
const MAX_BYTES = 32 * 1024 * 1024;
const SETTLE_MS = 30_000;
const LEASE_MS = 180_000;
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Context = Schema.Struct({
  target: ComputerUseTarget,
  observedAt: Schema.String.check(Schema.isMaxLength(24)),
  domain: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(253))),
  webContext: Schema.optionalKey(Schema.Boolean),
});
const Entry = Schema.Struct({
  id: Id,
  periodSeconds: Schema.Literals([600, 21_600]),
  startedAt: Schema.String.check(Schema.isMaxLength(24)),
  endedAt: Schema.String.check(Schema.isMaxLength(24)),
  sourceIds: Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  dependencies: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(12))),
  sourceFingerprint: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  applications: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(
    Schema.isMaxLength(100),
  ),
  contexts: Schema.Array(Context).check(Schema.isMaxLength(18_432)),
  totalRecords: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 })),
  phase: Schema.Literals(["pending", "running", "failed", "ready"]),
  attempts: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
  nextAttemptAt: Schema.Finite,
  lastFailure: Schema.optionalKey(
    Schema.Literals([
      "provider-unavailable",
      "authentication",
      "invalid-output",
      "timeout",
      "generation-failed",
    ]),
  ),
  failedAt: Schema.optionalKey(Schema.Finite),
  blockedByCapacity: Schema.optionalKey(Schema.Literal(true)),
  summary: Schema.optionalKey(ComputerActivitySemanticSummary),
});
type Entry = typeof Entry.Type;
const Store = Schema.Struct({
  version: Schema.Literal(1),
  discardedBefore: Schema.Finite,
  entries: Schema.Array(Entry).check(Schema.isMaxLength(MAX_ENTRIES)),
});
const key = (entry: { periodSeconds: number; startedAt: string }) =>
  `${entry.periodSeconds}:${entry.startedAt}`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sameSuggestion = (
  a: NonNullable<ComputerActivitySemanticSummary["content"]["suggestion"]>,
  b: typeof a,
) => a.type === b.type && a.name === b.name && a.description === b.description;

// The desktop owns this store and evidence callback. Models can complete only a
// current opaque lease through a separate host-authenticated integration.
export class ComputerActivitySummaries {
  private entries = new Map<string, Entry>();
  private generation = randomUUID();
  private lease: { job: ComputerActivitySummaryJob; entryKey: string } | undefined;
  private settings: ComputerUseHistorySettings;
  private discardedBefore = 0;
  private disposed = false;
  private clearHeld = false;
  private savedJson: string | undefined;
  private readonly file: string;
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      directory: string;
      settings: ComputerUseHistorySettings;
      readEvidence: () => readonly Evidence[];
      now?: () => Date;
      onChanged?: () => void;
    },
  ) {
    this.settings = structuredClone(
      Schema.decodeUnknownSync(ComputerUseHistorySettings)(options.settings, {
        onExcessProperty: "error",
      }),
    );
    this.now = options.now ?? (() => new Date());
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    const directory = lstatSync(options.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error("Semantic history requires a private directory");
    chmodSync(options.directory, 0o700);
    this.file = join(options.directory, "semantic-summaries.json");
    try {
      const stat = lstatSync(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
        throw new Error("Invalid semantic history store");
      const stored = Schema.decodeUnknownSync(Store)(JSON.parse(readFileSync(this.file, "utf8")), {
        onExcessProperty: "error",
      });
      this.discardedBefore = stored.discardedBefore;
      for (const entry of stored.entries) {
        this.validateEntry(entry);
        if (this.entries.has(key(entry))) throw new Error("Duplicate semantic history interval");
        this.entries.set(
          key(entry),
          entry.phase === "running"
            ? {
                ...entry,
                phase: "pending",
                attempts: Math.max(0, entry.attempts - 1),
                nextAttemptAt: 0,
              }
            : entry,
        );
      }
      chmodSync(this.file, 0o600);
      this.save(new Map(this.entries));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private get enabled(): boolean {
    return (
      !this.disposed &&
      !this.clearHeld &&
      this.settings.enabled &&
      !this.settings.paused &&
      this.settings.semanticSummariesEnabled === true
    );
  }

  // Host-only fence: no persistence, pruning, evidence reads or reconciliation.
  holdActivityClear(): void {
    this.clearHeld = true;
    this.generation = randomUUID();
    this.lease = undefined;
  }

  releaseActivityClear(): void {
    this.clearHeld = false;
  }

  configure(settings: ComputerUseHistorySettings): void {
    const decoded = Schema.decodeUnknownSync(ComputerUseHistorySettings)(settings, {
      onExcessProperty: "error",
    });
    this.settings = structuredClone(decoded);
    this.invalidate();
    this.reconcile();
  }

  private invalidate(): void {
    this.generation = randomUUID();
    this.lease = undefined;
    const next = new Map(this.entries);
    for (const [id, entry] of next)
      if (entry.phase === "running")
        next.set(id, {
          ...entry,
          phase: "pending",
          attempts: Math.max(0, entry.attempts - 1),
          nextAttemptAt: 0,
        });
    this.save(next);
  }

  private evidence(): Evidence[] {
    if (this.clearHeld || this.disposed) throw new Error("History clear recovery is required");
    const cutoff = this.now().getTime() - this.settings.retentionDays * 86_400_000;
    const ids = new Set<string>();
    return this.options
      .readEvidence()
      .map((raw) =>
        structuredClone(
          "kind" in raw ? decodeComputerActivityEvent(raw) : decodeComputerActivitySnapshot(raw),
        ),
      )
      .filter((record) => {
        if (ids.has(record.id)) throw new Error("Duplicate activity evidence identifier");
        ids.add(record.id);
        const at = Date.parse(record.capturedAt);
        return (
          Number.isFinite(at) &&
          new Date(at).toISOString() === record.capturedAt &&
          at >= cutoff &&
          at <= this.now().getTime() &&
          isComputerActivityAllowed(record, this.settings)
        );
      })
      .toSorted((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
  }

  private candidate(
    periodSeconds: 600 | 21600,
    startedAt: string,
    endedAt: string,
    sources: readonly {
      id: string;
      applications: readonly string[];
      contexts: readonly (typeof Context.Type)[];
    }[],
    fingerprint: string,
    totalRecords: number,
  ): Entry {
    const candidate: Entry = {
      id: `semantic-${periodSeconds}-${Math.floor(Date.parse(startedAt) / 1000)}-${fingerprint.slice(0, 16)}`,
      periodSeconds,
      startedAt,
      endedAt,
      sourceIds: sources.map((source) => source.id),
      sourceFingerprint: fingerprint,
      applications: [...new Set(sources.flatMap((source) => source.applications))].toSorted(),
      contexts: [
        ...new Map(
          sources
            .flatMap((source) => source.contexts)
            .map((context) => [JSON.stringify(context), context]),
        ).values(),
      ],
      totalRecords,
      phase: "pending",
      attempts: 0,
      nextAttemptAt: 0,
    };
    if (candidate.applications.length > 100 || candidate.contexts.length > 18_432)
      return {
        ...candidate,
        // A capacity failure contains no model payload. Preserve all child IDs;
        // never manufacture a partial semantic result or truncate its lineage.
        contexts: [],
        applications: [],
        phase: "failed",
        attempts: 3,
        lastFailure: "generation-failed",
        failedAt: this.now().getTime(),
        blockedByCapacity: true,
      };
    return candidate;
  }

  private reconcile(): void {
    if (this.clearHeld || this.disposed) return;
    this.prune();
    const next = new Map(this.entries);
    if (this.enabled) {
      const buckets = new Map<number, Evidence[]>();
      for (const record of this.evidence()) {
        const bucket = Math.floor(Date.parse(record.capturedAt) / 600_000);
        const records = buckets.get(bucket) ?? [];
        records.push(record);
        buckets.set(bucket, records);
      }
      for (const [bucket, records] of buckets) {
        const start = bucket * 600_000,
          end = start + 600_000;
        if (start < this.discardedBefore || end > this.now().getTime() - SETTLE_MS) continue;
        const applications = new Set(
          [...new Set(records.toReversed().map((record) => record.target.bundleId))].slice(0, 100),
        );
        const selected = records
          .filter((record) => applications.has(record.target.bundleId))
          .slice(-500);
        const fingerprint = hash(selected);
        const candidate = this.candidate(
          600,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
          selected.map((record) => ({
            id: record.id,
            applications: [record.target.bundleId],
            contexts: [
              {
                target: record.target,
                observedAt: record.capturedAt,
                ...(record.domain ? { domain: record.domain } : {}),
                ...("webContext" in record && record.webContext !== undefined
                  ? { webContext: record.webContext }
                  : {}),
              },
            ],
          })),
          fingerprint,
          records.length,
        );
        const previous = next.get(key(candidate));
        if (previous?.sourceFingerprint === fingerprint) continue;
        if (
          previous?.phase === "ready" &&
          candidate.sourceIds.every((id) => previous.sourceIds.includes(id))
        )
          continue;
        next.set(key(candidate), {
          ...candidate,
          totalRecords: Math.max(previous?.totalRecords ?? 0, candidate.totalRecords),
        });
      }
      const rollups = new Map<number, Entry[]>();
      for (const entry of next.values())
        if (
          entry.periodSeconds === 600 &&
          entry.phase === "ready" &&
          entry.contexts.every((context) => isComputerActivityAllowed(context, this.settings))
        ) {
          const bucket = Math.floor(Date.parse(entry.startedAt) / 21_600_000);
          const children = rollups.get(bucket) ?? [];
          children.push(entry);
          rollups.set(bucket, children);
        }
      for (const [bucket, children] of rollups) {
        const start = bucket * 21_600_000,
          end = start + 21_600_000;
        if (start < this.discardedBefore || end > this.now().getTime() - SETTLE_MS) continue;
        if (
          [...next.values()].some(
            (entry) =>
              entry.periodSeconds === 600 &&
              Date.parse(entry.startedAt) >= start &&
              Date.parse(entry.endedAt) <= end &&
              entry.phase !== "ready" &&
              entry.contexts.every((context) => isComputerActivityAllowed(context, this.settings)),
          )
        )
          continue;
        children.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        const fingerprint = hash(children.map((child) => [child.id, child.summary]));
        const candidate = this.candidate(
          21600,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
          children.map((child) => ({
            id: child.id,
            applications: child.summary!.content.applications,
            contexts: child.contexts,
          })),
          fingerprint,
          children.length,
        );
        const previous = next.get(key(candidate));
        if (previous?.sourceFingerprint === fingerprint) continue;
        if (
          previous?.phase === "ready" &&
          candidate.sourceIds.every((id) => previous.sourceIds.includes(id))
        )
          continue;
        next.set(key(candidate), candidate);
      }
    }
    if (JSON.stringify([...next]) !== JSON.stringify([...this.entries])) this.save(next);
    else this.prune();
    if (this.lease && this.entries.get(this.lease.entryKey)?.id !== this.lease.job.id)
      this.lease = undefined;
  }

  claim(): ComputerActivitySummaryJob | null {
    if (this.clearHeld || this.disposed) return null;
    this.expire();
    this.reconcile();
    if (!this.enabled || this.lease) return null;
    const entry = [...this.entries.values()]
      .filter(
        (entry) =>
          entry.phase !== "ready" &&
          entry.phase !== "running" &&
          !entry.blockedByCapacity &&
          entry.attempts < 3 &&
          entry.nextAttemptAt <= this.now().getTime() &&
          Date.parse(entry.endedAt) <= this.now().getTime() - SETTLE_MS &&
          entry.contexts.every((context) => isComputerActivityAllowed(context, this.settings)),
      )
      .toSorted(
        (a, b) => a.startedAt.localeCompare(b.startedAt) || a.periodSeconds - b.periodSeconds,
      )[0];
    if (!entry) return null;
    const common = {
      id: entry.id,
      leaseId: randomUUID(),
      generation: this.generation,
      expiresAt: new Date(this.now().getTime() + LEASE_MS).toISOString(),
      periodSeconds: entry.periodSeconds,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      sourceIds: entry.sourceIds,
      applications: entry.applications,
      sourceFingerprint: entry.sourceFingerprint,
      omittedRecordCount: Math.max(0, entry.totalRecords - entry.sourceIds.length),
    };
    let job: ComputerActivitySummaryJob;
    let contexts = entry.contexts;
    let dependencies: readonly string[] = [];
    if (entry.periodSeconds === 600) {
      const sources = this.evidence().filter((record) => entry.sourceIds.includes(record.id));
      if (sources.length !== entry.sourceIds.length) {
        const next = new Map(this.entries);
        next.set(key(entry), {
          ...entry,
          phase: "failed",
          attempts: 3,
          lastFailure: "generation-failed",
          failedAt: this.now().getTime(),
        });
        this.save(next);
        return null;
      }
      const lines = sources.map((record) =>
        JSON.stringify({
          id: record.id,
          capturedAt: record.capturedAt,
          bundleId: record.target.bundleId,
          context: this.sourceText(record),
        }),
      );
      const budget = Math.max(128, Math.floor(120_000 / lines.length));
      const material = lines
        .map((line) =>
          line.length <= budget ? line : `${line.slice(0, budget)} [context truncated]`,
        )
        .join("\n");
      const previous = [...this.entries.values()]
        .filter(
          (previous) =>
            previous.summary &&
            previous.endedAt <= entry.startedAt &&
            Date.parse(previous.endedAt) >= Date.parse(entry.startedAt) - 21_600_000 &&
            previous.contexts.every((context) => isComputerActivityAllowed(context, this.settings)),
        )
        .toSorted((a, b) => b.endedAt.localeCompare(a.endedAt))
        .slice(0, 12);
      contexts = sources.map((record) => ({
        target: record.target,
        observedAt: record.capturedAt,
        ...(record.domain ? { domain: record.domain } : {}),
        ...("webContext" in record && record.webContext !== undefined
          ? { webContext: record.webContext }
          : {}),
      }));
      const previousSummaries: ComputerActivitySemanticSummary[] = [];
      const applications = new Set(sources.map((record) => record.target.bundleId));
      const knownContexts = new Map(contexts.map((context) => [JSON.stringify(context), context]));
      for (const prior of previous) {
        const expanded = new Map(knownContexts);
        for (const context of prior.contexts) expanded.set(JSON.stringify(context), context);
        const appIds = new Set([...applications, ...prior.summary!.content.applications]);
        if (expanded.size > 18_432 || appIds.size > 100) continue;
        previousSummaries.push(prior.summary!);
        for (const [id, context] of expanded) knownContexts.set(id, context);
        for (const app of appIds) applications.add(app);
      }
      contexts = [...knownContexts.values()];
      dependencies = previousSummaries.map((summary) => summary.id);
      job = decodeComputerActivitySummaryJob({
        ...common,
        sourceIds: [...entry.sourceIds, ...dependencies],
        applications: [...applications].toSorted(),
        periodSeconds: 600,
        material,
        previousSummaries,
      });
    } else {
      const children = entry.sourceIds.map(
        (id) => [...this.entries.values()].find((child) => child.id === id)?.summary,
      );
      if (children.some((child) => !child)) return null;
      job = decodeComputerActivitySummaryJob({ ...common, periodSeconds: 21600, children });
    }
    const next = new Map(this.entries);
    next.set(key(entry), {
      ...entry,
      dependencies,
      contexts,
      applications: job.applications,
      phase: "running",
      attempts: entry.attempts + 1,
    });
    this.save(next);
    this.lease = { job, entryKey: key(entry) };
    this.options.onChanged?.();
    return structuredClone(job);
  }

  private sourceText(record: Evidence): string {
    const parts = {
      appName: redact(record.appName),
      windowTitle: redact(record.windowTitle),
      ...(record.domain ? { domain: record.domain } : {}),
      ...("labels" in record
        ? { labels: record.labels.map(redact) }
        : {
            kind: record.kind,
            ...(record.text !== undefined ? { text: redact(record.text) } : {}),
            ...(record.keyEquivalent ? { keyEquivalent: redact(record.keyEquivalent) } : {}),
            ...(record.modifiers ? { modifiers: record.modifiers } : {}),
            ...(record.mouse ? { mouse: record.mouse } : {}),
            ...(record.selection
              ? {
                  selection: {
                    ...record.selection,
                    ...(record.selection.text !== undefined
                      ? { text: redact(record.selection.text) }
                      : {}),
                  },
                }
              : {}),
            ...(record.ax ? { ax: { mode: record.ax.mode, text: redact(record.ax.text) } } : {}),
          }),
    };
    return JSON.stringify(parts);
  }

  valid(leaseId: string): boolean {
    if (this.clearHeld || this.disposed) return false;
    this.expire();
    this.reconcile();
    return (
      this.enabled &&
      this.lease?.job.leaseId === leaseId &&
      this.lease.job.generation === this.generation
    );
  }

  complete(
    leaseId: string,
    raw: unknown,
    provenance: { provider: string; model: string },
  ): boolean {
    if (!this.valid(leaseId)) return false;
    const lease = this.lease!,
      entry = this.entries.get(lease.entryKey)!;
    let content = structuredClone(decodeComputerActivitySemanticContent(raw));
    if (
      !content.applications.every((id) => lease.job.applications.includes(id)) ||
      !content.citations.every((id) => lease.job.sourceIds.includes(id))
    )
      throw new Error("Semantic output invented source provenance");
    content = {
      ...content,
      title: redact(content.title),
      description: redact(content.description),
      memory: redact(content.memory),
      recording: redact(content.recording),
      ...(content.suggestion
        ? {
            suggestion: {
              ...content.suggestion,
              name: redact(content.suggestion.name),
              description: redact(content.suggestion.description),
            },
          }
        : {}),
    };
    if (content.suggestion) {
      if (
        lease.job.periodSeconds === 21600 &&
        !lease.job.children.some(
          (child) =>
            child.content.suggestion &&
            sameSuggestion(child.content.suggestion, content.suggestion!),
        )
      )
        throw new Error("Rollup invented a new suggestion");
      const normalize = (value: string) =>
        value
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .trim();
      if (
        lease.job.periodSeconds === 600 &&
        [...this.entries.values()].some(
          (previous) =>
            previous.summary?.content.suggestion &&
            previous.startedAt < entry.startedAt &&
            Date.parse(previous.startedAt) >= Date.parse(entry.startedAt) - 3_600_000 &&
            (normalize(previous.summary.content.suggestion.name) ===
              normalize(content.suggestion!.name) ||
              normalize(previous.summary.content.suggestion.description) ===
                normalize(content.suggestion!.description)),
        )
      ) {
        const { suggestion: _suggestion, ...withoutSuggestion } = content;
        content = withoutSuggestion;
      }
    }
    const summary = decodeComputerActivitySemanticSummary({
      id: entry.id,
      periodSeconds: entry.periodSeconds,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      generatedAt: this.now().toISOString(),
      sourceIds: lease.job.sourceIds,
      sourceFingerprint: entry.sourceFingerprint,
      provider: provenance.provider,
      model: provenance.model,
      content,
    });
    const { lastFailure: _failure, failedAt: _failedAt, ...clean } = entry;
    const next = new Map(this.entries);
    next.set(lease.entryKey, { ...clean, phase: "ready", summary });
    this.save(next);
    this.lease = undefined;
    this.options.onChanged?.();
    return this.entries.get(lease.entryKey)?.summary?.id === summary.id;
  }

  fail(leaseId: string, code: Failure): boolean {
    const lease = this.lease;
    if (
      !this.enabled ||
      !lease ||
      lease.job.leaseId !== leaseId ||
      lease.job.generation !== this.generation
    )
      return false;
    const entry = this.entries.get(lease.entryKey);
    if (!entry || entry.id !== lease.job.id) return false;
    const next = new Map(this.entries);
    next.set(lease.entryKey, {
      ...entry,
      phase: "failed",
      lastFailure: code,
      failedAt: this.now().getTime(),
      nextAttemptAt: this.now().getTime() + Math.min(300_000, 60_000 * 2 ** (entry.attempts - 1)),
    });
    this.save(next);
    this.lease = undefined;
    this.options.onChanged?.();
    return true;
  }

  private expire(): void {
    if (this.lease && Date.parse(this.lease.job.expiresAt) <= this.now().getTime())
      this.fail(this.lease.job.leaseId, "timeout");
  }

  retry(): void {
    if (this.clearHeld || this.disposed) return;
    const next = new Map(this.entries);
    for (const [id, entry] of next)
      if (entry.phase === "failed" && !entry.blockedByCapacity)
        next.set(id, { ...entry, phase: "pending", attempts: 0, nextAttemptAt: 0 });
    this.save(next);
    this.options.onChanged?.();
  }

  list(
    options: {
      since?: string;
      until?: string;
      bundleId?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ): {
    summaries: ComputerActivitySemanticSummary[];
    status: ComputerActivitySummaryStatus;
    nextCursor?: string;
  } {
    if (this.clearHeld || this.disposed) throw new Error("History clear recovery is required");
    const { cursor: _cursor, limit: _limit, ...scope } = options;
    decodeComputerActivityScope(scope);
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new Error("Invalid semantic page size");
    this.expire();
    this.reconcile();
    const since = options.since === undefined ? -Infinity : Date.parse(options.since),
      until = options.until === undefined ? Infinity : Date.parse(options.until);
    if (Number.isNaN(since) || Number.isNaN(until) || since > until)
      throw new Error("Invalid semantic history interval");
    const values = [...this.entries.values()];
    const matchingEntries = values.filter(
      (entry) =>
        entry.summary &&
        entry.contexts.some(
          (context) =>
            Date.parse(context.observedAt) >= since &&
            Date.parse(context.observedAt) < until &&
            (!options.bundleId || context.target.bundleId === options.bundleId),
        ),
    );
    const matchingById = new Map(matchingEntries.map((entry) => [entry.id, entry]));
    const covered = new Set<string>();
    for (const rollup of matchingEntries) {
      if (rollup.periodSeconds !== 21600) continue;
      for (const id of rollup.summary!.sourceIds) {
        const child = matchingById.get(id);
        if (
          child?.periodSeconds === 600 &&
          child.startedAt >= rollup.startedAt &&
          child.endedAt <= rollup.endedAt
        )
          covered.add(id);
      }
    }
    const matching = matchingEntries
      .filter((entry) => !covered.has(entry.id))
      .map((entry) => {
        const summary = structuredClone(entry.summary!);
        if (
          this.now().getTime() - Date.parse(summary.generatedAt) > 172_800_000 &&
          summary.content.suggestion
        ) {
          const { suggestion: _suggestion, ...content } = summary.content;
          return { ...summary, content };
        }
        return summary;
      })
      .toSorted(
        (a, b) => b.startedAt.localeCompare(a.startedAt) || b.periodSeconds - a.periodSeconds,
      );
    const index = options.cursor
      ? matching.findIndex((summary) => summary.id === options.cursor)
      : -1;
    const summaries =
      options.cursor && index < 0 ? [] : boundedActivityItems(matching.slice(index + 1), limit);
    const last = summaries.at(-1);
    const lastFailure = values
      .filter((entry) => entry.phase !== "ready" && entry.lastFailure)
      .toSorted((a, b) => (b.failedAt ?? 0) - (a.failedAt ?? 0))[0]?.lastFailure;
    return {
      summaries,
      ...(last && index + 1 + summaries.length < matching.length ? { nextCursor: last.id } : {}),
      status: {
        enabled: this.enabled,
        pending: values.filter(
          (entry) =>
            entry.phase !== "ready" &&
            entry.phase !== "running" &&
            entry.attempts < 3 &&
            entry.contexts.every((context) => isComputerActivityAllowed(context, this.settings)),
        ).length,
        running: this.lease !== undefined,
        ...(lastFailure ? { lastFailure } : {}),
      },
    };
  }

  // Caller removes the corresponding raw evidence first. Invalidating the epoch
  // prevents an in-flight provider response from recreating erased derivations.
  clear(scope: { since?: string; until?: string; bundleId?: string } = {}): number {
    decodeComputerActivityScope(scope);
    const since = scope.since === undefined ? -Infinity : Date.parse(scope.since),
      until = scope.until === undefined ? Infinity : Date.parse(scope.until);
    if (Number.isNaN(since) || Number.isNaN(until) || since > until)
      throw new Error("Invalid semantic clear interval");
    this.generation = randomUUID();
    this.lease = undefined;
    const next = new Map(this.entries);
    let removed = 0;
    const erased = new Set<string>();
    for (const [id, entry] of next) {
      const affected = entry.contexts.some(
        (context) =>
          (!scope.bundleId || context.target.bundleId === scope.bundleId) &&
          (context.observedAt
            ? Date.parse(context.observedAt) >= since && Date.parse(context.observedAt) < until
            : Date.parse(entry.endedAt) > since && Date.parse(entry.startedAt) < until),
      );
      if (affected) {
        if (entry.summary) removed++;
        erased.add(entry.id);
        next.delete(id);
      } else if (entry.phase === "running")
        next.set(id, {
          ...entry,
          phase: "pending",
          attempts: Math.max(0, entry.attempts - 1),
          nextAttemptAt: 0,
        });
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, entry] of next)
        if (
          [...entry.sourceIds, ...(entry.dependencies ?? [])].some((source) => erased.has(source))
        ) {
          if (entry.summary) removed++;
          erased.add(entry.id);
          next.delete(id);
          changed = true;
        }
    }
    this.save(next);
    this.options.onChanged?.();
    return removed;
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }

  private validateEntry(entry: Entry): void {
    const start = Date.parse(entry.startedAt),
      end = Date.parse(entry.endedAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      new Date(start).toISOString() !== entry.startedAt ||
      new Date(end).toISOString() !== entry.endedAt ||
      end - start !== entry.periodSeconds * 1000 ||
      new Set(entry.sourceIds).size !== entry.sourceIds.length ||
      (!entry.blockedByCapacity && entry.contexts.length === 0) ||
      new Set(entry.applications).size !== entry.applications.length ||
      new Set(entry.dependencies ?? []).size !== (entry.dependencies ?? []).length ||
      (entry.dependencies ?? []).some((id) => entry.sourceIds.includes(id)) ||
      entry.sourceIds.length + (entry.dependencies ?? []).length > 512 ||
      entry.contexts.some(
        (context) =>
          !Number.isFinite(Date.parse(context.observedAt)) ||
          new Date(context.observedAt).toISOString() !== context.observedAt ||
          Date.parse(context.observedAt) >= end,
      ) ||
      (entry.blockedByCapacity === true &&
        (entry.periodSeconds !== 21_600 ||
          entry.phase !== "failed" ||
          entry.attempts !== 3 ||
          entry.contexts.length !== 0 ||
          entry.applications.length !== 0 ||
          entry.summary !== undefined)) ||
      (entry.phase === "ready") !== (entry.summary !== undefined)
    )
      throw new Error("Invalid semantic history entry");
    if (
      entry.summary &&
      (entry.summary.id !== entry.id ||
        entry.summary.periodSeconds !== entry.periodSeconds ||
        entry.summary.startedAt !== entry.startedAt ||
        entry.summary.endedAt !== entry.endedAt ||
        entry.summary.sourceFingerprint !== entry.sourceFingerprint ||
        JSON.stringify(entry.summary.sourceIds) !==
          JSON.stringify([...entry.sourceIds, ...(entry.dependencies ?? [])]) ||
        !entry.summary.content.applications.every((app) => entry.applications.includes(app)))
    )
      throw new Error("Invalid stored semantic provenance");
  }

  private prune(): void {
    this.save(new Map(this.entries));
  }

  private save(entries: Map<string, Entry>): void {
    const cutoff = this.now().getTime() - this.settings.retentionDays * 86_400_000;
    let discardedBefore = this.discardedBefore;
    let rows = [...entries.values()]
      .filter(
        (entry) =>
          Date.parse(entry.startedAt) >= Math.max(cutoff, discardedBefore) &&
          entry.contexts.every(
            (context) => Date.parse(context.observedAt) >= Math.max(cutoff, discardedBefore),
          ),
      )
      .toSorted(
        (a, b) => a.startedAt.localeCompare(b.startedAt) || a.periodSeconds - b.periodSeconds,
      );
    let json = JSON.stringify({ version: 1, discardedBefore, entries: rows });
    while (rows.length > MAX_ENTRIES || Buffer.byteLength(json) > MAX_BYTES) {
      const removed = rows.splice(0, Math.max(1, Math.ceil(rows.length / 10)));
      discardedBefore = Math.max(
        discardedBefore,
        ...removed.map((entry) => Date.parse(entry.endedAt)),
      );
      rows = rows.filter(
        (entry) =>
          Date.parse(entry.startedAt) >= discardedBefore &&
          entry.contexts.every((context) => Date.parse(context.observedAt) >= discardedBefore),
      );
      json = JSON.stringify({ version: 1, discardedBefore, entries: rows });
    }
    for (const entry of rows) {
      Schema.decodeUnknownSync(Entry)(entry, { onExcessProperty: "error" });
      this.validateEntry(entry);
    }
    if (json === this.savedJson) return;
    const temporary = join(this.options.directory, `.semantic-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, json, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.file);
    } finally {
      rmSync(temporary, { force: true });
    }
    this.entries = new Map(rows.map((entry) => [key(entry), entry]));
    if (this.lease) {
      const retained = this.entries.get(this.lease.entryKey);
      if (
        !retained ||
        retained.phase !== "running" ||
        retained.id !== this.lease.job.id ||
        JSON.stringify([...retained.sourceIds, ...(retained.dependencies ?? [])]) !==
          JSON.stringify(this.lease.job.sourceIds)
      )
        this.lease = undefined;
    }
    this.discardedBefore = discardedBefore;
    this.savedJson = json;
  }
}
