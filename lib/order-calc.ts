// Quote math for the order calculator (/order-calc).
//
// The calculator is an estimate, not an order: nothing here writes to the cart
// and nothing here is authoritative at checkout. What it must be is *arithmetic
// the customer can trust* — so every number the page shows is produced here,
// where it is tested, rather than assembled inline in a component.
//
// It quotes the two SCHEDULED boards — Hatian and Pasabay — not the ready
// shelf. Those are the boards a pricelist is read for, and they are the reason
// nothing here mentions stock: a hatian and a campaign are both orders placed
// before the vials exist, so there is no shelf for a stock badge to describe.
import { groupBuyUnitPrice, groupBuyVialsPerKit, seededKitPrice, type GroupBuyPricing } from '@/lib/pricing';

// A blank query means "show me the pricelist", and the pricelist is ~170 rows.
// The cap keeps that from becoming 170 DOM nodes inside a 340px scroller.
export const SEARCH_LIMIT = 60;

// The catalogue fields the calculator reads. Narrower than Product on purpose:
// it documents exactly what a quote depends on, and lets the tests build a
// product without inventing two dozen irrelevant columns.
export type CalcProduct = GroupBuyPricing & {
  id: string;
  code: string | null;
  name: string;
  spec: string;
  /** The shop's price for one KIT — what a board falls back to. Never per vial. */
  pricePhp: string | number;
};

/** One product the customer has put in the quote, keyed by product id. */
export type CalcEntry = { id: string; qty: number };

export type CalcLine = {
  id: string;
  code: string | null;
  name: string;
  spec: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type OrderTotals = { subtotal: number; fee: number; total: number; vials: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

// Price of one vial, on the boards this page quotes.
//
// The same figure a Hatian counter and a Pasabay campaign are opened at, so a
// customer who prices a basket here and then joins a board is charged what they
// were quoted. Both boards seed through seededKitPrice — the admin's group buy
// kit price where there is one, else the shop price — and divide it down; the
// only shortcut past that is an explicit per-piece group buy price.
//
// The shop price is PER KIT (the workbook column is headed "PER KIT (10 VIALS)
// PRICE", see lib/db/data/catalog.ts), so it is always divided, never quoted as
// it stands. Reading it as a vial price quoted every product that is not
// stocked on-hand at ten times what either board charges for it.
//
// The on-hand shelf price is deliberately not consulted. It is a different
// board with a different fee, and a ready-stock vial legitimately costs more
// than a group buy one — quoting it here priced a hatian at the shelf rate.
//
// An unusable product yields 0 rather than NaN: a formatter is never worth a
// blank screen, and neither is a total.
export function vialPrice(p: CalcProduct): number {
  const piece = groupBuyUnitPrice(p, 'piece');
  if (piece != null) return piece;
  const kit = seededKitPrice(p, p.pricePhp);
  return kit == null ? 0 : round2(kit / groupBuyVialsPerKit(p));
}

// Matches name, code and spec. Code matching has to happen here because
// GET /api/products only filters on name and spec — and the code is what a
// customer holding a pricelist actually types.
export function searchProducts(products: CalcProduct[], query: string, limit = SEARCH_LIMIT): CalcProduct[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? products.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code ?? '').toLowerCase().includes(q) ||
        (p.spec ?? '').toLowerCase().includes(q))
    : products;
  return matched.slice(0, limit);
}

export function addEntry(entries: CalcEntry[], id: string): CalcEntry[] {
  return entries.some((e) => e.id === id)
    ? entries.map((e) => (e.id === id ? { ...e, qty: e.qty + 1 } : e))
    : [...entries, { id, qty: 1 }];
}

// Zero removes the line: stepping down from one is how the design deletes a
// row, so it has to leave nothing behind rather than a ghost worth ₱0.
export function setEntryQty(entries: CalcEntry[], id: string, qty: number): CalcEntry[] {
  if (qty <= 0) return entries.filter((e) => e.id !== id);
  return entries.map((e) => (e.id === id ? { ...e, qty } : e));
}

// An entry whose product has left the catalogue is dropped. It is a real case —
// an admin deactivating a product while a quote is open — and both available
// answers understate the total by what the line was worth. Dropping it at least
// does not also assert a ₱0 price that was never true.
export function buildLines(products: CalcProduct[], entries: CalcEntry[]): CalcLine[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return entries.flatMap((e) => {
    const p = byId.get(e.id);
    if (!p) return [];
    const unitPrice = vialPrice(p);
    return [{
      id: p.id, code: p.code, name: p.name, spec: p.spec,
      qty: e.qty, unitPrice, lineTotal: round2(unitPrice * e.qty),
    }];
  });
}

// The fee applies only to an order that exists. Quoting a packing fee over an
// empty basket is the one number on this page that would be plainly false.
export function orderTotals(lines: CalcLine[], packingFee: number): OrderTotals {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const vials = lines.reduce((sum, l) => sum + l.qty, 0);
  const fee = lines.length ? packingFee : 0;
  return { subtotal, fee, total: round2(subtotal + fee), vials };
}
