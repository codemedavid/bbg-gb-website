import { describe, it, expect } from 'vitest';
import { collectedBasisFor, buildPasaloRefunds, type BatchLine, type BatchOrderFacts } from './pasalo-refund';

// A cycle-era hatian order: deposit paid at checkout, goods settled later.
const order = (over: Partial<BatchOrderFacts> = {}): BatchOrderFacts => ({
  orderId: 'o1', userId: 'u1', downpaymentPhp: 150, packingFeePhp: 150,
  cycleKey: '2026-W36', paymentStatus: 'confirmed', settlementStatus: null, ...over,
});

const line = (over: Partial<BatchLine> = {}): BatchLine => ({
  orderItemId: 'i1', orderId: 'o1', userId: 'u1', groupBuyId: 'g1',
  lineTotalPhp: 550, qty: 1, failed: true,
  failureReason: 'Final combined quantity 5/7 minimum after Pasalo closed (3 Kahati + 2 Pasalo).',
  ...over,
});

const REFUNDABLE = { refundable: true };

describe('collectedBasisFor — which of the customer\'s money actually cleared', () => {
  it('reads a paid settlement as the goods having been collected', () => {
    expect(collectedBasisFor(order({ settlementStatus: 'paid' }))).toBe('settlement_paid');
  });

  it('reads a cycle-era confirmed order as DEPOSIT only, not goods', () => {
    // The load-bearing rule. A hatian collects a deposit at checkout and settles
    // the goods after the batch is confirmed, so payment_status='confirmed' on
    // one of these proves the DEPOSIT was verified and nothing more. Reading it
    // as "goods paid" would refund the full vial price to someone who has not
    // paid it yet.
    expect(collectedBasisFor(order())).toBe('deposit_only');
  });

  it('reads a legacy pre-deferral order as goods collected', () => {
    // Generation 1 in lib/settlement.ts: a fee on the row and no cycle means it
    // was paid in full at checkout, before the fee was ever deferred. For those
    // 'confirmed' really does mean the goods were paid for.
    expect(collectedBasisFor(order({ cycleKey: null, packingFeePhp: 150 })))
      .toBe('payment_confirmed');
  });

  it('reads an unverified payment as nothing collected', () => {
    // A screenshot is not money. Refunding against an unverified proof sends
    // out cash that may never have come in.
    expect(collectedBasisFor(order({ paymentStatus: 'proof_submitted' }))).toBe('nothing_collected');
    expect(collectedBasisFor(order({ paymentStatus: 'pending' }))).toBe('nothing_collected');
    expect(collectedBasisFor(order({ paymentStatus: 'rejected' }))).toBe('nothing_collected');
    expect(collectedBasisFor(order({ paymentStatus: 'not_due' }))).toBe('nothing_collected');
  });

  it('lets a paid settlement win over an unverified checkout payment', () => {
    expect(collectedBasisFor(order({ paymentStatus: 'pending', settlementStatus: 'paid' })))
      .toBe('settlement_paid');
  });
});

describe('buildPasaloRefunds — goods', () => {
  it('refunds nothing on the goods when only the deposit was collected', () => {
    // The customer never paid for these vials. They simply drop out of what is
    // billed at settlement; sending ₱550 back would be paying out money that
    // never came in.
    const [row] = buildPasaloRefunds([line()], [order()], REFUNDABLE);
    expect(row.goodsPhp).toBe(0);
    expect(row.collectedBasis).toBe('deposit_only');
  });

  it('refunds the line total once the settlement is paid', () => {
    const [row] = buildPasaloRefunds([line()], [order({ settlementStatus: 'paid' })], REFUNDABLE);
    expect(row.goodsPhp).toBe(550);
  });

  it('uses the captured line total, never a recomputed current price', () => {
    // Edge case 23: the product was repriced after the order. The customer is
    // owed what they were charged.
    const [row] = buildPasaloRefunds(
      [line({ lineTotalPhp: 447.5, qty: 1 })],
      [order({ settlementStatus: 'paid' })],
      REFUNDABLE,
    );
    expect(row.goodsPhp).toBe(447.5);
  });

  it('leaves successful lines out of the refund entirely', () => {
    const rows = buildPasaloRefunds(
      [line({ orderItemId: 'ok', failed: false, failureReason: null }), line({ orderItemId: 'bad' })],
      [order({ settlementStatus: 'paid' })],
      REFUNDABLE,
    );
    expect(rows.map((r) => r.orderItemId)).toEqual(['bad']);
  });
});

describe('buildPasaloRefunds — the deposit', () => {
  it('keeps the deposit when the customer still has a surviving line', () => {
    // Edge case 9: a mixed result. The parcel still ships, so the fee that pays
    // to pack it is earned and is not refunded.
    const rows = buildPasaloRefunds(
      [line({ orderItemId: 'bad', groupBuyId: 'g1' }),
        line({ orderItemId: 'ok', groupBuyId: 'g2', failed: false, failureReason: null })],
      [order()],
      REFUNDABLE,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].depositPhp).toBe(0);
  });

  it('returns the deposit when every line the customer holds failed', () => {
    // No parcel ships for this customer at all, so there is nothing for the
    // packing fee to have bought.
    const rows = buildPasaloRefunds([line()], [order()], REFUNDABLE);
    expect(rows[0].depositPhp).toBe(150);
    expect(rows[0].amountPhp).toBe(150);
  });

  it('books one customer\'s deposit exactly once across several failed lines', () => {
    // Edge case 31: the deposit is charged per order, so spreading it over the
    // three failed lines of that order would refund ₱450 of a ₱150 payment.
    const rows = buildPasaloRefunds(
      [line({ orderItemId: 'a', groupBuyId: 'g1' }),
        line({ orderItemId: 'b', groupBuyId: 'g2' }),
        line({ orderItemId: 'c', groupBuyId: 'g3' })],
      [order()],
      REFUNDABLE,
    );
    expect(rows.reduce((s, r) => s + r.depositPhp, 0)).toBe(150);
  });

  it('attaches a repeated run\'s deposit to the same line every time', () => {
    // Reproducibility: the same input must produce the same sheet, so which
    // line carries the deposit cannot depend on row order.
    const lines = [line({ orderItemId: 'z', groupBuyId: 'g2' }), line({ orderItemId: 'a', groupBuyId: 'g1' })];
    const first = buildPasaloRefunds(lines, [order()], REFUNDABLE);
    const second = buildPasaloRefunds([...lines].reverse(), [order()], REFUNDABLE);
    const carrier = (rows: typeof first) => rows.find((r) => r.depositPhp > 0)?.orderItemId;
    expect(carrier(first)).toBe('a');
    expect(carrier(second)).toBe('a');
  });

  it('sums the deposits of a customer\'s several orders in the batch', () => {
    // Edge case 11: two orders in one batch. Only the first paid the cycle fee;
    // the second was waived to ₱0 and has nothing to give back.
    const rows = buildPasaloRefunds(
      [line({ orderItemId: 'a', orderId: 'o1' }),
        line({ orderItemId: 'b', orderId: 'o2' })],
      [order({ orderId: 'o1', downpaymentPhp: 150 }),
        order({ orderId: 'o2', downpaymentPhp: 0, packingFeePhp: 0 })],
      REFUNDABLE,
    );
    expect(rows.reduce((s, r) => s + r.depositPhp, 0)).toBe(150);
  });

  it('keeps a non-refundable deposit, as the policy the customer agreed to says', () => {
    const rows = buildPasaloRefunds([line()], [order()], { refundable: false });
    expect(rows[0].depositPhp).toBe(0);
    expect(rows[0].amountPhp).toBe(0);
  });

  it('does not return a deposit that was never verified', () => {
    const rows = buildPasaloRefunds(
      [line()], [order({ paymentStatus: 'proof_submitted' })], REFUNDABLE,
    );
    expect(rows[0].depositPhp).toBe(0);
    expect(rows[0].collectedBasis).toBe('nothing_collected');
  });

  it('keeps one customer\'s failure from releasing another customer\'s deposit', () => {
    const rows = buildPasaloRefunds(
      [line({ orderItemId: 'a', userId: 'u1', orderId: 'o1' }),
        line({ orderItemId: 'b', userId: 'u2', orderId: 'o2', failed: false, failureReason: null })],
      [order({ orderId: 'o1', userId: 'u1' }), order({ orderId: 'o2', userId: 'u2' })],
      REFUNDABLE,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('u1');
    expect(rows[0].depositPhp).toBe(150);
  });
});

describe('buildPasaloRefunds — totals and guards', () => {
  it('never produces a negative amount', () => {
    // Edge case 30. A corrupt or hand-edited line total cannot become a CHARGE
    // to the customer. Isolated from the deposit so this asserts the floor and
    // not the sum: a deposit of 0 leaves the goods figure as the whole amount.
    const rows = buildPasaloRefunds(
      [line({ lineTotalPhp: -50 })],
      [order({ settlementStatus: 'paid', downpaymentPhp: 0 })],
      REFUNDABLE,
    );
    expect(rows[0].goodsPhp).toBe(0);
    expect(rows[0].amountPhp).toBe(0);
  });

  it('adds goods and deposit into the stored amount', () => {
    const rows = buildPasaloRefunds([line()], [order({ settlementStatus: 'paid' })], REFUNDABLE);
    expect(rows[0].goodsPhp).toBe(550);
    expect(rows[0].depositPhp).toBe(150);
    expect(rows[0].amountPhp).toBe(700);
  });

  it('rounds to the centavo once, at the end', () => {
    const rows = buildPasaloRefunds(
      [line({ lineTotalPhp: 447.505 })], [order({ settlementStatus: 'paid', downpaymentPhp: 0 })], REFUNDABLE,
    );
    expect(rows[0].amountPhp).toBe(447.51);
  });

  it('carries the counter\'s failure reason onto every refunded line', () => {
    const rows = buildPasaloRefunds([line()], [order()], REFUNDABLE);
    expect(rows[0].reason).toContain('5/7 minimum after Pasalo closed');
  });

  it('still emits a row for a line where nothing was collected', () => {
    // ₱0 owed, but the admin has to SEE it: an unverified proof may be a real
    // payment nobody got round to checking, and a row that is simply absent is
    // a customer nobody ever looks at again.
    const rows = buildPasaloRefunds([line()], [order({ paymentStatus: 'pending' })], REFUNDABLE);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountPhp).toBe(0);
    expect(rows[0].collectedBasis).toBe('nothing_collected');
  });

  it('drops a line whose order it was given no facts for, rather than guessing', () => {
    // Refusing to invent a payment state is the point: an unknown order could
    // be fully paid, and assuming either way moves money.
    const rows = buildPasaloRefunds([line({ orderId: 'ghost' })], [order()], REFUNDABLE);
    expect(rows).toEqual([]);
  });
});

describe('buildPasaloRefunds — the worked example from the brief', () => {
  it('consolidates one customer across two orders without double counting', () => {
    // Order #1001: Product A success ₱500, Product B failed ₱300
    // Order #1042: Product B failed ₱300, Product C success ₱600
    // Settled, so the goods were collected -> ₱600 of refund, and no deposit
    // because the parcel still ships their A and C.
    const rows = buildPasaloRefunds(
      [
        line({ orderItemId: 'a', orderId: '1001', groupBuyId: 'gA', lineTotalPhp: 500, failed: false, failureReason: null }),
        line({ orderItemId: 'b', orderId: '1001', groupBuyId: 'gB', lineTotalPhp: 300 }),
        line({ orderItemId: 'c', orderId: '1042', groupBuyId: 'gB', lineTotalPhp: 300 }),
        line({ orderItemId: 'd', orderId: '1042', groupBuyId: 'gC', lineTotalPhp: 600, failed: false, failureReason: null }),
      ],
      [order({ orderId: '1001', settlementStatus: 'paid' }), order({ orderId: '1042', settlementStatus: 'paid' })],
      REFUNDABLE,
    );
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.amountPhp, 0)).toBe(600);
    expect(rows.every((r) => r.depositPhp === 0)).toBe(true);
  });
});
