--- Backfill kahati orders created under the old downpayment model.
---
--- Bad legacy shape:
---   subtotal_php     = products only
---   packing_fee_php  = 0
---   total_php        = subtotal_php
---   downpayment_php  = 150
---
--- Current rule:
---   total_php = subtotal_php + packing_fee_php
---
--- The downpayment amount in those rows was really the kahati packing fee paid
--- at checkout. Move it into packing_fee_php and add it on top of the subtotal
--- so admin/customer screens no longer read as though it was deducted.
UPDATE "orders"
SET
  "packing_fee_php" = "downpayment_php",
  "total_php" = "subtotal_php" + "downpayment_php"
WHERE "buy_type" = 'kahati'
  AND "downpayment_php" > 0
  AND "packing_fee_php" = 0
  AND "total_php" = "subtotal_php";--> statement-breakpoint
