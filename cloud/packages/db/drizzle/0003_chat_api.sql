ALTER TABLE "conversations" ADD COLUMN "current_leaf_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_message_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "purpose" text DEFAULT 'attachment' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "text_content" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "leaf_message_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_current_leaf_id_messages_id_fk" FOREIGN KEY ("current_leaf_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_leaf_message_id_messages_id_fk" FOREIGN KEY ("leaf_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_list_idx" ON "conversations" USING btree ("user_id","pinned","last_message_at");