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
  ComputerActivityScope,
  decodeComputerActivityScope,
  ComputerUseHistoryEvent,
  ComputerUseHistorySettings,
  ComputerUseHistoryState,
  type ComputerUseHistoryPage,
} from "@djl/contracts";

type StoredEvent = { threadId: string; event: ComputerUseHistoryEvent };
const MAX_EVENTS = 5_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_SETTINGS: ComputerUseHistorySettings = {
  enabled: false,
  paused: false,
  retentionDays: 30,
  intervalSeconds: 30,
  excludedBundleIds: [],
  excludedDomains: [],
};
const Store = Schema.Struct({
  version: Schema.Literal(1),
  settings: ComputerUseHistorySettings,
  pendingActivityClear: Schema.optionalKey(ComputerActivityScope),
  pauseResumeAt: ComputerUseHistoryState.fields.pauseResumeAt,
  events: Schema.Array(
    Schema.Struct({ threadId: Schema.String, event: ComputerUseHistoryEvent }),
  ).check(Schema.isMaxLength(MAX_EVENTS)),
}).check(
  Schema.makeFilter(
    (store) => !store.pauseResumeAt || (store.settings.enabled && store.settings.paused),
  ),
);

// Only sanitized operation metadata belongs here. Passive settings are stored for
// the controls; this store neither captures nor summarizes passive observations.
export class ComputerUseHistory {
  private readonly file: string;
  private settings: ComputerUseHistorySettings = DEFAULT_SETTINGS;
  private events: StoredEvent[] = [];
  private pauseResumeAt: string | undefined;
  private pendingActivityClear: ComputerActivityScope | undefined;

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
      throw new Error("Computer-use history directory must be a private directory");
    }
    chmodSync(directory, 0o700);
    this.file = join(directory, "operations.json");
    try {
      const stat = lstatSync(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) {
        throw new Error("Invalid computer-use history file");
      }
      const stored = Schema.decodeUnknownSync(Store)(JSON.parse(readFileSync(this.file, "utf8")), {
        onExcessProperty: "error",
      });
      this.settings = stored.settings;
      this.pauseResumeAt = stored.pauseResumeAt;
      this.pendingActivityClear = stored.pendingActivityClear;
      this.events = [...stored.events];
      chmodSync(this.file, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.persist();
  }

  getSettings(): ComputerUseHistorySettings {
    return structuredClone(this.settings);
  }

  getState(): ComputerUseHistoryState {
    return {
      ...this.getSettings(),
      ...(this.pauseResumeAt ? { pauseResumeAt: this.pauseResumeAt } : {}),
    };
  }

  getPendingActivityClear(): ComputerActivityScope | undefined {
    return this.pendingActivityClear === undefined
      ? undefined
      : structuredClone(this.pendingActivityClear);
  }

  beginActivityClear(scope: ComputerActivityScope): void {
    const decoded = decodeComputerActivityScope(scope);
    if (this.pendingActivityClear !== undefined && !this.matchesActivityClear(decoded))
      throw new Error("History clear recovery is required");
    this.change(() => {
      this.pendingActivityClear = structuredClone(decoded);
    });
  }

  finishActivityClear(expectedScope: ComputerActivityScope): void {
    decodeComputerActivityScope(expectedScope);
    if (this.pendingActivityClear === undefined || !this.matchesActivityClear(expectedScope))
      throw new Error("History clear recovery is required");
    this.change(() => {
      this.pendingActivityClear = undefined;
    });
  }

  private matchesActivityClear(scope: ComputerActivityScope): boolean {
    return (["since", "until", "bundleId"] as const).every(
      (field) => this.pendingActivityClear?.[field] === scope[field],
    );
  }

  configure(
    settings: ComputerUseHistorySettings,
    deadline?: string | null,
  ): ComputerUseHistoryState {
    const decoded = Schema.decodeUnknownSync(ComputerUseHistorySettings)(settings, {
      onExcessProperty: "error",
    });
    const pauseResumeAt =
      decoded.enabled && decoded.paused
        ? deadline === undefined
          ? this.pauseResumeAt
          : (deadline ?? undefined)
        : undefined;
    Schema.decodeUnknownSync(ComputerUseHistoryState)(
      { ...decoded, ...(pauseResumeAt ? { pauseResumeAt } : {}) },
      { onExcessProperty: "error" },
    );
    this.change(() => {
      this.settings = structuredClone(decoded);
      this.pauseResumeAt = pauseResumeAt;
    });
    return this.getState();
  }

  append(threadId: string, event: ComputerUseHistoryEvent): void {
    // Strict decoding also prevents an accidental text/AX/screenshot property
    // being introduced by a later caller of this storage helper.
    const sanitized = Schema.decodeUnknownSync(ComputerUseHistoryEvent)(event, {
      onExcessProperty: "error",
    });
    this.change(() => {
      this.events.push({ threadId, event: sanitized });
    });
  }

  list(options: {
    threadId?: string;
    source?: "agent" | "passive";
    cursor?: string;
    limit?: number;
  }): ComputerUseHistoryPage {
    this.change(() => {}, true);
    const events = this.events
      .filter(
        ({ threadId, event }) =>
          (options.threadId === undefined || options.threadId === threadId) &&
          (options.source === undefined || options.source === event.source),
      )
      .toReversed();
    const index = options.cursor
      ? events.findIndex(({ event }) => event.id === options.cursor)
      : -1;
    if (options.cursor && index === -1) return { events: [] };
    const start = index + 1;
    const selected = events.slice(start, start + (options.limit ?? 50));
    const last = selected.at(-1);
    return {
      events: selected.map(({ event }) => structuredClone(event)),
      ...(last && start + selected.length < events.length ? { nextCursor: last.event.id } : {}),
    };
  }

  clear(source?: "agent" | "passive"): number {
    const count = this.events.length;
    this.change(() => {
      this.events = source ? this.events.filter(({ event }) => event.source !== source) : [];
    });
    return count - this.events.length;
  }

  private change(update: () => void, onlyIfPruned = false): void {
    const previous = {
      settings: this.settings,
      deadline: this.pauseResumeAt,
      pendingActivityClear: this.pendingActivityClear,
      events: [...this.events],
    };
    try {
      update();
      if (!onlyIfPruned || this.prune()) this.persist();
    } catch (error) {
      this.settings = previous.settings;
      this.pauseResumeAt = previous.deadline;
      this.pendingActivityClear = previous.pendingActivityClear;
      this.events = previous.events;
      throw error;
    }
  }

  private prune(): boolean {
    const previousCount = this.events.length;
    const cutoff = Date.now() - this.settings.retentionDays * 86_400_000;
    this.events = this.events
      .filter(({ event }) => {
        const at = Date.parse(event.at);
        return Number.isFinite(at) && at >= cutoff;
      })
      .slice(-MAX_EVENTS);
    return previousCount !== this.events.length;
  }

  private persist(): void {
    this.prune();
    const json = JSON.stringify({
      version: 1,
      settings: this.settings,
      ...(this.pauseResumeAt ? { pauseResumeAt: this.pauseResumeAt } : {}),
      ...(this.pendingActivityClear !== undefined
        ? { pendingActivityClear: this.pendingActivityClear }
        : {}),
      events: this.events,
    });
    if (Buffer.byteLength(json) > MAX_FILE_BYTES)
      throw new Error("Computer-use history limit exceeded");
    const temporary = join(this.directory, `.operations-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, json, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
