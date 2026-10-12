ALTER TABLE "files" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "image_aspect_ratio" text;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_generated_gallery_idx" ON "files" USING btree ("user_id","org_id","created_at","id") WHERE "files"."source" = 'generated' AND "files"."deleted_at" IS NULL;