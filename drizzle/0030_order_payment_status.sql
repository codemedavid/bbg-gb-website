--- An order now says what is happening to the MONEY, separately from what is
--- happening to the parcel.
---
--- `orders.status` ran proof_review -> payment_confirmed -> batch_filling ->
--- shipped -> delivered: two payment facts and three fulfilment facts in one
--- column. A repeat kahati commitment owes ₱0 at checkout (the cycle's packing
--- fee is already paid) and has no proof for an admin to review, so it had no
--- state to be in — and checkout wrote 'payment_confirmed', which the customer
--- reads as "Payment Confirmed".
---
--- Before this migration: 72 orders born that way, ₱158,453.75 of goods between
--- them, ₱0.00 collected, 38 carrying no proof at all.
---
--- NOT NULL DEFAULT 'pending' is the safe reading for a row nobody has
--- classified — money owed, nothing seen. The backfill below then states the
--- truth for every existing row.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint

--- Backfill, mirroring derivePaymentStatus in lib/payment-status.ts exactly.
--- The two must agree: this decides the stored value, that decides what a row
--- means if the column is ever absent, and a difference between them would show
--- up as an order changing its mind about whether it was paid.

--- A cancellation is a FULFILMENT fact and must not overwrite a payment one:
--- a cancelled order the customer paid into is still paid into, and reading it
--- as "nothing due" forgets a refund we owe. 19 cancelled orders carry a proof
--- and 10 hold deposits. Only a cancelled order that was never paid is not_due.
UPDATE "orders" SET "payment_status" = 'confirmed'
 WHERE "status" = 'cancelled'
   AND ("payment_proof_key" IS NOT NULL
        OR EXISTS (SELECT 1 FROM "order_payment_proofs" p WHERE p."order_id" = "orders"."id"));--> statement-breakpoint

UPDATE "orders" SET "payment_status" = 'not_due'
 WHERE "status" = 'cancelled'
   AND "payment_proof_key" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "order_payment_proofs" p WHERE p."order_id" = "orders"."id");--> statement-breakpoint

--- Awaiting review, split by whether evidence actually arrived.
UPDATE "orders" SET "payment_status" = 'proof_submitted'
 WHERE "status" = 'proof_review'
   AND ("payment_proof_key" IS NOT NULL
        OR EXISTS (SELECT 1 FROM "order_payment_proofs" p WHERE p."order_id" = "orders"."id"));--> statement-breakpoint

UPDATE "orders" SET "payment_status" = 'pending'
 WHERE "status" = 'proof_review'
   AND "payment_proof_key" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "order_payment_proofs" p WHERE p."order_id" = "orders"."id");--> statement-breakpoint

--- At or past payment_confirmed AND carrying proof: an admin really did verify
--- money against a screenshot. Genuinely confirmed.
UPDATE "orders" SET "payment_status" = 'confirmed'
 WHERE "status" IN ('payment_confirmed', 'batch_filling', 'shipped', 'delivered')
   AND ("payment_proof_key" IS NOT NULL
        OR EXISTS (SELECT 1 FROM "order_payment_proofs" p WHERE p."order_id" = "orders"."id"));--> statement-breakpoint

--- At or past payment_confirmed and carrying NO proof: these are the orders the
--- client reported. No payment was made and none was verified — the order was
--- simply born owing nothing today. This is the row that stops lying.
UPDATE "orders" SET "payment_status" = 'not_due'
 WHERE "status" IN ('payment_confirmed', 'batch_filling', 'shipped', 'delivered')
   AND "payment_proof_key" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "order_payment_proofs" p WHERE p."order_id" = "orders"."id");--> statement-breakpoint

--- "Which orders still need someone to look at money" is the admin's first
--- question every day, and after this it is a question about this column.
CREATE INDEX IF NOT EXISTS "orders_payment_status_idx" ON "orders" ("payment_status");
