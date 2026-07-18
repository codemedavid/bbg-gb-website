-- BBG Groupbuy — full schema + admin user for Supabase.
-- Consolidated from drizzle/0000..0003 into the final state, so enums are
-- created with all their final values (no ALTER TYPE ADD VALUE needed, which
-- lets this whole file run inside the Supabase SQL Editor's transaction).
-- Safe to re-run: guarded with IF NOT EXISTS / duplicate_object handling.

-- ---- Enums -------------------------------------------------------------
DO $$ BEGIN CREATE TYPE "public"."arrival_group" AS ENUM('white_powder','salt_liquid'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."buy_type" AS ENUM('solo','kahati','group_buy'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."group_buy_status" AS ENUM('open','closed','shipped','completed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."order_item_kind" AS ENUM('product','group_buy','moq_campaign'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."order_status" AS ENUM('proof_review','payment_confirmed','batch_filling','shipped','delivered','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."user_role" AS ENUM('customer','admin'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."moq_campaign_status" AS ENUM('open','approved','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---- Sequences ---------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS "public"."order_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 2418 CACHE 1;

-- ---- Tables ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40),
	"name" varchar(160) NOT NULL,
	"spec" varchar(120) NOT NULL,
	"category_id" uuid,
	"price_php" numeric(12, 2) NOT NULL,
	"price_usd" numeric(12, 2),
	"is_on_hand" boolean DEFAULT false NOT NULL,
	"on_hand_kit_php" numeric(12, 2),
	"on_hand_piece_php" numeric(12, 2),
	"stock" integer DEFAULT 0 NOT NULL,
	"arrival_group" "arrival_group" DEFAULT 'white_powder' NOT NULL,
	"description" text,
	"image_emoji" varchar(8) DEFAULT '💧',
	"is_active" boolean DEFAULT true NOT NULL,
	"sold_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "coa_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"batch" varchar(40),
	"file_name" varchar(200) NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_email" varchar(200) NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"kind" varchar(60) NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "group_buys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"price_per_kit_php" numeric(12, 2) NOT NULL,
	"total_slots" integer DEFAULT 100 NOT NULL,
	"claimed_slots" integer DEFAULT 0 NOT NULL,
	"min_vials" integer DEFAULT 7 NOT NULL,
	"repack_fee_php" numeric(12, 2) DEFAULT '150' NOT NULL,
	"status" "group_buy_status" DEFAULT 'open' NOT NULL,
	"closes_at" timestamp with time zone,
	"arrival_group" "arrival_group" DEFAULT 'white_powder' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "moq_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"price_per_kit_php" numeric(12, 2) NOT NULL,
	"moq" integer DEFAULT 10 NOT NULL,
	"committed" integer DEFAULT 0 NOT NULL,
	"per_customer_min" integer DEFAULT 1 NOT NULL,
	"shipping_php" numeric(12, 2) DEFAULT '300' NOT NULL,
	"status" "moq_campaign_status" DEFAULT 'open' NOT NULL,
	"deadline" timestamp with time zone,
	"included_products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"arrival_group" "arrival_group" DEFAULT 'white_powder' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(200) NOT NULL,
	"phone" varchar(40),
	"password_hash" text NOT NULL,
	"address" text,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE IF NOT EXISTS "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" varchar(20) NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'proof_review' NOT NULL,
	"buy_type" "buy_type" DEFAULT 'solo' NOT NULL,
	"subtotal_php" numeric(12, 2) NOT NULL,
	"shipping_php" numeric(12, 2) DEFAULT '0' NOT NULL,
	"repack_fee_php" numeric(12, 2) DEFAULT '0' NOT NULL,
	"packing_fee_php" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_php" numeric(12, 2) NOT NULL,
	"downpayment_php" numeric(12, 2) DEFAULT '0' NOT NULL,
	"ship_name" varchar(120) NOT NULL,
	"ship_phone" varchar(40) NOT NULL,
	"ship_address" text NOT NULL,
	"payment_proof_key" text,
	"payment_method" varchar(40),
	"tracking_no" varchar(80),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_no_unique" UNIQUE("order_no")
);

CREATE TABLE IF NOT EXISTS "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "order_item_kind" DEFAULT 'product' NOT NULL,
	"product_id" uuid,
	"group_buy_id" uuid,
	"moq_campaign_id" uuid,
	"name_snapshot" varchar(200) NOT NULL,
	"spec_snapshot" varchar(120),
	"unit_price_php" numeric(12, 2) NOT NULL,
	"qty" integer NOT NULL,
	"line_total_php" numeric(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "order_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(40) NOT NULL,
	"account_name" varchar(120) NOT NULL,
	"account_number" varchar(60) NOT NULL,
	"qr_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "settings" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ---- Foreign keys ------------------------------------------------------
DO $$ BEGIN ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id"); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "coa_files" ADD CONSTRAINT "coa_files_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id"); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_items" ADD CONSTRAINT "order_items_group_buy_id_group_buys_id_fk" FOREIGN KEY ("group_buy_id") REFERENCES "public"."group_buys"("id"); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_items" ADD CONSTRAINT "order_items_moq_campaign_id_moq_campaigns_id_fk" FOREIGN KEY ("moq_campaign_id") REFERENCES "public"."moq_campaigns"("id"); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---- Indexes -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS "order_items_order_idx" ON "order_items" USING btree ("order_id");
CREATE INDEX IF NOT EXISTS "order_items_product_idx" ON "order_items" USING btree ("product_id");
CREATE INDEX IF NOT EXISTS "orders_user_idx" ON "orders" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "orders_created_idx" ON "orders" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders" USING btree ("status");
CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products" USING btree ("category_id");
CREATE INDEX IF NOT EXISTS "products_active_idx" ON "products" USING btree ("is_active");

-- ---- Admin user --------------------------------------------------------
-- password_hash below is bcrypt for 'password123'. Change the password after
-- first login. Re-running resets the password + role for this email.
INSERT INTO "users" ("name","email","phone","password_hash","address","role")
VALUES (
	'BBG Admin',
	'admin@bbgpeptides.ph',
	'0917 000 0000',
	'$2a$10$V4waTh6ntRYX62h7YErM6u9ZbWSPzCpS8ZxkWuWeq7bNLOqSRiN1K',
	'BBG HQ, Quezon City',
	'admin'
)
ON CONFLICT ("email") DO UPDATE
	SET "password_hash" = EXCLUDED."password_hash",
	    "role" = 'admin';
