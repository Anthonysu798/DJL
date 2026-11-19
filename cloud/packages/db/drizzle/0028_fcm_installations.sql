CREATE TABLE "fcm_installations" (
  "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "device_id" uuid REFERENCES "devices"("id") ON DELETE CASCADE,
  "installation_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fcm_installations_installation_idx" ON "fcm_installations" ("installation_id");
--> statement-breakpoint
CREATE INDEX "fcm_installations_user_idx" ON "fcm_installations" ("user_id");
