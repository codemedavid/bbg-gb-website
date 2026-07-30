import { describe, it, expect } from 'vitest';
import { groupCampaignParticipants, type CampaignOrderRow } from './campaign-participants';

const row = (o: Partial<CampaignOrderRow> = {}): CampaignOrderRow => ({
  orderId: 'o1', orderNo: 'BBG-1', orderStatus: 'proof_review',
  userId: 'u1', customerName: 'Ana Reyes', customerEmail: 'ana@example.com', customerPhone: '0917',
  shipPhone: '0917', shipAddress: '123 Mabini St',
  batchNo: 1, kits: 1, lineTotalPhp: 10400, packingFeePhp: 300, totalPhp: 10700,
  paymentMethod: 'GCash', placedAt: '2026-07-30T00:00:00.000Z',
  ...o,
});

describe('groupCampaignParticipants', () => {
  it('lists a customer once however many orders they placed in the group buy', () => {
    const out = groupCampaignParticipants([
      row({ orderId: 'o1', orderNo: 'BBG-1', kits: 1, packingFeePhp: 300 }),
      row({ orderId: 'o2', orderNo: 'BBG-2', kits: 2, packingFeePhp: 0 }),
      row({ orderId: 'o3', orderNo: 'BBG-3', kits: 1, packingFeePhp: 0 }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].customerEmail).toBe('ana@example.com');
    expect(out[0].orders.map((o) => o.orderNo)).toEqual(['BBG-1', 'BBG-2', 'BBG-3']);
  });

  it('sums every kit the customer committed across their orders', () => {
    const out = groupCampaignParticipants([
      row({ orderId: 'o1', kits: 1 }), row({ orderId: 'o2', kits: 2 }), row({ orderId: 'o3', kits: 1 }),
    ]);
    expect(out[0].kits).toBe(4);
  });

  it('reports one packing fee for the customer, not one per order', () => {
    const out = groupCampaignParticipants([
      row({ orderId: 'o1', packingFeePhp: 300 }),
      row({ orderId: 'o2', packingFeePhp: 0 }),
      row({ orderId: 'o3', packingFeePhp: 0 }),
    ]);
    expect(out[0].packingFeePhp).toBe(300);
  });

  // The guarantee this whole screen exists to make visible. A second fee in the
  // same group buy is the defect; the admin has to be able to see it, so it is
  // surfaced as a flag rather than silently summed away.
  it('flags a customer who was charged a packing fee twice in one group buy', () => {
    const out = groupCampaignParticipants([
      row({ orderId: 'o1', packingFeePhp: 300 }),
      row({ orderId: 'o2', packingFeePhp: 300 }),
    ]);
    expect(out[0].packingFeePhp).toBe(600);
    expect(out[0].chargedPackingFeeTwice).toBe(true);
  });

  it('does not flag the ordinary case of exactly one fee', () => {
    const out = groupCampaignParticipants([
      row({ orderId: 'o1', packingFeePhp: 300 }), row({ orderId: 'o2', packingFeePhp: 0 }),
    ]);
    expect(out[0].chargedPackingFeeTwice).toBe(false);
  });

  it('keeps different customers apart', () => {
    const out = groupCampaignParticipants([
      row({ userId: 'u1', customerEmail: 'ana@example.com', kits: 1 }),
      row({ userId: 'u2', customerEmail: 'ben@example.com', orderId: 'o2', kits: 3 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.kits).sort()).toEqual([1, 3]);
  });

  // A commitment that overflowed into a successor batch contributes one row per
  // batch under the SAME order. Those are the same parcel and the same money —
  // counting the order's total twice would overstate what the customer owes.
  it('counts an order once when it spans two batches of the series', () => {
    const out = groupCampaignParticipants([
      row({ orderId: 'o1', orderNo: 'BBG-1', batchNo: 1, kits: 8, totalPhp: 104300, packingFeePhp: 300 }),
      row({ orderId: 'o1', orderNo: 'BBG-1', batchNo: 2, kits: 2, totalPhp: 104300, packingFeePhp: 300 }),
    ]);
    expect(out[0].kits).toBe(10);
    expect(out[0].orders).toHaveLength(1);
    expect(out[0].packingFeePhp).toBe(300);
    expect(out[0].totalPhp).toBe(104300);
    expect(out[0].chargedPackingFeeTwice).toBe(false);
  });

  it('totals what the customer owes across their orders', () => {
    const out = groupCampaignParticipants([
      row({ orderId: 'o1', totalPhp: 10700 }), row({ orderId: 'o2', totalPhp: 20800 }),
    ]);
    expect(out[0].totalPhp).toBe(31500);
  });

  it('orders participants by when they first committed', () => {
    const out = groupCampaignParticipants([
      row({ userId: 'u2', customerEmail: 'ben@example.com', orderId: 'o2', placedAt: '2026-07-30T10:00:00.000Z' }),
      row({ userId: 'u1', customerEmail: 'ana@example.com', orderId: 'o1', placedAt: '2026-07-30T09:00:00.000Z' }),
    ]);
    expect(out.map((p) => p.customerEmail)).toEqual(['ana@example.com', 'ben@example.com']);
  });

  it('returns nothing for a campaign nobody has committed to', () => {
    expect(groupCampaignParticipants([])).toEqual([]);
  });
});
