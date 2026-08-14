--- Which trading cycle an order was placed in.
---
--- The packing fee is charged once per Group Buy/Hatian cycle, which is only
--- answerable if an order records the cycle it belongs to. Deriving it from
--- created_at was the alternative and is a trap: it re-resolves the cycle
--- against whatever recurrence is configured TODAY, so an admin moving the
--- schedule would retroactively move orders between cycles and silently re-bill
--- customers for weeks that already happened. The cycle is stamped once, at
--- checkout, and never recomputed.
---
--- The value is the cycle's opening instant in ISO form (see
--- lib/schedule-recurrence.ts). An instant rather than a week number because it
--- survives the schedule changing: the cycle a fee was paid in keeps its name.
---
--- Nullable with no default, which is what makes this safe to apply to a live
--- database: NULL means "belongs to no cycle", which is true of every on-hand
--- and MOQ order, and true of every order placed before cycles existed. Those
--- legacy orders keep behaving exactly as they did — they neither satisfy a
--- cycle's packing fee nor get charged a second one.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cycle_key" varchar(40);--> statement-breakpoint

--- "What has this customer already paid for in this cycle" is asked on every
--- gated checkout, and it is exactly this pair.
CREATE INDEX IF NOT EXISTS "orders_user_cycle_idx" ON "orders" ("user_id","cycle_key");
