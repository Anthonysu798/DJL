ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "message_id" uuid;--> statement-breakpoint

ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "image_aspect_ratio" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_message_id_messages_id_fk' AND conrelid = 'public.files'::regclass) THEN
    ALTER TABLE "files" ADD CONSTRAINT "files_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "files_generated_gallery_idx" ON "files" USING btree ("user_id","org_id","created_at","id") WHERE "files"."source" = 'generated' AND "files"."deleted_at" IS NULL;
