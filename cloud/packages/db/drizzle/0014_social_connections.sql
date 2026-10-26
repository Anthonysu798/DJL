CREATE TABLE social_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 provider text NOT NULL, provider_account_id text NOT NULL, username text NOT NULL, display_name text NOT NULL,
 scopes jsonb NOT NULL, capabilities jsonb NOT NULL, status text NOT NULL, encrypted_tokens text,
 expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX social_accounts_owner_provider ON social_accounts(user_id, org_id, provider, provider_account_id);
--> statement-breakpoint
CREATE TABLE social_oauth_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE, provider text NOT NULL,
 state_hash text NOT NULL UNIQUE, encrypted_verifier text NOT NULL,
 thread_id text NOT NULL, campaign_id text NOT NULL, revision integer NOT NULL,
 reconnect_account_id uuid REFERENCES social_accounts(id), account_id uuid REFERENCES social_accounts(id),
 status text NOT NULL, error_code text, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
