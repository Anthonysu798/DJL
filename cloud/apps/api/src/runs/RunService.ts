/**
 * Reading and cancelling runs. Every lookup is scoped to the caller's org and
 * user; another user's run is a 404. Events resume after any `seq`, as JSON
 * or as an SSE stream that follows the run live until it ends.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { CloudRunEventsResponse, CloudRunResponse } from "@synara/contracts/cloud";

import type { Principal } from "../auth/guard.ts";
import { ApiError } from "../http/errors.ts";
import { isTerminalStatus, type RunLog } from "./RunLog.ts";
import { toRun, type RunRow } from "./wire.ts";

export class RunService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly log: RunLog,
    private readonly heartbeatMs = 15_000,
  ) {}

  async get(p: Principal, id: string): Promise<typeof CloudRunResponse.Encoded> {
    return { run: toRun(await this.own(p, id)) };
  }

  async events(
    p: Principal,
    id: string,
    after: number,
  ): Promise<typeof CloudRunEventsResponse.Encoded> {
    const run = await this.own(p, id);
    return { run: toRun(run), events: await this.log.read(id, after) };
  }

  /**
   * SSE lines for every event after `after`, following the run until its
   * terminal status, with a comment heartbeat while it is quiet. Aborting
   * `signal` (the client left) stops only the stream, never the run.
   */
  async stream(
    p: Principal,
    id: string,
    after: number,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<string>> {
    await this.own(p, id);
    const events = this.log.follow(id, after, signal, this.heartbeatMs);
    return (async function* () {
      yield "retry: 3000\n\n";
      for await (const event of events)
        yield event
          ? `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
          : ": heartbeat\n\n";
    })();
  }

  /**
   * Idempotent. A run nobody is executing (queued, blocked) ends here; a
   * running one is flagged and its executor stops at the next check.
   */
  async cancel(p: Principal, id: string): Promise<typeof CloudRunResponse.Encoded> {
    const run = await this.own(p, id);
    if (isTerminalStatus(run.status)) return { run: toRun(run) };
    const now = new Date();
    // Reserve the status event's seq in the same update, so a reader never
    // sees the run finished before the event exists.
    const [ended] = await this.db
      .update(schema.runs)
      .set({
        status: "cancelled",
        cancelRequestedAt: now,
        finishedAt: now,
        lastSeq: sql`${schema.runs.lastSeq} + 1`,
      })
      .where(
        and(eq(schema.runs.id, id), inArray(schema.runs.status, ["queued", "blocked_on_usage"])),
      )
      .returning();
    if (ended) {
      await this.log
        .writer(id, ended.lastSeq - 1)
        .append("status", { status: "cancelled", error: null });
      return { run: toRun(ended) };
    }
    const [flagged] = await this.db
      .update(schema.runs)
      .set({ cancelRequestedAt: now })
      .where(and(eq(schema.runs.id, id), isNull(schema.runs.cancelRequestedAt)))
      .returning();
    return { run: toRun(flagged ?? (await this.own(p, id))) };
  }

  private async own(p: Principal, id: string): Promise<RunRow> {
    const run = await this.db.query.runs.findFirst({
      where: and(
        eq(schema.runs.id, id),
        eq(schema.runs.orgId, p.orgId),
        eq(schema.runs.userId, p.userId),
      ),
    });
    if (!run) throw new ApiError(404, "not_found", "Not found.");
    return run;
  }
}
