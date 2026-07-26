CREATE TYPE "public"."settlement_status" AS ENUM('proof_review', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "settlement_status" DEFAULT 'proof_review' NOT NULL,
	"packing_fee_php" numeric(12, 2) NOT NULL,
	"balance_php" numeric(12, 2) NOT NULL,
	"total_php" numeric(12, 2) NOT NULL,
	"payment_method" varchar(40),
	"payment_proof_key" text,
	"idempotency_key" varchar(100),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "settlements_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "settlement_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settlements" ADD CONSTRAINT "settlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_user_idx" ON "settlements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_status_idx" ON "settlements" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
