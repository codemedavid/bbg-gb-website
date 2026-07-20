ALTER TYPE "public"."buy_type" ADD VALUE 'moq';--> statement-breakpoint
ALTER TYPE "public"."order_item_kind" ADD VALUE 'moq_product';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "moq_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"spec" varchar(120) DEFAULT '' NOT NULL,
	"description" text,
	"image_key" text,
	"image_emoji" varchar(8) DEFAULT '📦',
	"price_php" numeric(12, 2) NOT NULL,
	"price_usd" numeric(12, 2),
	"stock" integer DEFAULT 0 NOT NULL,
	"min_order_qty" integer DEFAULT 1 NOT NULL,
	"packing_fee_php" numeric(12, 2),
	"arrival_group" "arrival_group" DEFAULT 'white_powder' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "moq_product_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moq_products_active_idx" ON "moq_products" USING btree ("is_active");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "order_items" ADD CONSTRAINT "order_items_moq_product_id_moq_products_id_fk" FOREIGN KEY ("moq_product_id") REFERENCES "public"."moq_products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
