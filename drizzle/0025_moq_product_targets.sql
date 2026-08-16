--- The MOQ shelf stops being on-hand inventory.
---
--- The shelf was modelled on the shop: `stock` was a real count, an order drew
--- it down, and a cancellation put it back. That was never true of these items
--- — nothing is on hand. The MOQ is a TARGET: the units all buyers together
--- must reach before the buy is placed with the supplier.
---
--- So the counter is inverted. `committed` climbs towards `moq` as orders are
--- placed instead of `stock` falling towards zero, and reaching the target no
--- longer means "sold out" — it means the buy goes ahead.
ALTER TABLE "moq_products" ADD COLUMN IF NOT EXISTS "moq" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "moq_products" ADD COLUMN IF NOT EXISTS "committed" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
--- Which round of the buy is accumulating. An admin closing a filled cycle
--- bumps this and resets `committed`, so one shelf item can run again and again.
ALTER TABLE "moq_products" ADD COLUMN IF NOT EXISTS "cycle_no" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
--- The cycle an order line joined, snapshotted on the line itself. Without it,
--- resetting `committed` for round 2 would silently flip every round-1 order
--- back to "Awaiting MOQ" — they would be waiting on a target that already
--- filled. Null for every line that is not an MOQ shelf line.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "moq_cycle_no" integer;
--> statement-breakpoint
--- Backfill. `min_order_qty` was the old per-order minimum, and on this shelf it
--- was the only number expressing "how many of these we need" — so it is the
--- honest seed for the target. Guarded on the column default so a re-run cannot
--- walk an admin-set target back down.
UPDATE "moq_products" SET "moq" = GREATEST("min_order_qty", 1) WHERE "moq" = 1;
--> statement-breakpoint
--- `min_order_qty` survives as what its name says: the fewest units ONE order
--- may contain. The headline number is `moq` now, so this drops back to 1 and
--- stops gating anything until an admin deliberately raises it.
UPDATE "moq_products" SET "min_order_qty" = 1 WHERE "min_order_qty" <> 1;
