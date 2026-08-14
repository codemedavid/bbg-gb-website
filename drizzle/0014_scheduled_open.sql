--- Time-scheduled opening for both boards.
---
--- Until now a hatian or a group buy batch was live the instant it was saved:
--- the only date either carried was the one it closes on. An admin who wanted a
--- campaign to go up on Monday had to be at a keyboard on Monday.
---
--- 'scheduled' is the state before 'open' — the row exists and holds its terms,
--- but is off the storefront and joinable by nobody. There is deliberately still
--- no scheduler process: the flip to 'open' rides the lazy sweeps that already
--- resolve deadlines, so it costs no new infrastructure and cannot drift out of
--- step with the expiry it shares a pass with.
---
--- ADD VALUE BEFORE 'open' keeps the enum reading in lifecycle order. It is
--- additive, so every existing row keeps its status and every existing query
--- keeps its meaning: nothing is 'scheduled' until something is written that way.
ALTER TYPE "group_buy_status" ADD VALUE IF NOT EXISTS 'scheduled' BEFORE 'open';--> statement-breakpoint
ALTER TYPE "moq_campaign_status" ADD VALUE IF NOT EXISTS 'scheduled' BEFORE 'open';--> statement-breakpoint

--- Nullable with no default, which is what makes this migration safe to apply to
--- a live board: NULL reads as "already open", so every row written before today
--- keeps behaving exactly as it did.
ALTER TABLE "group_buys" ADD COLUMN IF NOT EXISTS "opens_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moq_campaigns" ADD COLUMN IF NOT EXISTS "opens_at" timestamp with time zone;
