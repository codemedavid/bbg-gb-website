// The packing/address list the team prints on packing day.
//
// It is one block per order — buyer, contact, address, contents — because that
// is what gets read while a parcel is being filled and labelled. The .xlsx is
// the wrong shape for it: a spreadsheet row cannot hold a wrapped address at a
// readable size, and nobody packs from a screen they have to scroll sideways.
import { describe, it, expect } from 'vitest';
import { buildWeeklyReport, type ReportOrderInput } from './build';
import { buildPackingList, packingListHtml } from './packing-list';

const order = (o: Partial<ReportOrderInput>): ReportOrderInput => ({
  orderNo: 'GB-2559', status: 'payment_confirmed', createdAt: '2026-08-09T02:00:00Z',
  shipName: 'Charlotte Inson', shipPhone: '09483977723',
  customerEmail: 'charlotte@example.com',
  shipAddress: 'Puroke 2B, Barangay 1, San Francisco, 8501 Agusan Del Sur',
  courier: 'J&T', packedBy: 'Nova', paymentMethod: 'GCash',
  totalUsd: '0', totalPhp: '5950',
  items: [{ nameSnapshot: 'Tirzepatide 30mg vial', qty: 3, unitPriceUsd: null, unitPricePhp: '1500' }],
  ...o,
});

const listFor = (orders: ReportOrderInput[]) =>
  buildPackingList(buildWeeklyReport('2026-08-03', orders));

describe('buildPackingList', () => {
  it('carries the fields the client asked to see beside each address', () => {
    expect(listFor([order({})])).toEqual([{
      index: 1,
      invoice: 'GB-2559',
      date: '8/9/2026',
      buyer: 'Charlotte Inson',
      phone: '09483977723',
      email: 'charlotte@example.com',
      address: 'Puroke 2B, Barangay 1, San Francisco, 8501 Agusan Del Sur',
      courier: 'J&T',
      items: ['Tirzepatide 30mg vial x3 @ ₱1500.00'],
      totalPhp: 5950,
    }]);
  });

  // A cancelled order is not packed, and a printed sheet that lists it is how a
  // parcel gets made up for someone who was refunded.
  it('leaves cancelled orders off the sheet', () => {
    const list = listFor([
      order({}),
      order({ orderNo: 'GB-9999', status: 'cancelled', shipName: 'Ghost' }),
    ]);

    expect(list.map((e) => e.invoice)).toEqual(['GB-2559']);
  });

  it('renumbers from one so the printed sheet counts its own parcels', () => {
    const list = listFor([
      order({ orderNo: 'GB-1', status: 'cancelled' }),
      order({ orderNo: 'GB-2' }),
      order({ orderNo: 'GB-3' }),
    ]);

    expect(list.map((e) => e.index)).toEqual([1, 2]);
  });

  it('names a missing courier rather than leaving the label blank', () => {
    expect(listFor([order({ courier: null })])[0].courier).toBe('To be assigned');
  });

  it('renders an empty range as no entries', () => {
    expect(listFor([])).toEqual([]);
  });
});

describe('packingListHtml', () => {
  const html = (orders: ReportOrderInput[]) =>
    packingListHtml(listFor(orders), { title: 'Group Buy', rangeLabel: 'Aug 3 – Aug 9' });

  it('prints every order block with its address and contents', () => {
    const out = html([order({})]);

    expect(out).toContain('GB-2559');
    expect(out).toContain('Charlotte Inson');
    expect(out).toContain('Puroke 2B, Barangay 1, San Francisco, 8501 Agusan Del Sur');
    expect(out).toContain('Tirzepatide 30mg vial x3 @ ₱1500.00');
    expect(out).toContain('Aug 3 – Aug 9');
  });

  // Addresses, buyer names and order notes are customer-supplied and land in a
  // document opened in a browser window. Interpolating them raw is a stored XSS
  // that fires the moment the team prints the sheet.
  it('escapes customer-supplied text instead of interpolating it as markup', () => {
    const out = html([order({
      shipName: '<script>alert(1)</script>',
      shipAddress: '12 "Mabini" St & Co <b>QC</b>',
    })]);

    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&amp;');
    expect(out).not.toContain('<b>QC</b>');
  });

  it('carries a print stylesheet so each parcel stays whole across a page break', () => {
    const out = html([order({})]);

    expect(out).toContain('@media print');
    expect(out).toContain('break-inside: avoid');
  });

  it('states the parcel count so the printout can be checked against the pile', () => {
    const out = html([order({ orderNo: 'GB-1' }), order({ orderNo: 'GB-2' })]);
    expect(out).toContain('2 parcels');
  });

  it('says so plainly when the range has nothing to pack', () => {
    expect(html([])).toContain('No orders to pack');
  });
});
