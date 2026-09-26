/**
 * Background agent jobs: `agent.run` executes task runs; `agent.resume-blocked`
 * re-enqueues runs blocked for credits once the org is funded; `sandbox.reap`
 * destroys sandbox machines that outlived their run.
 */
import {
  AGENT_RUN_JOB,
  AGENT_RUN_QUEUE_OPTIONS,
  RunInterruptedError,
  resumeBlockedRuns,
  type AgentRunJobData,
  type AgentRuntime,
} from "@djl/api/agent";
import type { LedgerService } from "@djl/api/credits";
import type { DjlDatabase } from "@djl/db";
import type { PgBoss } from "pg-boss";

const log = (fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", ...fields }));

export async function registerAgentJobs(
  boss: PgBoss,
  deps: {
    readonly db: DjlDatabase;
    readonly ledger: LedgerService;
    readonly agent: AgentRuntime;
    readonly concurrency: number;
  },
): Promise<void> {
  await boss.createQueue(AGENT_RUN_JOB, AGENT_RUN_QUEUE_OPTIONS);
  await boss.work<AgentRunJobData>(
    AGENT_RUN_JOB,
    { batchSize: 1, localConcurrency: deps.concurrency },
    async ([job]) => {
      if (!job) return;
      const started = Date.now();
      try {
        await deps.agent.runner.execute(job.data.runId, job.signal);
        log({ job: AGENT_RUN_JOB, runId: job.data.runId, ms: Date.now() - started });
      } catch (error) {
        // Thrown so pg-boss retries the job; the retry resumes the run.
        if (error instanceof RunInterruptedError)
          log({ job: AGENT_RUN_JOB, runId: job.data.runId, interrupted: true });
        throw error;
      }
    },
  );

  const enqueue = async (runId: string) => {
    const data: AgentRunJobData = { runId };
    await boss.send(AGENT_RUN_JOB, { ...data }, { singletonKey: runId });
  };
  await boss.createQueue("agent.resume-blocked");
  await boss.schedule("agent.resume-blocked", "*/5 * * * *", undefined, { tz: "UTC" });
  await boss.work("agent.resume-blocked", { batchSize: 1 }, async () => {
    const resumed = await resumeBlockedRuns({ db: deps.db, ledger: deps.ledger, enqueue });
    log({ job: "agent.resume-blocked", resumed });
  });

  const reap = deps.agent.reap;
  if (reap) {
    await boss.createQueue("sandbox.reap");
    await boss.schedule("sandbox.reap", "*/5 * * * *", undefined, { tz: "UTC" });
    await boss.work("sandbox.reap", { batchSize: 1 }, async () => {
      log({ job: "sandbox.reap", destroyed: await reap() });
    });
  }
}
