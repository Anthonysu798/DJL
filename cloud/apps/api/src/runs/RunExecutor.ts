/**
 * Task runs (mode `task`) are created `queued` and executed off the request
 * path by the worker: the API enqueues the pg-boss job AGENT_RUN_JOB with
 * `{ runId }`, and the worker hands it to a RunExecutor.
 */
import { PgBoss } from "pg-boss";

/** pg-boss queue for task runs. */
export const AGENT_RUN_JOB = "agent.run";

/**
 * A task may run 30 minutes. pg-boss heartbeats the job while the worker is
 * alive; a crashed worker's job misses its heartbeat and is retried, and the
 * retry resumes the run from its lease (see agent/AgentRunner.ts).
 */
export const AGENT_RUN_QUEUE_OPTIONS = {
  expireInSeconds: 35 * 60,
  heartbeatSeconds: 30,
  retryLimit: 5,
  retryDelay: 5,
} as const;

export interface AgentRunJobData {
  readonly runId: string;
}

/**
 * Executes one task run. An executor moves the run from `queued` to
 * `running`, writes its progress through RunLog (`status`, `step.started`,
 * `text.delta`, `message.part`, `usage`), persists the reply's parts on the
 * run's assistant message, checks `runs.cancel_requested_at` between steps,
 * and ends with a terminal `status` event (or `blocked_on_usage`). It must
 * stop promptly when `signal` aborts (worker shutdown) so the job can resume.
 */
export interface RunExecutor {
  readonly execute: (runId: string, signal: AbortSignal) => Promise<void>;
}

/** Where the API puts task runs; pg-boss in production. */
export interface TaskQueue {
  readonly enqueue: (runId: string) => Promise<void>;
}

/** pg-boss started on first use, so an API that never sees a task never touches its schema. */
export function createPgBossTaskQueue(
  connectionString: string,
): TaskQueue & { readonly close: () => Promise<void> } {
  let started: Promise<PgBoss> | null = null;
  const boss = () =>
    (started ??= (async () => {
      const b = new PgBoss({ connectionString, schema: "pgboss", max: 2 });
      b.on("error", (error) =>
        console.error(JSON.stringify({ level: "error", msg: "pg-boss", error: String(error) })),
      );
      await b.start();
      await b.createQueue(AGENT_RUN_JOB, AGENT_RUN_QUEUE_OPTIONS);
      return b;
    })());
  return {
    async enqueue(runId) {
      const data: AgentRunJobData = { runId };
      await (await boss()).send(AGENT_RUN_JOB, { ...data }, { singletonKey: runId });
    },
    async close() {
      if (started) await (await started).stop({ graceful: false });
    },
  };
}
