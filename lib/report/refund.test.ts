import { describe, it, expect } from 'vitest';
import {
  parseShortfallPaste, buildRefundRows, refundCsv, refundSummary,
  type RefundOrderLine, type RefundShortfall,
} from './refund';

// A batch line, with the fields that do not vary across these cases defaulted.
const line = (o: Partial<RefundOrderLine> & Pick<RefundOrderLine, 'orderNo' | 'qty' | 'lineTotalPhp'>): RefundOrderLine => ({
  orderStatus: 'payment_confirmed',
  customerName: 'Test Buyer',
  customerPhone: '09171234567',
  customerEmail: 'buyer@example.com',
  productLabel: 'BPC157 10mg vial — kahati',
  supplierCode: null,
  productCode: null,
  orderedOn: '2026-08-07',
  ...o,
});

const sheet = (o: Partial<RefundShortfall> = {}): RefundShortfall =>
  ({ label: 'BPC10', kits: 0.4, php: 1500, ...o });

describe('parseShortfallPaste', () => {
  it('parses tab-separated rows pasted out of the supplier sheet', () => {
    const { rows } = parseShortfallPaste('BPC10\t0.4\t1500\nGHK50\t0.1\t220');

    expect(rows).toEqual([
      { label: 'BPC10', kits: 0.4, php: 1500 },
      { label: 'GHK50', kits: 0.1, php: 220 },
    ]);
  });

  it('ignores the empty leading column the sheet pastes in', () => {
    const { rows } = parseShortfallPaste('\tBPC10\t0.4\t1500');

    expect(rows).toEqual([{ label: 'BPC10', kits: 0.4, php: 1500 }]);
  });

  it('skips the header and TOTAL rows rather than treating them as SKUs', () => {
    const { rows, skipped } = parseShortfallPaste(
      'REFUND\nPEPTIDE\tKIT\nTOTAL\t7.2\t36481.25\nBPC10\t0.4\t1500',
    );

    expect(rows).toEqual([{ label: 'BPC10', kits: 0.4, php: 1500 }]);
    // The whole line is kept, not just its label — an admin checking what was
    // ignored needs to see the figures to know it was safe to ignore.
    expect(skipped).toContain('TOTAL\t7.2\t36481.25');
  });

  it('strips peso signs and thousands separators from the amount', () => {
    const { rows } = parseShortfallPaste('TA1 10\t0.3\t₱2,456.25');

    expect(rows[0]).toEqual({ label: 'TA1 10', kits: 0.3, php: 2456.25 });
  });

  it('accepts comma-separated input for a sheet exported as CSV', () => {
    const { rows } = parseShortfallPaste('GLOW,0.5,4600');

    expect(rows).toEqual([{ label: 'GLOW', kits: 0.5, php: 4600 }]);
  });

  it('reports a row it cannot read instead of dropping it silently', () => {
    const { rows, skipped } = parseShortfallPaste('BPC10\t0.4\t1500\nMYSTERY SKU');

    expect(rows).toHaveLength(1);
    expect(skipped).toContain('MYSTERY SKU');
  });
});

describe('buildRefundRows — matching a sheet SKU to batch lines', () => {
  it('matches on the product supplier code when one is mapped', () => {
    const rows = buildRefundRows([sheet()], [
      line({ orderNo: 'BBG-2472', qty: 2, lineTotalPhp: 750, supplierCode: 'BPC10' }),
      line({ orderNo: 'BBG-2521', qty: 2, lineTotalPhp: 750, supplierCode: 'BPC10' }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.matchedBy === 'supplier_code')).toBe(true);
  });

  it('ignores case and punctuation when comparing supplier codes', () => {
    const rows = buildRefundRows([sheet({ label: 'RT15 SF', php: 593.75, kits: 0.1 })], [
      line({ orderNo: 'BBG-2474', qty: 1, lineTotalPhp: 593.75, supplierCode: 'rt15-sf' }),
    ]);

    expect(rows[0].matchedBy).toBe('supplier_code');
  });

  it("falls back to the product's own code when no supplier code is mapped", () => {
    const rows = buildRefundRows([sheet({ label: 'PT141', kits: 0.4, php: 1500 })], [
      line({ orderNo: 'BBG-2515', qty: 4, lineTotalPhp: 1500, productCode: 'PT141' }),
    ]);

    expect(rows[0].matchedBy).toBe('product_code');
  });

  it('falls back to the per-vial price when neither code matches', () => {
    // ₱1500 over 0.4 kits = 4 vials = ₱375 a vial, which is what the line charges.
    const rows = buildRefundRows([sheet()], [
      line({ orderNo: 'BBG-2472', qty: 2, lineTotalPhp: 750 }),
    ]);

    expect(rows[0].matchedBy).toBe('unit_price');
  });

  it('prefers a supplier-code match over a coincidental price match', () => {
    const rows = buildRefundRows([sheet()], [
      line({ orderNo: 'BBG-2472', qty: 2, lineTotalPhp: 750, supplierCode: 'BPC10' }),
      // Same ₱375 a vial, a different product entirely.
      line({ orderNo: 'BBG-9999', qty: 2, lineTotalPhp: 750, productLabel: 'MOTS-C 10mg vial — kahati' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].orderNo).toBe('BBG-2472');
  });

  it('emits an UNMATCHED row naming the SKU when nothing matches', () => {
    const rows = buildRefundRows([sheet({ label: 'SKIN SM2', kits: 0.1, php: 395 })], [
      line({ orderNo: 'BBG-2493', qty: 2, lineTotalPhp: 395, productLabel: 'Skin Repair SM2 — Brown' }),
    ]);

    // 0.1 kit reads as 1 vial at ₱395, but the line charges ₱197.50 a unit, so
    // the price heuristic cannot see it. It must surface, not vanish.
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe('UNMATCHED');
    expect(rows[0].sku).toBe('SKIN SM2');
    expect(rows[0].skuRefundPhp).toBe(395);
    expect(rows[0].customer).toBe('');
  });

  it('leaves cancelled orders out of the match, as the batch rollup does', () => {
    const rows = buildRefundRows([sheet()], [
      line({ orderNo: 'BBG-2472', qty: 2, lineTotalPhp: 750, supplierCode: 'BPC10' }),
      line({ orderNo: 'KH-2640', qty: 2, lineTotalPhp: 750, supplierCode: 'BPC10', orderStatus: 'cancelled' }),
    ]);

    expect(rows.map((r) => r.orderNo)).toEqual(['BBG-2472']);
  });
});

describe('buildRefundRows — tiering', () => {
  it('marks a SKU CONFIRMED when the shortfall equals everything ordered', () => {
    const rows = buildRefundRows([sheet()], [
      line({ orderNo: 'BBG-2472', qty: 2, lineTotalPhp: 750, supplierCode: 'BPC10' }),
      line({ orderNo: 'BBG-2521', qty: 2, lineTotalPhp: 750, supplierCode: 'BPC10' }),
    ]);

    expect(rows.every((r) => r.tier === 'CONFIRMED')).toBe(true);
    expect(rows.map((r) => r.refundDuePhp)).toEqual([750, 750]);
  });

  it('marks a SKU ALLOCATE when more was ordered than the shortfall covers', () => {
    const rows = buildRefundRows([sheet({ label: 'KPV10', kits: 0.3, php: 990 })], [
      line({ orderNo: 'BBG-2476', qty: 5, lineTotalPhp: 1650, supplierCode: 'KPV10' }),
      line({ orderNo: 'BBG-2493', qty: 4, lineTotalPhp: 1320, supplierCode: 'KPV10' }),
    ]);

    expect(rows.every((r) => r.tier === 'ALLOCATE')).toBe(true);
    // Nobody's amount is decided — that is the admin's call, not a guess.
    expect(rows.every((r) => r.refundDuePhp === null)).toBe(true);
  });

  it('marks a SKU SHORT when the sheet asks for more than the batch ever sold', () => {
    const rows = buildRefundRows([sheet({ label: 'SKIN SM6', kits: 0.2, php: 790 })], [
      line({ orderNo: 'BBG-2493', qty: 2, lineTotalPhp: 395, supplierCode: 'SKIN SM6' }),
      line({ orderNo: 'BBG-2523', qty: 1, lineTotalPhp: 197.5, supplierCode: 'SKIN SM6' }),
    ]);

    expect(rows.every((r) => r.tier === 'SHORT')).toBe(true);
    expect(rows.every((r) => r.refundDuePhp === null)).toBe(true);
  });

  it('does not let centavo drift decide a tier', () => {
    // Three lines that sum to the sheet figure only after rounding.
    const rows = buildRefundRows([sheet({ label: 'TA1 5', kits: 0.3, php: 1342.5 })], [
      line({ orderNo: 'A', qty: 1, lineTotalPhp: 447.5, supplierCode: 'TA1 5' }),
      line({ orderNo: 'B', qty: 1, lineTotalPhp: 447.5, supplierCode: 'TA1 5' }),
      line({ orderNo: 'C', qty: 1, lineTotalPhp: 447.5, supplierCode: 'TA1 5' }),
    ]);

    expect(rows.every((r) => r.tier === 'CONFIRMED')).toBe(true);
  });

  it('carries the customer details onto every row', () => {
    const rows = buildRefundRows([sheet()], [
      line({
        orderNo: 'BBG-2472', qty: 4, lineTotalPhp: 1500, supplierCode: 'BPC10',
        customerName: 'Christine', customerPhone: '09103572843', customerEmail: 'c@example.com',
      }),
    ]);

    expect(rows[0]).toMatchObject({
      customer: 'Christine', phone: '09103572843', email: 'c@example.com',
      orderNo: 'BBG-2472', vialsOrdered: 4, perVialPhp: 375, refundDuePhp: 1500,
    });
  });
});

describe('refundSummary', () => {
  it('totals only what is decided, and counts what still needs a decision', () => {
    const rows = buildRefundRows(
      [sheet(), sheet({ label: 'KPV10', kits: 0.3, php: 990 }), sheet({ label: 'GONE', kits: 0.1, php: 100 })],
      [
        line({ orderNo: 'BBG-2472', qty: 4, lineTotalPhp: 1500, supplierCode: 'BPC10' }),
        line({ orderNo: 'BBG-2476', qty: 5, lineTotalPhp: 1650, supplierCode: 'KPV10' }),
      ],
    );

    expect(refundSummary(rows)).toEqual({
      confirmedPhp: 1500,
      confirmedRows: 1,
      allocatePhp: 990,
      allocateRows: 1,
      shortPhp: 0,
      unmatchedPhp: 100,
      unmatchedSkus: ['GONE'],
      sheetTotalPhp: 2590,
    });
  });
});

describe('refundCsv', () => {
  it('writes a header and one line per row', () => {
    const csv = refundCsv(buildRefundRows([sheet()], [
      line({ orderNo: 'BBG-2472', qty: 4, lineTotalPhp: 1500, supplierCode: 'BPC10' }),
    ]));
    const [header, ...body] = csv.split('\n');

    expect(header).toBe(
      'tier,sku,matched_by,product,order_no,order_status,customer,phone,email,'
      + 'vials_ordered,per_vial_php,sku_refund_vials,sku_refund_php,refund_due_php,ordered_on',
    );
    expect(body).toHaveLength(1);
    expect(body[0]).toContain('CONFIRMED');
  });

  it('quotes a field containing a comma so the columns do not shift', () => {
    const csv = refundCsv(buildRefundRows([sheet()], [
      line({ orderNo: 'BBG-2472', qty: 4, lineTotalPhp: 1500, supplierCode: 'BPC10', customerName: 'Cruz, Angelie' }),
    ]));

    expect(csv).toContain('"Cruz, Angelie"');
  });

  it('escapes a quote inside a field by doubling it', () => {
    const csv = refundCsv(buildRefundRows([sheet()], [
      line({ orderNo: 'BBG-2472', qty: 4, lineTotalPhp: 1500, supplierCode: 'BPC10', customerName: 'Ana "Nene" Reyes' }),
    ]));

    expect(csv).toContain('"Ana ""Nene"" Reyes"');
  });

  it('leaves an undecided amount blank rather than writing a zero', () => {
    const csv = refundCsv(buildRefundRows([sheet({ label: 'KPV10', kits: 0.3, php: 990 })], [
      line({ orderNo: 'BBG-2476', qty: 5, lineTotalPhp: 1650, supplierCode: 'KPV10' }),
    ]));

    // ...,1650 ordered,330 a vial,3 vials,990 due for the SKU,<blank>,date
    expect(csv.trim().split('\n')[1]).toMatch(/,990,,2026-08-07$/);
  });
});
