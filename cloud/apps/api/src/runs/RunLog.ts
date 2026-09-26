/**
 * A run's ordered event log. Each event goes to the Redis stream `run:{id}`
 * immediately (entry id `0-{seq}`, one-hour TTL) for live readers, and to
 * `run_events` in batches: every 250 ms while text streams, and at once for
 * every other event. Readers resume with `after=seq` from Redis while the
 * stream lasts and from Postgres after it expires, so any device can pick up
 * a run at any time.
 */
import { and, asc, eq, gt } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { CloudRunEvent, CloudRunStatus } from "@synara/contracts/cloud";
import type { Redis } from "ioredis";

export type RunEvent = typeof CloudRunEvent.Encoded;
export type RunEventType = RunEvent["type"];
export type RunEventPayload<T extends RunEventType> = Extract<RunEvent, { type: T }>["payload"];

export const RUN_STREAM_TTL_SECONDS = 3600;
const FLUSH_MS = 250;
const READ_LIMIT = 1000;

const TERMINAL: ReadonlySet<CloudRunStatus> = new Set(["succeeded", "failed", "cancelled"]);
export const isTerminalStatus = (status: CloudRunStatus) => TERMINAL.has(status);
export const isTerminalEvent = (event: RunEvent) =>
  event.type === "status" && isTerminalStatus(event.payload.status);

const streamKey = (runId: string) => `run:${runId}`;

function logError(msg: string, runId: string, error: unknown) {
  console.error(
    JSON.stringify({
      level: "error",
      msg,
      runId,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

export class RunLog {
  constructor(
    private readonly db: DjlDatabase,
    private readonly redis: Redis,
  ) {}

  /** The single writer of one run's events; `lastSeq` is the run's current `last_seq`. */
  writer(runId: string, lastSeq: number): RunWriter {
    return new RunWriter(this.db, this.redis, runId, lastSeq);
  }

  /** Events after `after`, oldest first: from Redis when it holds them, else from Postgres. */
  async read(runId: string, after: number): Promise<RunEvent[]> {
    const entries = await this.redis
      .xrange(streamKey(runId), `(0-${after}`, "+", "COUNT", READ_LIMIT)
      .catch(() => []);
    const live = entries.map(([, fields]) => JSON.parse(fields[1]!) as RunEvent);
    if (live[0]?.seq === after + 1) return live;
    const rows = await this.db
      .select()
      .from(schema.runEvents)
      .where(and(eq(schema.runEvents.runId, runId), gt(schema.runEvents.seq, after)))
      .orderBy(asc(schema.runEvents.seq))
      .limit(READ_LIMIT);
    return rows.map(
      (r) =>
        ({
          runId: r.runId,
          seq: r.seq,
          type: r.type,
          payload: r.payload,
          createdAt: r.createdAt.toISOString(),
        }) as RunEvent,
    );
  }

  /**
   * Every event after `after` until the run ends or `signal` aborts. Yields
   * `null` as a heartbeat after `heartbeatMs` without events.
   */
  async *follow(
    runId: string,
    after: number,
    signal: AbortSignal,
    heartbeatMs: number,
  ): AsyncGenerator<RunEvent | null> {
    // XREAD BLOCK holds its connection, so each follower gets its own.
    const conn = this.redis.duplicate();
    const close = () => conn.disconnect();
    signal.addEventListener("abort", close, { once: true });
    let cursor = after;
    try {
      while (!signal.aborted) {
        const events = await this.read(runId, cursor);
        for (const event of events) {
          yield event;
          cursor = event.seq;
          if (isTerminalEvent(event)) return;
        }
        if (events.length > 0) continue;
        if (await this.finished(runId, cursor)) return;
        const woke = await conn
          .xread("COUNT", 1, "BLOCK", heartbeatMs, "STREAMS", streamKey(runId), `0-${cursor}`)
          .catch(() => (signal.aborted ? [] : null));
        if (!woke) yield null;
      }
    } finally {
      signal.removeEventListener("abort", close);
      close();
    }
  }

  private async finished(runId: string, cursor: number): Promise<boolean> {
    const run = await this.db.query.runs.findFirst({
      columns: { status: true, lastSeq: true },
      where: eq(schema.runs.id, runId),
    });
    return !run || (isTerminalStatus(run.status) && run.lastSeq <= cursor);
  }
}

export class RunWriter {
  private pending: RunEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private live = true;

  constructor(
    private readonly db: DjlDatabase,
    private readonly redis: Redis,
    private readonly runId: string,
    private seq: number,
  ) {}

  async append<T extends RunEventType>(type: T, payload: RunEventPayload<T>): Promise<void> {
    this.seq += 1;
    const event = {
      runId: this.runId,
      seq: this.seq,
      type,
      payload,
      createdAt: new Date().toISOString(),
    } as RunEvent;
    await this.publish(event);
    this.pending.push(event);
    if (type !== "text.delta") return this.flush();
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  /** Write buffered events to Postgres and advance `runs.last_seq`. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flushing = this.flushing.then(async () => {
      const batch = this.pending.splice(0);
      if (batch.length === 0) return;
      try {
        await this.db.insert(schema.runEvents).values(
          batch.map((e) => ({
            runId: e.runId,
            seq: e.seq,
            type: e.type,
            payload: e.payload,
            createdAt: new Date(e.createdAt),
          })),
        );
        await this.db
          .update(schema.runs)
          .set({ lastSeq: batch.at(-1)!.seq })
          .where(eq(schema.runs.id, this.runId));
      } catch (error) {
        logError("run events flush failed", this.runId, error);
      }
    });
    return this.flushing;
  }

  /**
   * A failed XADD would leave a gap readers can't see, so the stream is
   * dropped and every reader falls back to Postgres for this run.
   */
  private async publish(event: RunEvent): Promise<void> {
    if (!this.live) return;
    const key = streamKey(this.runId);
    try {
      const results = await this.redis
        .multi()
        .xadd(key, `0-${event.seq}`, "event", JSON.stringify(event))
        .expire(key, RUN_STREAM_TTL_SECONDS)
        .exec();
      const failed = results?.find(([error]) => error);
      if (failed) throw failed[0];
    } catch (error) {
      this.live = false;
      await this.redis.del(key).catch(() => undefined);
      logError("run stream publish failed", this.runId, error);
    }
  }
}
