ALTER TABLE "order_items" ADD COLUMN "unit_price_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "courier" varchar(40) DEFAULT 'J&T' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "packed_by" varchar(60);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "total_usd" numeric(12, 2) DEFAULT '0' NOT NULL;