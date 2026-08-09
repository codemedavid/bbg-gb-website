--- Multiple proofs of payment per hatian settlement.
---
--- The mirror of 0020, for the other payment flow. A settlement is usually the
--- LARGEST payment a customer makes — it clears the balance on every hatian
--- they joined this cycle plus the packing fee — so it is the one a bank's
--- per-transfer cap is most likely to split into two or three.
---
--- Its own table rather than reusing order_payment_proofs: a settlement covers
--- several orders at once, so hanging its proofs off that table would mean
--- either duplicating every row per order or inventing a nullable order_id that
--- means "not this one".
CREATE TABLE IF NOT EXISTS "settlement_payment_proofs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "settlement_id" uuid NOT NULL REFERENCES "settlements"("id") ON DELETE cascade,
  "storage_key" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "amount_php" numeric(12, 2),
  "reference" varchar(80),
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "settlement_payment_proofs_settlement_idx" ON "settlement_payment_proofs" ("settlement_id");--> statement-breakpoint

--- Carry every existing settlement's single proof across, so one submitted
--- before this table existed shows its screenshot rather than appearing to have
--- none. settlements.payment_proof_key is left in place and still written.
INSERT INTO "settlement_payment_proofs" ("settlement_id", "storage_key", "sort_order", "uploaded_at")
SELECT "id", "payment_proof_key", 0, "created_at"
FROM "settlements"
WHERE "payment_proof_key" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "settlement_payment_proofs" p WHERE p."settlement_id" = "settlements"."id"
  );
