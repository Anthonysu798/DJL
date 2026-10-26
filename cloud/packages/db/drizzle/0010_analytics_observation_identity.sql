DROP INDEX "analytics_source_history_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_source_observation_uidx" ON "analytics_source_snapshots" USING btree ("source","dimension_key","observed_at");--> statement-breakpoint
CREATE INDEX "analytics_source_retention_idx" ON "analytics_source_snapshots" USING btree ("observed_at");