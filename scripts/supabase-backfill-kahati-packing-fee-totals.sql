-- Live database backfill for kahati orders created under the old downpayment model.
--
-- It only touches rows where the old bad shape is exact:
--   subtotal_php     = products only
--   packing_fee_php  = 0
--   total_php        = subtotal_php
--   downpayment_php  > 0
--
-- After this, the order reads correctly:
--   total_php = subtotal_php + packing_fee_php
UPDATE "orders"
SET
  "packing_fee_php" = "downpayment_php",
  "total_php" = "subtotal_php" + "downpayment_php"
WHERE "buy_type" = 'kahati'
  AND "downpayment_php" > 0
  AND "packing_fee_php" = 0
  AND "total_php" = "subtotal_php";
