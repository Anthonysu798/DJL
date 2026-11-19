CREATE TABLE social_review_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL REFERENCES social_drafts(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK (revision > 0), token_hash text NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz,
 CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days')
);
--> statement-breakpoint
CREATE UNIQUE INDEX social_review_token_hash ON social_review_links(token_hash);
--> statement-breakpoint
CREATE INDEX social_review_draft ON social_review_links(draft_id);
--> statement-breakpoint
CREATE TABLE social_review_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), link_id uuid NOT NULL REFERENCES social_review_links(id) ON DELETE CASCADE,
 reviewer_name text NOT NULL CHECK (length(reviewer_name) BETWEEN 1 AND 80), identity_verified boolean NOT NULL DEFAULT false CHECK (identity_verified = false),
 comment text NOT NULL CHECK (length(comment) <= 2000), decision text NOT NULL CHECK (decision IN ('comment','approved','changes_requested')),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX social_review_feedback_link ON social_review_feedback(link_id);
