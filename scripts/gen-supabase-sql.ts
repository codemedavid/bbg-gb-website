// Generates a single, self-contained SQL file (schema + full seed) to run in the
// Supabase SQL Editor. Data is pulled from the real catalog source so it stays in
// sync with the app seed. Output: scripts/supabase-full-setup.sql
import { writeFileSync, readFileSync } from 'node:fs';
import { CATEGORIES, CATEGORY_DESC, PRODUCTS, GROUP_BUYS } from '../lib/db/data/catalog';

// bcrypt hash of 'password123' (same password for both seeded users).
const PW_HASH = '$2a$10$V4waTh6ntRYX62h7YErM6u9ZbWSPzCpS8ZxkWuWeq7bNLOqSRiN1K';

const q = (v: string | null | undefined): string =>
  v == null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;
const n = (v: number | null | undefined): string => (v == null ? 'NULL' : String(v));
const b = (v: boolean | undefined): string => (v ? 'true' : 'false');

// Schema DDL: reuse the consolidated block from supabase-setup.sql, minus its admin
// insert (we seed users below).
const setup = readFileSync(new URL('./supabase-setup.sql', import.meta.url), 'utf8');
const ddl = setup.split('-- ---- Admin user')[0].trimEnd();

const lines: string[] = [];
lines.push('-- BBG Groupbuy — COMPLETE Supabase setup (schema + full store data).');
lines.push('-- Generated from lib/db/data/catalog.ts. Paste into Supabase SQL Editor and Run.');
lines.push('-- Re-running clears the seeded domain tables first, then repopulates (matches npm run db:seed).');
lines.push('');
lines.push(ddl);
lines.push('');
lines.push('-- ============ SEED DATA ============');
lines.push('-- Clear domain tables in dependency order (mirrors scripts/seed.ts clearAll).');
lines.push('TRUNCATE "order_status_history","order_items","orders","coa_files","products","categories","group_buys","payment_methods","email_log","users" RESTART IDENTITY CASCADE;');
lines.push('');

// Categories
lines.push('-- Categories');
lines.push('INSERT INTO "categories" ("name","slug","sort_order") VALUES');
lines.push(CATEGORIES.map((c) => `  (${q(c.name)}, ${q(c.slug)}, ${c.sortOrder})`).join(',\n') + ';');
lines.push('');

// Products (category_id resolved by slug subquery)
lines.push('-- Products');
lines.push('INSERT INTO "products" ("code","name","spec","category_id","price_php","price_usd","is_on_hand","on_hand_kit_php","on_hand_piece_php","stock","arrival_group","description","image_emoji","sold_count") VALUES');
lines.push(
  PRODUCTS.map((p) => {
    const cat = `(SELECT id FROM categories WHERE slug=${q(p.cat)})`;
    return `  (${q(p.code)}, ${q(p.name)}, ${q(p.spec)}, ${cat}, ${n(p.pricePhp)}, ${n(p.priceUsd)}, ${b(p.isOnHand)}, ${n(p.onHandKitPhp)}, ${n(p.onHandPiecePhp)}, ${p.stock ?? 0}, ${q(p.arrival)}::arrival_group, ${q(CATEGORY_DESC[p.cat])}, ${q(p.emoji ?? '💧')}, ${p.soldCount ?? 0})`;
  }).join(',\n') + ';',
);
lines.push('');

// Group buys (closes_at = now() + N days)
lines.push('-- Group buys');
lines.push('INSERT INTO "group_buys" ("name","price_per_kit_php","total_slots","claimed_slots","min_vials","arrival_group","status","closes_at","description") VALUES');
lines.push(
  GROUP_BUYS.map((g) =>
    `  (${q(g.name)}, ${n(g.pricePerKitPhp)}, ${g.totalSlots}, ${g.claimedSlots}, ${g.minVials}, ${q(g.arrival)}::arrival_group, 'open', now() + interval '${g.closesInDays} days', ${q(g.description)})`,
  ).join(',\n') + ';',
);
lines.push('');

// Payment methods
lines.push('-- Payment methods (fill in real account details + QR in admin)');
lines.push('INSERT INTO "payment_methods" ("label","account_name","account_number","sort_order","is_active") VALUES');
lines.push("  ('GCash', 'BBG Peptides', 'Set in admin', 0, true),");
lines.push("  ('Maya', 'BBG Peptides', 'Set in admin', 1, true);");
lines.push('');

// Users: admin + demo customer
lines.push('-- Users (admin@bbgpeptides.ph / ana@example.com — password: password123)');
lines.push('INSERT INTO "users" ("name","email","phone","password_hash","address","role") VALUES');
lines.push(`  ('BBG Admin', 'admin@bbgpeptides.ph', '0917 000 0000', ${q(PW_HASH)}, 'BBG HQ, Quezon City', 'admin'),`);
lines.push(`  ('Ana Reyes', 'ana@example.com', '0917 555 2210', ${q(PW_HASH)}, 'Unit 4B, 22 Maginhawa St, Quezon City', 'customer');`);
lines.push('');

// Sample order (references resolved by subquery, no ID capture needed)
lines.push('-- Sample order BBG-2417 for the demo customer');
lines.push(`INSERT INTO "orders" ("order_no","user_id","status","buy_type","subtotal_php","shipping_php","repack_fee_php","total_php","ship_name","ship_phone","ship_address","tracking_no")
VALUES ('BBG-2417', (SELECT id FROM users WHERE email='ana@example.com'), 'shipped', 'solo', 4375, 180, 0, 4555, 'Ana Reyes', '0917 555 2210', 'Unit 4B, 22 Maginhawa St, Quezon City', 'LBC 1784 2239 0011');`);
lines.push('');
lines.push(`INSERT INTO "order_items" ("order_id","kind","product_id","name_snapshot","spec_snapshot","unit_price_php","qty","line_total_php") VALUES
  ((SELECT id FROM orders WHERE order_no='BBG-2417'), 'product', (SELECT id FROM products WHERE code='BPC157'), 'BPC157 10mg vial', 'Recovery', 3750, 1, 3750),
  ((SELECT id FROM orders WHERE order_no='BBG-2417'), 'product', (SELECT id FROM products WHERE code='BBG0000-5ML'), 'BAC Water 5ml', 'BAC', 625, 1, 625);`);
lines.push('');
lines.push(`INSERT INTO "order_status_history" ("order_id","status")
SELECT (SELECT id FROM orders WHERE order_no='BBG-2417'), s
FROM unnest(ARRAY['proof_review','payment_confirmed','batch_filling','shipped']::order_status[]) AS s;`);
lines.push('');

writeFileSync(new URL('./supabase-full-setup.sql', import.meta.url), lines.join('\n'), 'utf8');
console.log('Wrote scripts/supabase-full-setup.sql');
console.log(`  ${CATEGORIES.length} categories, ${PRODUCTS.length} products, ${GROUP_BUYS.length} group buys, 2 payment methods, 2 users, 1 sample order`);
