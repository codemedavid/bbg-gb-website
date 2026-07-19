-- BBG Groupbuy — COMPLETE Supabase setup (schema + full store data).
-- Generated from lib/db/data/catalog.ts. Paste into Supabase SQL Editor and Run.
-- Re-running clears the seeded domain tables first, then repopulates (matches npm run db:seed).

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

-- ============ SEED DATA ============
-- Clear domain tables in dependency order (mirrors scripts/seed.ts clearAll).
TRUNCATE "order_status_history","order_items","orders","coa_files","products","categories","group_buys","payment_methods","email_log","users" RESTART IDENTITY CASCADE;

-- Categories
INSERT INTO "categories" ("name","slug","sort_order") VALUES
  ('GLP-1', 'glp-1', 1),
  ('Blends', 'blends', 2),
  ('Recovery', 'recovery', 3),
  ('Skin', 'skin', 4),
  ('Wellness', 'wellness', 5),
  ('BAC', 'bac', 6),
  ('Aesthetics', 'aesthetics', 7);

-- Products
INSERT INTO "products" ("code","name","spec","category_id","price_php","price_usd","is_on_hand","on_hand_kit_php","on_hand_piece_php","stock","arrival_group","description","image_emoji","sold_count") VALUES
  ('BBG1000-15', 'Tirzepatide', '15mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 3200, 51.2, true, 5000, 550, 120, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 340),
  ('BBG1000-30', 'Tirzepatide', '30mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 4850, 77.6, true, 6500, 700, 90, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 280),
  ('BBG1000-40', 'Tirzepatide', '40mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 6250, 100, false, NULL, NULL, 60, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 150),
  ('BBG1000-60', 'Tirzepatide', '60mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 10625, 170, false, NULL, NULL, 40, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 95),
  ('TR30', 'Tirzepatide (Salt Form)', '30mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 6375, 102, false, NULL, NULL, 30, 'salt_liquid'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 60),
  ('BBG1000-R10', 'Retatrutide', '10mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 4375, 70, false, NULL, NULL, 80, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 210),
  ('BBG1000-R15', 'Retatrutide', '15mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 5625, 90, false, NULL, NULL, 70, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 175),
  ('BBG1000-R20', 'Retatrutide', '20mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 6875, 110, false, NULL, NULL, 55, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 130),
  ('RT10', 'Retatrutide (Salt Form)', '10mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 4687.5, 75, true, 6300, 650, 25, 'salt_liquid'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 40),
  ('CGL5', 'Cagrilintide', '5mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 4050, 64.8, false, NULL, NULL, 45, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 88),
  ('CGL10', 'Cagrilintide', '10mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 7050, 112.8, false, NULL, NULL, 35, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 52),
  ('BBG-5AD', 'AOD9604 Pro Max', '5mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 5350, 85.6, true, 7200, 750, 30, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 70),
  ('TS5', 'Tesamorelin', '5mg vial', (SELECT id FROM categories WHERE slug='glp-1'), 4875, 78, false, NULL, NULL, 40, 'white_powder'::arrival_group, 'Research-grade GLP-1 peptide. Lyophilized powder, sealed sterile vial. Store refrigerated after reconstitution with BAC water.', '💧', 65),
  ('LC600', 'L-Carnitine', '600mg', (SELECT id FROM categories WHERE slug='blends'), 3750, 60, false, NULL, NULL, 50, 'salt_liquid'::arrival_group, 'Injectable blend, ready-to-use multi-dose vial. Store in a cool, dry place away from direct sunlight.', '🧴', 120),
  ('LC1200', 'L-Carnitine', '1200mg', (SELECT id FROM categories WHERE slug='blends'), 4200, 67.2, false, NULL, NULL, 45, 'salt_liquid'::arrival_group, 'Injectable blend, ready-to-use multi-dose vial. Store in a cool, dry place away from direct sunlight.', '🧴', 98),
  ('LC120', 'Lipo C', '10ml vial', (SELECT id FROM categories WHERE slug='blends'), 3750, 60, false, NULL, NULL, 40, 'salt_liquid'::arrival_group, 'Injectable blend, ready-to-use multi-dose vial. Store in a cool, dry place away from direct sunlight.', '🧴', 160),
  ('LC216', 'Lipo C with B12', '10ml vial', (SELECT id FROM categories WHERE slug='blends'), 4375, 70, false, NULL, NULL, 38, 'salt_liquid'::arrival_group, 'Injectable blend, ready-to-use multi-dose vial. Store in a cool, dry place away from direct sunlight.', '🧴', 140),
  ('LC526', 'Fat Blaster', '10ml vial', (SELECT id FROM categories WHERE slug='blends'), 5937.5, 95, false, NULL, NULL, 30, 'salt_liquid'::arrival_group, 'Injectable blend, ready-to-use multi-dose vial. Store in a cool, dry place away from direct sunlight.', '🧴', 110),
  ('LC553', 'Supershred', '10ml vial', (SELECT id FROM categories WHERE slug='blends'), 4562.5, 73, false, NULL, NULL, 32, 'salt_liquid'::arrival_group, 'Injectable blend, ready-to-use multi-dose vial. Store in a cool, dry place away from direct sunlight.', '🧴', 90),
  ('SHB', 'Super Human Blend', '10ml vial', (SELECT id FROM categories WHERE slug='blends'), 4562.5, 73, false, NULL, NULL, 28, 'salt_liquid'::arrival_group, 'Injectable blend, ready-to-use multi-dose vial. Store in a cool, dry place away from direct sunlight.', '🧴', 76),
  ('HHB', 'Hair Skin & Nails', '10ml vial', (SELECT id FROM categories WHERE slug='blends'), 4562.5, 73, false, NULL, NULL, 26, 'salt_liquid'::arrival_group, 'Injectable blend, ready-to-use multi-dose vial. Store in a cool, dry place away from direct sunlight.', '🧴', 64),
  ('BPC157', 'BPC157', '10mg vial', (SELECT id FROM categories WHERE slug='recovery'), 3750, 60, false, NULL, NULL, 70, 'white_powder'::arrival_group, 'Research peptide for tissue and recovery studies. Lyophilized powder; reconstitute with BAC water before use.', '💧', 300),
  ('TB500', 'TB500', '10mg vial', (SELECT id FROM categories WHERE slug='recovery'), 7500, 120, false, NULL, NULL, 40, 'white_powder'::arrival_group, 'Research peptide for tissue and recovery studies. Lyophilized powder; reconstitute with BAC water before use.', '💧', 130),
  ('WOLV', 'Wolverine (TB500+BPC)', '10mg vial', (SELECT id FROM categories WHERE slug='recovery'), 6300, NULL, false, NULL, NULL, 35, 'white_powder'::arrival_group, 'Research peptide for tissue and recovery studies. Lyophilized powder; reconstitute with BAC water before use.', '💧', 145),
  ('MS10', 'MOTS-C', '10mg vial', (SELECT id FROM categories WHERE slug='recovery'), 3750, 60, false, NULL, NULL, 45, 'white_powder'::arrival_group, 'Research peptide for tissue and recovery studies. Lyophilized powder; reconstitute with BAC water before use.', '💧', 88),
  ('2S10', 'SS31', '10mg vial', (SELECT id FROM categories WHERE slug='recovery'), 4250, 68, false, NULL, NULL, 30, 'white_powder'::arrival_group, 'Research peptide for tissue and recovery studies. Lyophilized powder; reconstitute with BAC water before use.', '💧', 54),
  ('TA1', 'Thymosin Alpha 1', '5mg vial', (SELECT id FROM categories WHERE slug='recovery'), 4475, 71.6, false, NULL, NULL, 28, 'white_powder'::arrival_group, 'Research peptide for tissue and recovery studies. Lyophilized powder; reconstitute with BAC water before use.', '💧', 47),
  ('CJC-IPA', 'CJC w/o DAC + Ipamorelin', '10mg vial', (SELECT id FROM categories WHERE slug='recovery'), 5812.5, 93, false, NULL, NULL, 25, 'white_powder'::arrival_group, 'Research peptide for tissue and recovery studies. Lyophilized powder; reconstitute with BAC water before use.', '💧', 60),
  ('CU50', 'GHK-Cu', '50mg vial', (SELECT id FROM categories WHERE slug='skin'), 2200, 35.2, false, NULL, NULL, 60, 'white_powder'::arrival_group, 'Cosmetic-grade peptide for skin research. Lyophilized powder unless marked topical.', '💧', 190),
  ('CU100', 'GHK-Cu', '100mg vial', (SELECT id FROM categories WHERE slug='skin'), 2800, 44.8, true, 4200, 450, 50, 'white_powder'::arrival_group, 'Cosmetic-grade peptide for skin research. Lyophilized powder unless marked topical.', '💧', 160),
  ('KPV10', 'KPV', '10mg vial', (SELECT id FROM categories WHERE slug='skin'), 3300, 52.8, false, NULL, NULL, 40, 'white_powder'::arrival_group, 'Cosmetic-grade peptide for skin research. Lyophilized powder unless marked topical.', '💧', 84),
  ('CUV60', 'GHK-Cu + KPV', '60mg vial', (SELECT id FROM categories WHERE slug='skin'), 4100, 65.6, true, 6200, 650, 30, 'white_powder'::arrival_group, 'Cosmetic-grade peptide for skin research. Lyophilized powder unless marked topical.', '💧', 72),
  ('KLOW', 'KLOW', '80mg vial', (SELECT id FROM categories WHERE slug='skin'), 10625, 170, false, NULL, NULL, 20, 'white_powder'::arrival_group, 'Cosmetic-grade peptide for skin research. Lyophilized powder unless marked topical.', '💧', 44),
  ('CU-TOP', 'GHK-Cu Topical', '1000mg', (SELECT id FROM categories WHERE slug='skin'), 4350, 69.6, false, NULL, NULL, 25, 'salt_liquid'::arrival_group, 'Cosmetic-grade peptide for skin research. Lyophilized powder unless marked topical.', '🧴', 58),
  ('NJ100', 'NAD+', '100mg vial', (SELECT id FROM categories WHERE slug='wellness'), 2500, 40, false, NULL, NULL, 40, 'salt_liquid'::arrival_group, 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.', '💧', 96),
  ('NJ500', 'NAD+', '500mg vial', (SELECT id FROM categories WHERE slug='wellness'), 2625, 42, false, NULL, NULL, 38, 'salt_liquid'::arrival_group, 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.', '💧', 82),
  ('XA10', 'Semax', '10mg vial', (SELECT id FROM categories WHERE slug='wellness'), 3100, 49.6, false, NULL, NULL, 35, 'white_powder'::arrival_group, 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.', '💧', 70),
  ('SK10', 'Selank', '10mg vial', (SELECT id FROM categories WHERE slug='wellness'), 3100, 49.6, false, NULL, NULL, 34, 'white_powder'::arrival_group, 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.', '💧', 66),
  ('EPI10', 'Epithalon', '10mg vial', (SELECT id FROM categories WHERE slug='wellness'), 2812.5, 45, false, NULL, NULL, 30, 'white_powder'::arrival_group, 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.', '💧', 58),
  ('OXY5', 'Oxytocin', '5mg vial', (SELECT id FROM categories WHERE slug='wellness'), 2000, 32, false, NULL, NULL, 28, 'white_powder'::arrival_group, 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.', '💧', 40),
  ('DSIP5', 'DSIP', '5mg vial', (SELECT id FROM categories WHERE slug='wellness'), 2625, 42, false, NULL, NULL, 26, 'white_powder'::arrival_group, 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.', '💧', 36),
  ('GLU600', 'Glutathione', '600mg vial', (SELECT id FROM categories WHERE slug='wellness'), 3125, 50, false, NULL, NULL, 30, 'white_powder'::arrival_group, 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.', '💧', 62),
  ('PT141', 'PT141', '10mg vial', (SELECT id FROM categories WHERE slug='wellness'), 3750, 60, false, NULL, NULL, 32, 'white_powder'::arrival_group, 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.', '💧', 78),
  ('LL37', 'LL-37', '5mg vial', (SELECT id FROM categories WHERE slug='wellness'), 5000, 80, false, NULL, NULL, 22, 'white_powder'::arrival_group, 'Research peptide, lyophilized powder in sealed sterile vial. Reconstitute with BAC water.', '💧', 34),
  ('BBG0000-3ML', 'BAC Water', '3ml', (SELECT id FROM categories WHERE slug='bac'), 475, 7.6, true, 500, 55, 200, 'white_powder'::arrival_group, 'Bacteriostatic water (0.9% benzyl alcohol) for reconstituting lyophilized peptides.', '💦', 520),
  ('BBG0000-5ML', 'BAC Water', '5ml', (SELECT id FROM categories WHERE slug='bac'), 625, 10, true, 730, 75, 180, 'white_powder'::arrival_group, 'Bacteriostatic water (0.9% benzyl alcohol) for reconstituting lyophilized peptides.', '💦', 410),
  ('BBG0000-10ML', 'BAC Water', '10ml', (SELECT id FROM categories WHERE slug='bac'), 875, 14, false, NULL, NULL, 160, 'white_powder'::arrival_group, 'Bacteriostatic water (0.9% benzyl alcohol) for reconstituting lyophilized peptides.', '💦', 360),
  (NULL, 'Rejuran i', '1 prefilled syringe, 1ml', (SELECT id FROM categories WHERE slug='aesthetics'), 2300, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Rejuran s', '1 prefilled syringe, 1ml', (SELECT id FROM categories WHERE slug='aesthetics'), 2300, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Rejuran hb', '1 prefilled syringe, 1ml', (SELECT id FROM categories WHERE slug='aesthetics'), 2300, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Rejuran Healer', '2x2ml prefilled syringes', (SELECT id FROM categories WHERE slug='aesthetics'), 3450, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Rejuran Essence', '2x2ml prefilled syringes', (SELECT id FROM categories WHERE slug='aesthetics'), 3450, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Rejuran Trueskin', 'per piece', (SELECT id FROM categories WHERE slug='aesthetics'), 3450, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Profhilo', '1x2ml', (SELECT id FROM categories WHERE slug='aesthetics'), 2300, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Hyaron Skin Booster', '2.5mlx10 prefilled syringes', (SELECT id FROM categories WHERE slug='aesthetics'), 3250, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'NCTF135HA', '3mlx5 vials', (SELECT id FROM categories WHERE slug='aesthetics'), 1375, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'NCTF135HA Plus', '3mlx5 vials', (SELECT id FROM categories WHERE slug='aesthetics'), 1490, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Mesoestetic Mesohyal Organic Silicon', 'per piece', (SELECT id FROM categories WHERE slug='aesthetics'), 3970, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Kiara Reju', '2.2mlx3 prefilled syringes', (SELECT id FROM categories WHERE slug='aesthetics'), 2500, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Restylane Skin Booster', '1x1ml prefilled syringe', (SELECT id FROM categories WHERE slug='aesthetics'), 1400, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'JUVEDERM Ultra 2', '2x1ml prefilled syringes', (SELECT id FROM categories WHERE slug='aesthetics'), 3970, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'JUVEDERM Ultra 3', '2x1ml prefilled syringes', (SELECT id FROM categories WHERE slug='aesthetics'), 3970, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'JUVEDERM Ultra 4', '2x1ml prefilled syringes', (SELECT id FROM categories WHERE slug='aesthetics'), 3970, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'JUVEDERM Voluma', '2x1ml prefilled syringes', (SELECT id FROM categories WHERE slug='aesthetics'), 3970, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  ('YSG01', 'Periocular Peptide', '5ml', (SELECT id FROM categories WHERE slug='aesthetics'), 3437.5, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  ('ZSG02', 'Recombinant Peptide', '5ml', (SELECT id FROM categories WHERE slug='aesthetics'), 3000, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  ('FSG03', 'Composite Peptide', '5ml', (SELECT id FROM categories WHERE slug='aesthetics'), 2812.5, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  ('SSG04', 'Salmon Peptide', '5ml', (SELECT id FROM categories WHERE slug='aesthetics'), 2500, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  ('WSG05', 'Vitamin C Peptide', '5ml', (SELECT id FROM categories WHERE slug='aesthetics'), 3125, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  ('MSG06', 'Whitening Peptide', '5ml', (SELECT id FROM categories WHERE slug='aesthetics'), 3000, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  ('QSG07', 'Blue Peptide', '5ml', (SELECT id FROM categories WHERE slug='aesthetics'), 4062.5, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Nabota', 'per piece', (SELECT id FROM categories WHERE slug='aesthetics'), 1200, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Rentox', 'per piece', (SELECT id FROM categories WHERE slug='aesthetics'), 1200, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Botox Gas', 'per piece', (SELECT id FROM categories WHERE slug='aesthetics'), 1400, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0),
  (NULL, 'Xeomin', '100U', (SELECT id FROM categories WHERE slug='aesthetics'), 1400, NULL, false, NULL, NULL, 0, 'salt_liquid'::arrival_group, 'Ready-to-use aesthetic injectable — skin booster, dermal filler, or toxin. Prefilled and shipped cold; no reconstitution required.', '💉', 0);

-- Group buys
INSERT INTO "group_buys" ("name","price_per_kit_php","total_slots","claimed_slots","min_vials","arrival_group","status","closes_at","description") VALUES
  ('Tirzepatide + CGL 35mg', 9000, 100, 72, 7, 'salt_liquid'::arrival_group, 'open', now() + interval '2 days', 'MOQ kahati — 1 kit = 10 vials. TR+CGL blend arrives 3–5 days after white powders.'),
  ('Bioglutide', 10400, 100, 58, 7, 'salt_liquid'::arrival_group, 'open', now() + interval '4 days', 'MOQ kahati — 1 kit = 10 vials. Bioglutide arrives 3–5 days after white powders.'),
  ('Retatrutide 20mg', 6875, 100, 93, 7, 'white_powder'::arrival_group, 'open', now() + interval '1 days', 'MOQ kahati — 1 kit = 10 vials. White powder, ships first.'),
  ('Tirzepatide 60mg', 10625, 100, 25, 7, 'white_powder'::arrival_group, 'open', now() + interval '6 days', 'MOQ kahati — 1 kit = 10 vials. White powder, ships first.'),
  ('KLOW 80mg', 10625, 100, 14, 7, 'white_powder'::arrival_group, 'open', now() + interval '7 days', 'MOQ kahati — 1 kit = 10 vials. White powder, ships first.');

-- Payment methods (fill in real account details + QR in admin)
INSERT INTO "payment_methods" ("label","account_name","account_number","sort_order","is_active") VALUES
  ('GCash', 'BBG Peptides', 'Set in admin', 0, true),
  ('Maya', 'BBG Peptides', 'Set in admin', 1, true);

-- Users (admin@bbgpeptides.ph / ana@example.com — password: password123)
INSERT INTO "users" ("name","email","phone","password_hash","address","role") VALUES
  ('BBG Admin', 'admin@bbgpeptides.ph', '0917 000 0000', '$2a$10$V4waTh6ntRYX62h7YErM6u9ZbWSPzCpS8ZxkWuWeq7bNLOqSRiN1K', 'BBG HQ, Quezon City', 'admin'),
  ('Ana Reyes', 'ana@example.com', '0917 555 2210', '$2a$10$V4waTh6ntRYX62h7YErM6u9ZbWSPzCpS8ZxkWuWeq7bNLOqSRiN1K', 'Unit 4B, 22 Maginhawa St, Quezon City', 'customer');

-- Sample order BBG-2417 for the demo customer
INSERT INTO "orders" ("order_no","user_id","status","buy_type","subtotal_php","shipping_php","repack_fee_php","total_php","ship_name","ship_phone","ship_address","tracking_no")
VALUES ('BBG-2417', (SELECT id FROM users WHERE email='ana@example.com'), 'shipped', 'solo', 4375, 180, 0, 4555, 'Ana Reyes', '0917 555 2210', 'Unit 4B, 22 Maginhawa St, Quezon City', 'LBC 1784 2239 0011');

INSERT INTO "order_items" ("order_id","kind","product_id","name_snapshot","spec_snapshot","unit_price_php","qty","line_total_php") VALUES
  ((SELECT id FROM orders WHERE order_no='BBG-2417'), 'product', (SELECT id FROM products WHERE code='BPC157'), 'BPC157 10mg vial', 'Recovery', 3750, 1, 3750),
  ((SELECT id FROM orders WHERE order_no='BBG-2417'), 'product', (SELECT id FROM products WHERE code='BBG0000-5ML'), 'BAC Water 5ml', 'BAC', 625, 1, 625);

INSERT INTO "order_status_history" ("order_id","status")
SELECT (SELECT id FROM orders WHERE order_no='BBG-2417'), s
FROM unnest(ARRAY['proof_review','payment_confirmed','batch_filling','shipped']::order_status[]) AS s;
