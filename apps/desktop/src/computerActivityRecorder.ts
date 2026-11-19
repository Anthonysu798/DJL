import { randomUUID } from "node:crypto";
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
  ComputerActivitySnapshot,
  ComputerActivityEvent,
  ComputerUseHistorySettings,
  decodeComputerActivityEvent,
  decodeComputerActivityScope,
  decodeComputerActivitySnapshot,
  type ComputerActivityPage,
  type ComputerActivitySummary,
} from "@synara/contracts";
import { redactComputerActivityText as redact } from "./computerActivityRedaction";

const MAX_SNAPSHOTS = 5_000;
const MAX_BYTES = 8 * 1024 * 1024;
// Raw records, count summaries, and semantic summaries each get one bounded
// section, keeping the combined response below the existing 8MiB bridge limit.
export function boundedActivityItems<T>(items: readonly T[], limit: number): T[] {
  const selected: T[] = [];
  let bytes = 2;
  for (const item of items.slice(0, limit)) {
    bytes += Buffer.byteLength(JSON.stringify(item)) + 1;
    if (bytes > 2 * 1024 * 1024) break;
    selected.push(item);
  }
  return selected;
}
const Store = Schema.Struct({
  version: Schema.Literal(1),
  snapshots: Schema.Array(ComputerActivitySnapshot).check(Schema.isMaxLength(MAX_SNAPSHOTS)),
  events: Schema.optionalKey(
    Schema.Array(ComputerActivityEvent).check(Schema.isMaxLength(MAX_SNAPSHOTS)),
  ),
});
const isBrowser = (snapshot: Pick<ComputerActivitySnapshot, "target" | "domain" | "webContext">) =>
  snapshot.webContext === true ||
  /safari|chrome|chromium|firefox|brave|edge|vivaldi|opera|browser|company\.thebrowser|kagi\.kagimac/i.test(
    snapshot.target.bundleId,
  );
const matchesDomain = (domain: string, rule: string) => {
  const normalized = rule.trim().toLowerCase().replace(/\.$/, "");
  return domain === normalized || domain.endsWith(`.${normalized}`);
};

export function isComputerActivityAllowed(
  snapshot: Pick<ComputerActivitySnapshot, "target" | "domain" | "webContext">,
  settings: ComputerUseHistorySettings,
): boolean {
  const bundle = snapshot.target.bundleId.toLowerCase();
  if (settings.excludedBundleIds.some((item) => item.toLowerCase() === bundle)) return false;
  if (
    settings.includedBundleIds?.length &&
    !settings.includedBundleIds.some((item) => item.toLowerCase() === bundle)
  )
    return false;
  if (!snapshot.domain)
    return (
      !isBrowser(snapshot) || !(settings.includedDomains?.length || settings.excludedDomains.length)
    );
  if (settings.excludedDomains.some((rule) => matchesDomain(snapshot.domain!, rule))) return false;
  return (
    !settings.includedDomains?.length ||
    settings.includedDomains.some((rule) => matchesDomain(snapshot.domain!, rule))
  );
}
function contextKey(snapshot: ComputerActivitySnapshot): string {
  const { id: _id, capturedAt: _capturedAt, ...context } = snapshot;
  return JSON.stringify(context);
}

function summaries(snapshots: readonly ComputerActivitySnapshot[]): {
  summaries: ComputerActivitySummary[];
  truncated: boolean;
} {
  const result: ComputerActivitySummary[] = [];
  let truncated = false;
  for (const periodSeconds of [600, 21_600] as const) {
    const buckets = new Map<number, ComputerActivitySnapshot[]>();
    for (const snapshot of snapshots) {
      const bucket = Math.floor(Date.parse(snapshot.capturedAt) / (periodSeconds * 1000));
      const records = buckets.get(bucket) ?? [];
      records.push(snapshot);
      buckets.set(bucket, records);
    }
    if (buckets.size > 100) truncated = true;
    for (const [bucket, records] of [...buckets.entries()]
      .toSorted(([a], [b]) => b - a)
      .slice(0, 100)) {
      const contexts = new Map<string, ComputerActivitySummary["contexts"][number]>();
      for (const record of records) {
        const key = JSON.stringify([record.target.bundleId, record.appName, record.windowTitle]);
        const existing = contexts.get(key);
        contexts.set(key, {
          bundleId: record.target.bundleId,
          appName: record.appName,
          windowTitle: record.windowTitle,
          count: (existing?.count ?? 0) + 1,
        });
      }
      if (contexts.size > 200) truncated = true;
      result.push({
        id: `summary-${periodSeconds}-${bucket}`,
        periodSeconds,
        startedAt: new Date(bucket * periodSeconds * 1000).toISOString(),
        endedAt: new Date((bucket + 1) * periodSeconds * 1000).toISOString(),
        snapshotCount: records.length,
        contexts: [...contexts.values()]
          .toSorted(
            (a, b) => b.count - a.count || JSON.stringify(a).localeCompare(JSON.stringify(b)),
          )
          .slice(0, 200),
      });
    }
  }
  return {
    summaries: result.toSorted(
      (a, b) => b.startedAt.localeCompare(a.startedAt) || a.periodSeconds - b.periodSeconds,
    ),
    truncated,
  };
}

// The host owns directory/settings; model requests never supply a filesystem path.
// Native capture must enforce this same policy before reading app/window AX content.
export class ComputerActivityRecorder {
  private settings: ComputerUseHistorySettings;
  private snapshots: ComputerActivitySnapshot[] = [];
  private events: ComputerActivityEvent[] = [];
  private epoch = randomUUID();
  private readonly file: string;
  private readonly now: () => Date;
  private generation = 0;
  private pending: AbortController | undefined;
  private running = false;
  private stopped = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly options: {
      directory: string;
      settings: ComputerUseHistorySettings;
      capture: (signal?: AbortSignal) => Promise<ComputerActivitySnapshot | null>;
      onRecorded?: () => void;
      now?: () => Date;
      onError?: (error: unknown) => void;
    },
  ) {
    this.settings = this.decodeSettings(options.settings);
    this.now = options.now ?? (() => new Date());
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    const directoryStat = lstatSync(options.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
      throw new Error("Activity history requires a private directory");
    chmodSync(options.directory, 0o700);
    this.file = join(options.directory, "activity.json");
    try {
      const stat = lstatSync(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
        throw new Error("Invalid activity history file");
      const stored = Schema.decodeUnknownSync(Store)(JSON.parse(readFileSync(this.file, "utf8")), {
        onExcessProperty: "error",
      });
      this.snapshots = [...stored.snapshots];
      this.events = [...(stored.events ?? [])];
      chmodSync(this.file, 0o600);
      if (this.prune()) this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  configure(settings: ComputerUseHistorySettings): ComputerUseHistorySettings {
    const decoded = this.decodeSettings(settings);
    this.invalidate();
    this.settings = decoded;
    if (this.prune()) this.persist();
    this.schedule();
    return structuredClone(this.settings);
  }

  start(): void {
    if (this.disposed) return;
    this.stopped = false;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.stopped = true;
    this.invalidate();
  }

  pause(paused = true): void {
    this.configure({ ...this.settings, paused });
  }

  // Host-only authority for the private native stream, never renderer/MCP input.
  get observationEpoch(): string {
    return this.epoch;
  }
  get interactionCaptureAllowed(): boolean {
    return this.canCapture() && this.settings.interactionCaptureEnabled === true;
  }
  renewObservationEpoch(): void {
    this.epoch = randomUUID();
  }

  recordEvent(epoch: string, input: unknown): boolean {
    if (
      !this.canCapture() ||
      this.settings.interactionCaptureEnabled !== true ||
      epoch !== this.epoch
    )
      return false;
    let event: ComputerActivityEvent;
    try {
      event = decodeComputerActivityEvent(input);
    } catch {
      return false;
    }
    const at = Date.parse(event.capturedAt);
    if (
      !isComputerActivityAllowed(event, this.settings) ||
      at > this.now().getTime() ||
      at < this.now().getTime() - this.settings.retentionDays * 86_400_000 ||
      this.events.some((item) => item.id === event.id) ||
      this.snapshots.some((item) => item.id === event.id)
    )
      return false;
    event = structuredClone(
      decodeComputerActivityEvent({
        ...event,
        appName: redact(event.appName).slice(0, 512),
        windowTitle: redact(event.windowTitle).slice(0, 512),
        ...(event.text !== undefined ? { text: redact(event.text).slice(0, 4096) } : {}),
        ...(event.keyEquivalent !== undefined
          ? { keyEquivalent: redact(event.keyEquivalent).slice(0, 64) }
          : {}),
        ...(event.selection
          ? {
              selection: {
                ...event.selection,
                ...(event.selection.text !== undefined
                  ? { text: redact(event.selection.text).slice(0, 4096) }
                  : {}),
              },
            }
          : {}),
        ...(event.ax ? { ax: { ...event.ax, text: redact(event.ax.text).slice(0, 16_384) } } : {}),
      }),
    );
    const previous = this.events;
    const previousSnapshots = this.snapshots;
    this.events = [...previous, event];
    try {
      this.persist();
    } catch (error) {
      this.events = previous;
      this.snapshots = previousSnapshots;
      throw error;
    }
    this.options.onRecorded?.();
    return true;
  }

  readEvidence(): readonly (ComputerActivitySnapshot | ComputerActivityEvent)[] {
    if (this.prune()) this.persist();
    return structuredClone([...this.snapshots, ...this.events]);
  }

  async captureNow(): Promise<ComputerActivitySnapshot | null> {
    if (!this.canCapture() || this.pending) return null;
    const generation = this.generation;
    const controller = new AbortController();
    this.pending = controller;
    try {
      const captured = await this.options.capture(controller.signal);
      if (
        !captured ||
        generation !== this.generation ||
        !this.canCapture() ||
        controller.signal.aborted
      )
        return null;
      const decoded = decodeComputerActivitySnapshot(captured);
      const snapshot = decodeComputerActivitySnapshot({
        ...decoded,
        appName: redact(decoded.appName).slice(0, 512),
        windowTitle: redact(decoded.windowTitle).slice(0, 512),
        labels: decoded.labels.map((label) => redact(label).slice(0, 256)),
      });
      if (!isComputerActivityAllowed(snapshot, this.settings)) return null;
      const at = Date.parse(snapshot.capturedAt);
      if (
        at > this.now().getTime() + 60_000 ||
        at < this.now().getTime() - this.settings.retentionDays * 86_400_000
      )
        return null;
      this.prune();
      if (
        this.snapshots.some((item) => item.id === snapshot.id) ||
        this.events.some((item) => item.id === snapshot.id) ||
        (this.snapshots.at(-1) && contextKey(this.snapshots.at(-1)!) === contextKey(snapshot))
      )
        return null;
      this.snapshots.push(structuredClone(snapshot));
      this.persist();
      this.options.onRecorded?.();
      return structuredClone(snapshot);
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return null;
      throw error;
    } finally {
      if (this.pending === controller) this.pending = undefined;
    }
  }

  list(
    options: {
      cursor?: string;
      limit?: number;
      since?: string;
      until?: string;
      bundleId?: string;
    } = {},
  ): ComputerActivityPage {
    const { cursor: _cursor, limit: _limit, ...scope } = options;
    decodeComputerActivityScope(scope);
    const limit = options.limit ?? 50;
    const since = options.since === undefined ? -Infinity : Date.parse(options.since);
    const until = options.until === undefined ? Infinity : Date.parse(options.until);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      Number.isNaN(since) ||
      Number.isNaN(until) ||
      since > until
    )
      throw new Error("Invalid activity pagination");
    if (this.prune()) this.persist();
    const records = [...this.snapshots, ...this.events]
      .filter(
        (item) =>
          Date.parse(item.capturedAt) >= since &&
          Date.parse(item.capturedAt) < until &&
          (!options.bundleId || item.target.bundleId === options.bundleId),
      )
      .toSorted((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id));
    const index = options.cursor ? records.findIndex((item) => item.id === options.cursor) : -1;
    if (options.cursor && index < 0) return { snapshots: [], summaries: [] };
    const selected = boundedActivityItems(records.slice(index + 1), limit);
    const last = selected.at(-1);
    const counts = summaries(
      records.filter((item): item is ComputerActivitySnapshot => "labels" in item),
    );
    const selectedCounts = boundedActivityItems(counts.summaries, 200);
    const events = selected.filter((item): item is ComputerActivityEvent => "kind" in item);
    return {
      snapshots: structuredClone(
        selected.filter((item): item is ComputerActivitySnapshot => "labels" in item),
      ),
      summaries: selectedCounts,
      ...(events.length ? { events: structuredClone(events) } : {}),
      ...(counts.truncated || selectedCounts.length < counts.summaries.length
        ? { countsTruncated: true as const }
        : {}),
      ...(last && index + 1 + selected.length < records.length ? { nextCursor: last.id } : {}),
    };
  }

  clear(scope: { since?: string; until?: string; bundleId?: string } = {}): number {
    decodeComputerActivityScope(scope);
    const since = scope.since === undefined ? -Infinity : Date.parse(scope.since);
    const until = scope.until === undefined ? Infinity : Date.parse(scope.until);
    if (Number.isNaN(since) || Number.isNaN(until) || since > until)
      throw new Error("Invalid activity clear interval");
    this.invalidate();
    const keep = (record: ComputerActivitySnapshot | ComputerActivityEvent) =>
      !(
        Date.parse(record.capturedAt) >= since &&
        Date.parse(record.capturedAt) < until &&
        (!scope.bundleId || record.target.bundleId === scope.bundleId)
      );
    const previousSnapshots = this.snapshots;
    const previousEvents = this.events;
    this.snapshots = this.snapshots.filter(keep);
    this.events = this.events.filter(keep);
    const removed =
      previousSnapshots.length + previousEvents.length - this.snapshots.length - this.events.length;
    try {
      this.persist();
    } catch (error) {
      this.snapshots = previousSnapshots;
      this.events = previousEvents;
      throw error;
    }
    this.schedule();
    return removed;
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private decodeSettings(settings: ComputerUseHistorySettings): ComputerUseHistorySettings {
    const decoded = structuredClone(
      Schema.decodeUnknownSync(ComputerUseHistorySettings)(settings, { onExcessProperty: "error" }),
    );
    for (const rule of [...(decoded.includedDomains ?? []), ...decoded.excludedDomains]) {
      const domain = rule.trim().toLowerCase().replace(/\.$/, "");
      if (
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
          domain,
        )
      )
        throw new Error("Activity policy requires domain names without URLs or paths");
    }
    return decoded;
  }

  private canCapture(): boolean {
    return !this.disposed && !this.stopped && this.settings.enabled && !this.settings.paused;
  }

  private invalidate(): void {
    this.generation++;
    this.epoch = randomUUID();
    this.pending?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running || !this.canCapture()) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.captureNow()
        .catch((error) => this.options.onError?.(error))
        .finally(() => this.schedule());
    }, this.settings.intervalSeconds * 1000);
    this.timer.unref?.();
  }

  private prune(): boolean {
    const before = this.snapshots.length + this.events.length;
    const cutoff = this.now().getTime() - this.settings.retentionDays * 86_400_000;
    this.snapshots = this.snapshots
      .filter((snapshot) => Date.parse(snapshot.capturedAt) >= cutoff)
      .slice(-MAX_SNAPSHOTS);
    this.events = this.events
      .filter((event) => Date.parse(event.capturedAt) >= cutoff)
      .slice(-MAX_SNAPSHOTS);
    return before !== this.snapshots.length + this.events.length;
  }

  private persist(): void {
    this.prune();
    let json = JSON.stringify({ version: 1, snapshots: this.snapshots, events: this.events });
    while (Buffer.byteLength(json) > MAX_BYTES && this.snapshots.length + this.events.length) {
      const records = [...this.snapshots, ...this.events].toSorted((a, b) =>
        a.capturedAt.localeCompare(b.capturedAt),
      );
      const removed = new Set(
        records.slice(0, Math.max(1, Math.ceil(records.length / 10))).map((record) => record.id),
      );
      this.snapshots = this.snapshots.filter((record) => !removed.has(record.id));
      this.events = this.events.filter((record) => !removed.has(record.id));
      json = JSON.stringify({ version: 1, snapshots: this.snapshots, events: this.events });
    }
    const temporary = join(this.options.directory, `.activity-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, json, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
