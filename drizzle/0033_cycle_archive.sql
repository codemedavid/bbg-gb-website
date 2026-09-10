--- Cycle archives: which trading cycle each listing belongs to.
---
--- orders.cycle_key has named the cycle an order was placed in since 0025. The
--- listings the orders point at — hatian counters and campaign batches — had no
--- such name, so the admin boards could only show them by STATUS, and a counter
--- sealed at the end of August sat on the September board beside its successor,
--- vials and all. "Start new cycle removed nothing."
---
--- With the key on the listing, a board is "live, or ended THIS cycle", and
--- everything older is filed under its cycle in Admin → Cycle archives.
---
--- Stamped by checkout on a listing's first commitment, and by the cycle
--- boundary on every listing it carries forward; the backfill below names the
--- listings that already traded.

ALTER TABLE "group_buys" ADD COLUMN IF NOT EXISTS "cycle_key" varchar(40);--> statement-breakpoint
ALTER TABLE "moq_campaigns" ADD COLUMN IF NOT EXISTS "cycle_key" varchar(40);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "group_buys_cycle_idx" ON "group_buys" ("cycle_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moq_campaigns_cycle_idx" ON "moq_campaigns" ("cycle_key");--> statement-breakpoint

--- A listing that took commitments belongs to the cycle its FIRST commitment
--- was placed in: a counter sealed by the boundary took every vial in one cycle,
--- and a counter an admin ended mid-cycle opened in the same cycle its joiners
--- paid in. MIN over the keys (ISO instants, so lexical = chronological) picks
--- that first cycle; listings whose orders predate cycle keys stay null.
UPDATE "group_buys" g SET "cycle_key" = src.first_cycle
FROM (
  SELECT oi.group_buy_id AS id, MIN(o.cycle_key) AS first_cycle
  FROM "order_items" oi JOIN "orders" o ON o.id = oi.order_id
  WHERE oi.group_buy_id IS NOT NULL AND o.cycle_key IS NOT NULL
  GROUP BY oi.group_buy_id
) src
WHERE g.id = src.id AND g."cycle_key" IS NULL;--> statement-breakpoint

UPDATE "moq_campaigns" c SET "cycle_key" = src.first_cycle
FROM (
  SELECT oi.moq_campaign_id AS id, MIN(o.cycle_key) AS first_cycle
  FROM "order_items" oi JOIN "orders" o ON o.id = oi.order_id
  WHERE oi.moq_campaign_id IS NOT NULL AND o.cycle_key IS NOT NULL
  GROUP BY oi.moq_campaign_id
) src
WHERE c.id = src.id AND c."cycle_key" IS NULL;
