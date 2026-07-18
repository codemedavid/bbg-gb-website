-- Migration for an EXISTING live database: adds the kahati downpayment column.
-- (New installs get it from supabase-setup.sql / supabase-full-setup.sql.)
-- Paste into the Supabase SQL Editor and Run. Safe to re-run.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "downpayment_php" numeric(12, 2) DEFAULT '0' NOT NULL;
