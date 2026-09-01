--- email_log learns whether the mail was actually delivered.
---
--- The table recorded one row per notification with `sent_at` set and nothing
--- else — identical whether the mail was transmitted, refused, handed to a
--- PostHog workflow, or dropped because no workflow existed for its kind.
---
--- That is not a theoretical gap. Between 2026-08-17 and 2026-08-31 the app
--- minted 144 password reset links and logged 144 rows; customers received
--- almost none and retried up to 13 times each. There is no Vercel log access
--- for this project, so the swallowed errors went to nobody, and the outage was
--- found only when customers said so.
---
--- Existing rows default to 'unknown' rather than 'sent'. Backfilling them as
--- delivered would re-tell the exact lie these columns exist to end — nobody
--- knows what happened to those 144, and the table should say that.
ALTER TABLE "email_log" ADD COLUMN IF NOT EXISTS "delivered_by" varchar(20) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN IF NOT EXISTS "error" text;--> statement-breakpoint
--- Admin → Emails opens on "what failed", newest first.
CREATE INDEX IF NOT EXISTS "email_log_status_sent_at_idx" ON "email_log" ("status", "sent_at" DESC);
