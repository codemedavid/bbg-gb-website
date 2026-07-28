// The group buy packing fee is paid per parcel, not per commitment.
//
// A customer with an order standing in a group buy has already paid to have
// that parcel packed; ordering more from the same group buy joins the parcel
// they paid for. Same shape as the kahati downpayment waiver in
// lib/kahati-commitment.ts, applied to the fee instead of the deposit.
import { describe, it, expect } from 'vitest';
import { seriesWithPaidPackingFee, campaignPackingFeeDue, type CampaignCommitment } from './campaign-commitment';

const held = (o: Partial<CampaignCommitment> = {}): CampaignCommitment => ({
  orderId: 'o1', orderNo: 'BBG-3001', seriesId: 's1', campaignName: 'Reta 20mg',
  orderStatus: 'proof_review', packingFeePhp: 300, qty: 1, lineTotalPhp: 10000,
  placedAt: '2026-07-01T00:00:00Z', ...o,
});

describe('seriesWithPaidPackingFee', () => {
  it('is empty when the customer holds nothing', () => {
    expect(seriesWithPaidPackingFee([]).size).toBe(0);
  });

  it('marks the series of an order that paid a packing fee', () => {
    expect(seriesWithPaidPackingFee([held()]).has('s1')).toBe(true);
  });

  it('marks only the series that was actually paid for', () => {
    const paid = seriesWithPaidPackingFee([held({ seriesId: 's1' })]);
    expect(paid.has('s2')).toBe(false);
  });

  it('ignores an order that was itself waived', () => {
    // Order #2 rode on order #1's fee for free. It cannot become the source of
    // a further waiver, or the fee would be dodged forever.
    expect(seriesWithPaidPackingFee([held({ packingFeePhp: 0 })]).has('s1')).toBe(false);
  });

  it('ignores a cancelled order — a refunded fee was never paid', () => {
    expect(seriesWithPaidPackingFee([held({ orderStatus: 'cancelled' })]).has('s1')).toBe(false);
  });

  it('ignores a shipped parcel — the next order buys a new one', () => {
    expect(seriesWithPaidPackingFee([held({ orderStatus: 'shipped' })]).has('s1')).toBe(false);
    expect(seriesWithPaidPackingFee([held({ orderStatus: 'delivered' })]).has('s1')).toBe(false);
  });

  it('counts a parcel that is still being assembled', () => {
    for (const orderStatus of ['proof_review', 'payment_confirmed', 'batch_filling'] as const) {
      expect(seriesWithPaidPackingFee([held({ orderStatus })]).has('s1')).toBe(true);
    }
  });

  it('keeps the series paid when a later order in it was waived', () => {
    const paid = seriesWithPaidPackingFee([held(), held({ orderId: 'o2', packingFeePhp: 0 })]);
    expect(paid.has('s1')).toBe(true);
  });
});

describe('campaignPackingFeeDue', () => {
  it('charges the listing fee when nothing has been paid for this series', () => {
    expect(campaignPackingFeeDue('s1', 300, new Set())).toBe(300);
  });

  it('charges nothing when the series already has a paid parcel', () => {
    expect(campaignPackingFeeDue('s1', 300, new Set(['s1']))).toBe(0);
  });

  it('still charges for a different series', () => {
    expect(campaignPackingFeeDue('s2', 300, new Set(['s1']))).toBe(300);
  });
});
