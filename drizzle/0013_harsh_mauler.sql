ALTER TABLE "group_buys" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_group_buy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gb_price_per_kit_php" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gb_price_per_piece_php" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gb_vials_per_kit" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gb_min_vials" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gb_max_vials_per_batch" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_buys" ADD CONSTRAINT "group_buys_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
