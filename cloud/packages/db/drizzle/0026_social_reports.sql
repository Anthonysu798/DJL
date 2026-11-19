CREATE TABLE social_report_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, draft_id uuid NOT NULL REFERENCES social_drafts(id) ON DELETE CASCADE,
 thread_id text NOT NULL, enabled boolean NOT NULL DEFAULT false, timezone text NOT NULL,
 weekday integer NOT NULL CHECK (weekday BETWEEN 0 AND 6), hour integer NOT NULL CHECK (hour BETWEEN 0 AND 23),
 minute integer NOT NULL CHECK (minute BETWEEN 0 AND 59), period_start timestamptz, next_run_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(), CHECK (NOT enabled OR (period_start IS NOT NULL AND next_run_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX social_report_schedule_owner_thread ON social_report_schedules(org_id,user_id,thread_id);
--> statement-breakpoint
CREATE INDEX social_report_schedule_due ON social_report_schedules(enabled,next_run_at);
--> statement-breakpoint
CREATE TABLE social_weekly_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id uuid NOT NULL REFERENCES social_report_schedules(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 thread_id text NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL, retrieved_at timestamptz NOT NULL,
 content jsonb NOT NULL, CHECK (period_end > period_start)
);
--> statement-breakpoint
CREATE UNIQUE INDEX social_weekly_report_period ON social_weekly_reports(schedule_id,period_end);
--> statement-breakpoint
CREATE INDEX social_weekly_report_owner_thread ON social_weekly_reports(org_id,user_id,thread_id,period_end);
