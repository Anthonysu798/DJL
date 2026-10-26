CREATE INDEX IF NOT EXISTS "runs_task_finished_idx" ON "runs" USING btree ("user_id","org_id","finished_at","id") WHERE "runs"."mode" = 'task' AND "runs"."status" IN ('succeeded', 'failed');
