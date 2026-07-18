CREATE TABLE IF NOT EXISTS "settings" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moq_campaigns" ALTER COLUMN "shipping_php" SET DEFAULT '300';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "packing_fee_php" numeric(12, 2) DEFAULT '0' NOT NULL;