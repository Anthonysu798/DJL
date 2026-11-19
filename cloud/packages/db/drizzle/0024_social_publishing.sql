CREATE TABLE social_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, thread_id text NOT NULL, revision integer NOT NULL CHECK (revision > 0),
 content jsonb NOT NULL, confirmed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE social_publish_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL REFERENCES social_drafts(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 revision integer NOT NULL, account_id uuid NOT NULL, state text NOT NULL CHECK (state IN ('queued','publishing','reconciling','published','failed','uncertain','cancelled')),
 due_at timestamptz NOT NULL, attempt_id uuid, remote_id text, post_id text, publish_started_at timestamptz, error_code text, updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX social_publish_revision_account ON social_publish_tasks(draft_id,revision,account_id);
--> statement-breakpoint
CREATE INDEX social_publish_due ON social_publish_tasks(state,due_at);
