// Seeds categories, products, group buys, a demo customer + admin, and a sample order.
// Clears domain tables first (dependency order) so re-running gives a clean dataset.
import { getDb, closeDb } from '../lib/db';
import * as s from '../lib/db/schema';
import { hashPassword } from '../lib/auth';
import { CATEGORIES, CATEGORY_DESC, PRODUCTS, GROUP_BUYS } from '../lib/db/data/catalog';

async function clearAll(db: any) {
  await db.delete(s.orderStatusHistory);
  await db.delete(s.orderItems);
  await db.delete(s.orders);
  await db.delete(s.coaFiles);
  await db.delete(s.products);
  await db.delete(s.categories);
  await db.delete(s.groupBuys);
  await db.delete(s.emailLog);
  await db.delete(s.users);
}

async function main() {
  console.log('Seeding BBG Peptides database...');
  const db = await getDb();
  await clearAll(db);

  const catRows = await db.insert(s.categories).values(
    CATEGORIES.map((c) => ({ name: c.name, slug: c.slug, sortOrder: c.sortOrder }))
  ).returning();
  const catBySlug = new Map(catRows.map((c) => [c.slug, c.id]));
  console.log(`  ${catRows.length} categories`);

  const prodRows = await db.insert(s.products).values(
    PRODUCTS.map((p) => ({
      code: p.code,
      name: p.name,
      spec: p.spec,
      categoryId: catBySlug.get(p.cat)!,
      pricePhp: String(p.pricePhp),
      priceUsd: p.priceUsd != null ? String(p.priceUsd) : null,
      isOnHand: !!p.isOnHand,
      onHandKitPhp: p.onHandKitPhp != null ? String(p.onHandKitPhp) : null,
      onHandPiecePhp: p.onHandPiecePhp != null ? String(p.onHandPiecePhp) : null,
      stock: p.stock ?? 0,
      arrivalGroup: p.arrival,
      description: CATEGORY_DESC[p.cat],
      imageEmoji: p.emoji ?? '💧',
      soldCount: p.soldCount ?? 0,
    }))
  ).returning();
  console.log(`  ${prodRows.length} products`);

  const now = Date.now();
  await db.insert(s.groupBuys).values(
    GROUP_BUYS.map((g) => ({
      name: g.name,
      pricePerKitPhp: String(g.pricePerKitPhp),
      totalSlots: g.totalSlots,
      claimedSlots: g.claimedSlots,
      minVials: g.minVials,
      arrivalGroup: g.arrival,
      status: 'open' as const,
      closesAt: new Date(now + g.closesInDays * 86400_000),
      description: g.description,
    }))
  );
  console.log(`  ${GROUP_BUYS.length} group buys`);

  const pw = await hashPassword('password123');
  const [, customer] = await db.insert(s.users).values([
    { name: 'BBG Admin', email: 'admin@bbgpeptides.ph', phone: '0917 000 0000', passwordHash: pw, role: 'admin', address: 'BBG HQ, Quezon City' },
    { name: 'Ana Reyes', email: 'ana@example.com', phone: '0917 555 2210', passwordHash: pw, role: 'customer', address: 'Unit 4B, 22 Maginhawa St, Quezon City' },
  ]).returning();
  console.log('  2 users (admin@bbgpeptides.ph / ana@example.com - pw: password123)');

  const bpc = prodRows.find((p) => p.code === 'BPC157')!;
  const bac = prodRows.find((p) => p.code === 'BBG0000-5ML')!;
  const [order] = await db.insert(s.orders).values({
    orderNo: 'BBG-2417',
    userId: customer.id,
    status: 'shipped',
    buyType: 'solo',
    subtotalPhp: '4375',
    shippingPhp: '180',
    repackFeePhp: '0',
    totalPhp: '4555',
    shipName: customer.name,
    shipPhone: customer.phone!,
    shipAddress: customer.address!,
    trackingNo: 'LBC 1784 2239 0011',
  }).returning();
  await db.insert(s.orderItems).values([
    { orderId: order.id, kind: 'product', productId: bpc.id, nameSnapshot: 'BPC157 10mg vial', specSnapshot: 'Recovery', unitPricePhp: '3750', qty: 1, lineTotalPhp: '3750' },
    { orderId: order.id, kind: 'product', productId: bac.id, nameSnapshot: 'BAC Water 5ml', specSnapshot: 'BAC', unitPricePhp: '625', qty: 1, lineTotalPhp: '625' },
  ]);
  await db.insert(s.orderStatusHistory).values(
    (['proof_review', 'payment_confirmed', 'batch_filling', 'shipped'] as const).map((st) => ({ orderId: order.id, status: st }))
  );
  console.log('  1 sample order (BBG-2417)');

  console.log('Seed complete.');
  await closeDb();
}

main().catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
