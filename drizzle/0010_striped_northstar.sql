ALTER TYPE "public"."moq_campaign_status" ADD VALUE 'completed' BEFORE 'cancelled';--> statement-breakpoint
ALTER TABLE "moq_campaigns" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "moq_campaigns" ADD COLUMN "batch_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
--- Every campaign that existed before batching is batch #1 of its own series.
--- Without this backfill their successors would have no series to join, and a
--- commitment against a full legacy batch could not find the open one.
UPDATE "moq_campaigns" SET "series_id" = "id" WHERE "series_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moq_campaigns_series_idx" ON "moq_campaigns" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "moq_campaigns_series_batch_idx" ON "moq_campaigns" USING btree ("series_id","batch_no");