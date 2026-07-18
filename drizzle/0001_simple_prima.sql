CREATE TYPE "public"."moq_campaign_status" AS ENUM('open', 'approved', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."buy_type" ADD VALUE 'group_buy';--> statement-breakpoint
ALTER TYPE "public"."order_item_kind" ADD VALUE 'moq_campaign';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "moq_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"price_per_kit_php" numeric(12, 2) NOT NULL,
	"moq" integer DEFAULT 10 NOT NULL,
	"committed" integer DEFAULT 0 NOT NULL,
	"per_customer_min" integer DEFAULT 1 NOT NULL,
	"shipping_php" numeric(12, 2) DEFAULT '180' NOT NULL,
	"status" "moq_campaign_status" DEFAULT 'open' NOT NULL,
	"deadline" timestamp with time zone,
	"included_products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"arrival_group" "arrival_group" DEFAULT 'white_powder' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "moq_campaign_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "order_items" ADD CONSTRAINT "order_items_moq_campaign_id_moq_campaigns_id_fk" FOREIGN KEY ("moq_campaign_id") REFERENCES "public"."moq_campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
