ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'free_grant' BEFORE 'trial_grant';--> statement-breakpoint
ALTER TABLE "credit_balances" ADD COLUMN "free" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reset_banks" ADD COLUMN "redeem_idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "reset_banks_redeem_idx" ON "reset_banks" USING btree ("user_id","redeem_idempotency_key");