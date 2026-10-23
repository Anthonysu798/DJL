import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import path from "node:path";
import { exportTimeline, type ResolvedClip } from "./video";
import { listDocuments, saveDocument, MarketingError } from "./store";
export interface ExportJob {
  id: string;
  campaignId: string;
  status: "rendering" | "complete" | "failed" | "canceled" | "interrupted";
  createdAt: string;
  error?: string;
}
const running = new Map<string, AbortController>();
export function recoverJobs() {
  return Effect.gen(function* () {
    const rows = yield* listDocuments("job");
    for (const row of rows) {
      const job = row.value as ExportJob;
      if (job.status === "rendering" && !running.has(job.id)) {
        row.value = {
          ...job,
          status: "interrupted",
          error: "DJL stopped during export. Reopen the timeline and export again.",
        };
        yield* saveDocument("job", job.id, row.value, row.version);
      }
    }
    return rows;
  });
}
export function startExport(
  root: string,
  campaignId: string,
  clips: ResolvedClip[],
  width: number,
  height: number,
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    if (running.size >= 2)
      return yield* Effect.fail(
        new MarketingError("Two exports are already running. Wait for one to finish."),
      );
    const job: ExportJob = {
      id: crypto.randomUUID(),
      campaignId,
      status: "rendering",
      createdAt: new Date().toISOString(),
    };
    const controller = new AbortController();
    running.set(job.id, controller);
    yield* saveDocument("job", job.id, job, null).pipe(
      Effect.tapError(() => Effect.sync(() => running.delete(job.id))),
    );
    const output = path.join(root, `${job.id}.mp4`);
    const persist = (value: ExportJob) =>
      Effect.runPromise(
        saveDocument("job", job.id, value, 1).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      );
    void exportTimeline(clips, output, width, height, controller.signal)
      .then(() => persist({ ...job, status: "complete" }))
      .catch(async (e) => {
        await persist({
          ...job,
          status: controller.signal.aborted ? "canceled" : "failed",
          error: e instanceof Error ? e.message : "Video export failed.",
        }).catch(() => undefined);
      })
      .finally(() => running.delete(job.id));
    return job;
  });
}
export function cancelExport(id: string) {
  const controller = running.get(id);
  if (!controller) throw new MarketingError("This export is no longer running.", 409);
  controller.abort();
}
