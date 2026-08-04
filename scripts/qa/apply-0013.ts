// Applies drizzle/0013_harsh_mauler.sql to the database behind DATABASE_URL.
//
// Written rather than `drizzle-kit push` on purpose. push diffs the whole schema
// and decides for itself what to alter; against a production database holding
// real orders, a catch-up should apply the one migration that is missing and
// nothing else. Every statement is additive (ADD COLUMN / ADD CONSTRAINT) and
// idempotent, and the lot runs in one transaction.
import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL'); process.exit(1); }

const STATEMENTS = [
  `ALTER TABLE "group_buys" ADD COLUMN IF NOT EXISTS "product_id" uuid`,
  `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_group_buy" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "gb_price_per_kit_php" numeric(12, 2)`,
  `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "gb_price_per_piece_php" numeric(12, 2)`,
  `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "gb_vials_per_kit" integer`,
  `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "gb_min_vials" integer`,
  `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "gb_max_vials_per_batch" integer`,
  `DO $$ BEGIN
     ALTER TABLE "group_buys" ADD CONSTRAINT "group_buys_product_id_products_id_fk"
       FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
];

const sql = postgres(url, { max: 1 });
try {
  await sql.begin(async (tx) => {
    for (const s of STATEMENTS) {
      await tx.unsafe(s);
      console.log('ok', s.split('\n')[0].slice(0, 90));
    }
  });
  console.log('\n0013 applied.');
} finally {
  await sql.end();
}
