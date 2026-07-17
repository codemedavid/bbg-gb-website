import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, orders, orderItems, orderStatusHistory, products, groupBuys } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession, ApiError } from '@/lib/session';
import { computeTotals, perVialPrice, validateKahatiCommit, round2, type PriceableItem } from '@/lib/pricing';
import { putFile } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { sendEmail, orderPlacedEmail } from '@/lib/email';

const MAX_PROOF_BYTES = 8 * 1024 * 1024;
const PROOF_TYPES = /^(image\/(jpe?g|png|webp|heic)|application\/pdf)$/;

const itemSchema = z.object({
  kind: z.enum(['product', 'group_buy']),
  refId: z.string().uuid(),
  qty: z.number().int().positive().max(9999),
});
const checkoutSchema = z.object({
  items: z.array(itemSchema).min(1),
  shipName: z.string().min(2).max(120),
  shipPhone: z.string().min(7).max(40),
  shipAddress: z.string().min(5).max(500),
});

type Priced = PriceableItem & { nameSnapshot: string; specSnapshot: string; productId?: string; groupBuyId?: string };

// Order numbers come from a Postgres sequence: nextval is atomic, so concurrent
// checkouts can never derive the same BBG-#### the way a count(*) would.
type Executor = { execute: (query: any) => Promise<unknown> };
async function nextOrderNo(tx: Executor): Promise<string> {
  const result = await tx.execute(sql`select nextval('order_no_seq')::int as n`);
  // postgres-js returns the rows array; PGlite returns { rows }.
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { n: number }[];
  return `BBG-${rows[0].n}`;
}

export const POST = handler(async (req: Request) => {
  const session = await requireSession();
  const form = await req.formData();
  const body = checkoutSchema.parse({
    items: JSON.parse(String(form.get('items') ?? '[]')),
    shipName: form.get('shipName'),
    shipPhone: form.get('shipPhone'),
    shipAddress: form.get('shipAddress'),
  });

  const proof = form.get('proof');
  if (!(proof instanceof File) || proof.size === 0) throw new ApiError(400, 'Payment proof is required to place an order.');
  if (proof.size > MAX_PROOF_BYTES) throw new ApiError(400, 'Proof must be 8MB or smaller.');
  if (!PROOF_TYPES.test(proof.type)) throw new ApiError(400, 'Proof must be an image or PDF.');

  const db = await getDb();

  // Store the proof before opening the transaction — it is an external side effect.
  // A rolled-back order leaves an orphaned object, which is harmless.
  const ext = (proof.name.split('.').pop() || 'bin').toLowerCase();
  const proofKey = `${randomUUID()}.${ext}`;
  await putFile(BUCKETS.proofs, proofKey, Buffer.from(await proof.arrayBuffer()), proof.type);

  // Everything touching inventory runs in one transaction, so a failure part-way
  // through cannot leave claimed kahati slots or decremented stock behind.
  const { order, orderNo, totals } = await db.transaction(async (tx) => {
    // Re-price server-side; never trust client prices.
    const priced: Priced[] = [];
    for (const it of body.items) {
      if (it.kind === 'product') {
        const [p] = await tx.select().from(products).where(and(eq(products.id, it.refId), eq(products.isActive, true)));
        if (!p) throw new ApiError(400, `Product not available: ${it.refId}`);
        priced.push({ kind: 'product', unitPricePhp: Number(p.pricePhp), qty: it.qty, nameSnapshot: `${p.name} ${p.spec}`, specSnapshot: p.spec, productId: p.id });
      } else {
        const [g] = await tx.select().from(groupBuys).where(eq(groupBuys.id, it.refId));
        if (!g) throw new ApiError(400, `Group buy not found: ${it.refId}`);
        if (g.status !== 'open') throw new ApiError(400, `Kahati "${g.name}" is already closed.`);
        // Honour this group buy's admin-editable minimum, not just the global default.
        const check = validateKahatiCommit(it.qty, g.totalSlots - g.claimedSlots, g.minVials);
        if (!check.ok) throw new ApiError(400, check.message!);

        // Claim the slots atomically. The guard lives in the UPDATE itself, so two
        // concurrent commits cannot both pass a stale remaining-slots check and oversell.
        const [claimed] = await tx.update(groupBuys)
          .set({ claimedSlots: sql`${groupBuys.claimedSlots} + ${it.qty}` })
          .where(and(
            eq(groupBuys.id, g.id),
            eq(groupBuys.status, 'open'),
            sql`${groupBuys.claimedSlots} + ${it.qty} <= ${groupBuys.totalSlots}`,
          ))
          .returning({ claimedSlots: groupBuys.claimedSlots });
        if (!claimed) {
          const [fresh] = await tx.select({ remaining: sql<number>`${groupBuys.totalSlots} - ${groupBuys.claimedSlots}` })
            .from(groupBuys).where(eq(groupBuys.id, g.id));
          throw new ApiError(400, `Only ${Math.max(fresh?.remaining ?? 0, 0)} vials left in this kahati.`);
        }

        priced.push({
          kind: 'group_buy',
          unitPricePhp: perVialPrice(Number(g.pricePerKitPhp)),
          qty: it.qty,
          repackFeePhp: Number(g.repackFeePhp), // admin-editable per group buy
          nameSnapshot: `${g.name} — kahati`,
          specSnapshot: `Kahati · min ${g.minVials} vials`,
          groupBuyId: g.id,
        });
      }
    }

    const totals = computeTotals(priced);
    const orderNo = await nextOrderNo(tx);

    const [order] = await tx.insert(orders).values({
      orderNo, userId: session.sub, status: 'proof_review', buyType: totals.buyType,
      subtotalPhp: String(totals.subtotal), shippingPhp: String(totals.shipping),
      repackFeePhp: String(totals.repackFee), totalPhp: String(totals.total),
      shipName: body.shipName, shipPhone: body.shipPhone, shipAddress: body.shipAddress,
      paymentProofKey: proofKey,
    }).returning();

    await tx.insert(orderItems).values(priced.map((p) => ({
      orderId: order.id, kind: p.kind, productId: p.productId ?? null, groupBuyId: p.groupBuyId ?? null,
      nameSnapshot: p.nameSnapshot, specSnapshot: p.specSnapshot,
      unitPricePhp: String(p.unitPricePhp), qty: p.qty, lineTotalPhp: String(round2(p.unitPricePhp * p.qty)),
    })));
    await tx.insert(orderStatusHistory).values({ orderId: order.id, status: 'proof_review', note: 'Order placed' });

    // Solo inventory counters. Kahati slots were already claimed above.
    for (const p of priced) {
      if (p.kind === 'product' && p.productId) {
        await tx.update(products).set({
          soldCount: sql`${products.soldCount} + ${p.qty}`,
          stock: sql`GREATEST(${products.stock} - ${p.qty}, 0)`,
        }).where(eq(products.id, p.productId));
      }
    }

    return { order, orderNo, totals };
  });

  // Email only after the transaction commits — never notify about a rolled-back order.
  await sendEmail({ to: session.email, ...orderPlacedEmail({ name: body.shipName, orderNo, total: totals.total }), kind: 'order_placed' });
  return ok({ order, orderNo, totals }, 201);
});

export const GET = handler(async () => {
  const session = await requireSession();
  const db = await getDb();
  const rows = await db.select().from(orders).where(eq(orders.userId, session.sub)).orderBy(desc(orders.createdAt));
  const withItems = await Promise.all(rows.map(async (o) => ({
    ...o, items: await db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
  })));
  return ok(withItems);
});
