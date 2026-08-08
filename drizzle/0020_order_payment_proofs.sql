--- Multiple proofs of payment per order.
---
--- Banks cap a single transfer, so a ₱4,500 order is commonly paid as
--- ₱2,000 + ₱1,500 + ₱1,000. Each transfer is its own payment with its own
--- screenshot, amount and bank reference, and the customer had one slot to put
--- them in. Up to five now hang off one order — three payments must never
--- become three orders.
---
--- A table rather than five more columns on `orders`: the rows are a list the
--- admin walks through and reconciles, not fixed attributes of an order.
CREATE TABLE IF NOT EXISTS "order_payment_proofs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE cascade,
  "storage_key" text NOT NULL,
  --- Submission order, which is what "Proof #1" counts. Stored rather than
  --- derived from uploaded_at: the proofs of one checkout are written in a
  --- single transaction and can share a timestamp to the millisecond.
  "sort_order" integer DEFAULT 0 NOT NULL,
  --- Admin-entered while verifying against the bank statement. The customer
  --- uploads a picture; only the person reading the statement can say it was
  --- ₱1,500, so both are nullable and neither is asked for at checkout.
  "amount_php" numeric(12, 2),
  "reference" varchar(80),
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

--- Every read is "the proofs of this order", and the admin drawer does it on
--- every order it opens.
CREATE INDEX IF NOT EXISTS "order_payment_proofs_order_idx" ON "order_payment_proofs" ("order_id");--> statement-breakpoint

--- Carry every existing order's single proof across, so an order placed before
--- this table existed shows its proof in the new gallery rather than appearing
--- to have none. `orders.payment_proof_key` is deliberately left in place and
--- still written: five readers use it, and keeping it current makes this change
--- additive instead of a simultaneous rewrite of all of them.
INSERT INTO "order_payment_proofs" ("order_id", "storage_key", "sort_order", "uploaded_at")
SELECT "id", "payment_proof_key", 0, "created_at"
FROM "orders"
WHERE "payment_proof_key" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "order_payment_proofs" p WHERE p."order_id" = "orders"."id"
  );
