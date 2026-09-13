CREATE TYPE "public"."ledger_bucket" AS ENUM('trial', 'plan', 'topup');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('trial_grant', 'plan_grant', 'topup', 'admin_grant', 'reservation', 'release', 'settlement', 'refund', 'expiry', 'anonymize');--> statement-breakpoint
CREATE TYPE "public"."plan_id" AS ENUM('trial', 'starter', 'business', 'autopilot');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused');--> statement-breakpoint
CREATE TYPE "public"."model_status" AS ENUM('active', 'degraded', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."model_provider" AS ENUM('openai', 'anthropic', 'openrouter');--> statement-breakpoint
CREATE TYPE "public"."usage_status" AS ENUM('reserved', 'streaming', 'settled', 'released', 'cut_off', 'failed');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('owner', 'support', 'finance', 'readonly');--> statement-breakpoint
CREATE TYPE "public"."kill_switch" AS ENUM('gateway', 'billing', 'sync');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"phone_number" text,
	"phone_number_verified" boolean,
	"two_factor_enabled" boolean DEFAULT false,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"trial" bigint DEFAULT 0 NOT NULL,
	"plan" bigint DEFAULT 0 NOT NULL,
	"topup" bigint DEFAULT 0 NOT NULL,
	"folded_through" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"bucket" "ledger_bucket" NOT NULL,
	"amount" bigint NOT NULL,
	"reservation_id" uuid,
	"idempotency_key" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"billing_email" text NOT NULL,
	"country" text,
	"currency" text DEFAULT 'usd' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"status" text NOT NULL,
	"amount_due_usd_cents" integer NOT NULL,
	"amount_paid_usd_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"hosted_invoice_url" text,
	"pdf_url" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" "plan_id" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"monthly_price_usd_cents" integer NOT NULL,
	"annual_price_usd_cents" integer NOT NULL,
	"included_microcredits" bigint NOT NULL,
	"concurrent_streams" integer NOT NULL,
	"requests_per_minute" integer NOT NULL,
	"priority_weight" integer NOT NULL,
	"sync_quota_bytes" bigint NOT NULL,
	"requires_owner_2fa" boolean DEFAULT false NOT NULL,
	"stripe_monthly_price_id" text,
	"stripe_annual_price_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" "plan_id" NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"interval" text NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"last_granted_period_start" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_budget_days" (
	"day" text PRIMARY KEY NOT NULL,
	"cap_usd_cents" integer NOT NULL,
	"granted_usd_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_grants" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_hash" text NOT NULL,
	"phone_line_type" text NOT NULL,
	"device_fingerprint" text,
	"ip_hash" text,
	"status" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"granted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abuse_flags" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"details" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"public_key" text,
	"fingerprint" text NOT NULL,
	"trust_state" text DEFAULT 'trusted' NOT NULL,
	"sync_enabled" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"app_version" text,
	"platform" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "model_catalog" (
	"model_id" text PRIMARY KEY NOT NULL,
	"provider" "model_provider" NOT NULL,
	"upstream_model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"input_micro_per_token" bigint DEFAULT 0 NOT NULL,
	"output_micro_per_token" bigint DEFAULT 0 NOT NULL,
	"cached_input_micro_per_token" bigint DEFAULT 0 NOT NULL,
	"micro_per_image" bigint DEFAULT 0 NOT NULL,
	"micro_per_request" bigint DEFAULT 0 NOT NULL,
	"provider_input_usd_per_million" text,
	"provider_output_usd_per_million" text,
	"context_window" integer,
	"max_output_tokens" integer,
	"quality_score" integer DEFAULT 50 NOT NULL,
	"status" "model_status" DEFAULT 'active' NOT NULL,
	"region" text DEFAULT 'global' NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_requests" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"device_id" uuid,
	"model_id" text NOT NULL,
	"provider" "model_provider" NOT NULL,
	"endpoint" text NOT NULL,
	"route_reason" text NOT NULL,
	"status" "usage_status" NOT NULL,
	"reserved_micro" bigint NOT NULL,
	"settled_micro" bigint,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_input_tokens" integer,
	"images" integer,
	"upstream_request_id" text,
	"refusal" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"latency_ms" integer,
	"first_token_ms" integer,
	"trace_id" text NOT NULL,
	"region" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"user_agent" text,
	"mfa_verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "admin_role" NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_encrypted" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"passkey_credentials" jsonb,
	"credit_grant_cap_micro" text,
	"disabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_by" uuid,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip_hash" text,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_stats" (
	"day" text NOT NULL,
	"country" text DEFAULT '*' NOT NULL,
	"signups" integer DEFAULT 0 NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"gateway_requests" integer DEFAULT 0 NOT NULL,
	"settled_micro" text DEFAULT '0' NOT NULL,
	"revenue_usd_cents" integer DEFAULT 0 NOT NULL,
	"provider_cost_usd_micro" text DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_stats_day_country_pk" PRIMARY KEY("day","country")
);
--> statement-breakpoint
CREATE TABLE "kill_switches" (
	"name" "kill_switch" PRIMARY KEY NOT NULL,
	"engaged" boolean DEFAULT false NOT NULL,
	"reason" text,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_grants" ADD CONSTRAINT "trial_grants_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_grants" ADD CONSTRAINT "trial_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_flags" ADD CONSTRAINT "abuse_flags_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_flags" ADD CONSTRAINT "abuse_flags_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_idx" ON "credit_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_created_idx" ON "credit_ledger" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_reservation_idx" ON "credit_ledger" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_id_idx" ON "customers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_stripe_customer_id_idx" ON "customers" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "invoices_org_id_idx" ON "invoices" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_idx" ON "subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_id_idx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_grants_phone_hash_idx" ON "trial_grants" USING btree ("phone_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_grants_org_id_idx" ON "trial_grants" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "trial_grants_status_idx" ON "trial_grants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "abuse_flags_user_idx" ON "abuse_flags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "abuse_flags_org_idx" ON "abuse_flags" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "devices_fingerprint_idx" ON "devices" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "usage_requests_org_created_idx" ON "usage_requests" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_requests_status_idx" ON "usage_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usage_requests_user_idx" ON "usage_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_idx" ON "admin_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");