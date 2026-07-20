// Client feedback #6: the exported report must carry the buyer's shipping
// address, contact number, name, order details, payment status and order status
// as distinct, accurate fields.
//
// The PDF-era row conflated two of those: a single `status` column mixed payment
// state with fulfilment state, and `contact` glued phone and email into one
// newline-joined string that reads fine in a PDF cell but is useless in a
// spreadsheet column you want to sort or dial from.
import { describe, it, expect } from 'vitest';
import { buildWeeklyReport, type ReportOrderInput } from './build';

const order = (o: Partial<ReportOrderInput>): ReportOrderInput => ({
  orderNo: 'BBG-0001', status: 'payment_confirmed', createdAt: '2026-05-27T02:00:00Z',
  shipName: 'Gelly Ramos', shipPhone: '09171234567', customerEmail: 'gelly@example.com',
  shipAddress: '12 Mabini St, Quezon City', courier: 'J&T', packedBy: 'Nova',
  paymentMethod: 'GCash', totalUsd: '10.00', totalPhp: '560.00',
  items: [{ nameSnapshot: 'Tirzepatide TR15', qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' }],
  ...o,
});

const rowFor = (o: Partial<ReportOrderInput>) => buildWeeklyReport('2026-05-25', [order(o)]).rows[0];

describe('buyer information on report rows', () => {
  it('carries the buyer name, phone and email as separate fields', () => {
    const r = rowFor({});

    expect(r.customer).toBe('Gelly Ramos');
    expect(r.phone).toBe('09171234567');
    expect(r.email).toBe('gelly@example.com');
  });

  it('carries the full shipping address', () => {
    expect(rowFor({}).address).toBe('12 Mabini St, Quezon City');
  });

  it('leaves email blank rather than undefined when the buyer has no account email', () => {
    expect(rowFor({ customerEmail: null }).email).toBe('');
  });
});

describe('payment status vs order status', () => {
  it('reports an unverified payment as pending while the order is still awaiting review', () => {
    const r = rowFor({ status: 'proof_review' });

    expect(r.paymentStatus).toBe('Pending');
    expect(r.orderStatus).toBe('Payment Verification');
  });

  it('reports a confirmed payment as paid once the proof clears', () => {
    const r = rowFor({ status: 'payment_confirmed' });

    expect(r.paymentStatus).toBe('Paid');
    expect(r.orderStatus).toBe('Payment Verified');
  });

  it('keeps payment paid while the order moves through fulfilment', () => {
    expect(rowFor({ status: 'batch_filling' }).paymentStatus).toBe('Paid');
    expect(rowFor({ status: 'shipped' }).paymentStatus).toBe('Paid');
    expect(rowFor({ status: 'delivered' }).paymentStatus).toBe('Paid');

    expect(rowFor({ status: 'shipped' }).orderStatus).toBe('Shipped');
    expect(rowFor({ status: 'delivered' }).orderStatus).toBe('Delivered');
  });

  it('reports a cancelled order as refunded rather than paid', () => {
    const r = rowFor({ status: 'cancelled' });

    expect(r.paymentStatus).toBe('Refunded');
    expect(r.orderStatus).toBe('Cancelled');
  });
});

describe('order details', () => {
  it('lists every line item, not just the first', () => {
    const r = rowFor({
      items: [
        { nameSnapshot: 'Tirzepatide TR15', qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' },
        { nameSnapshot: 'BAC Water 3ml', qty: 2, unitPriceUsd: null, unitPricePhp: '55.00' },
      ],
    });

    expect(r.products).toEqual(['Tirzepatide TR15 x5 @ $6.80', 'BAC Water 3ml x2']);
  });
});
