CREATE TABLE social_tracking_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, slug text NOT NULL,
 target_url text NOT NULL, campaign_id text NOT NULL CHECK (length(campaign_id) BETWEEN 1 AND 200),
 thread_id text NOT NULL CHECK (length(thread_id) BETWEEN 1 AND 200), content_revision integer NOT NULL CHECK (content_revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz,
 CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days')
);
--> statement-breakpoint
CREATE UNIQUE INDEX social_tracking_slug ON social_tracking_links(slug);
--> statement-breakpoint
CREATE INDEX social_tracking_owner_campaign ON social_tracking_links(org_id,user_id,campaign_id,created_at);
--> statement-breakpoint
CREATE TABLE social_tracking_daily (
 link_id uuid NOT NULL REFERENCES social_tracking_links(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 day date NOT NULL, link_opens integer NOT NULL CHECK (link_opens >= 0), PRIMARY KEY (link_id,day)
);
--> statement-breakpoint
CREATE INDEX social_tracking_daily_owner ON social_tracking_daily(org_id,user_id,day);
