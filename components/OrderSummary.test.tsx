// What the order summary promises about the packing fee.
//
// The fee lines are the one place the cart makes a claim about money before the
// server has ruled on it, so each note has to be true of THIS cart — a note that
// says "nothing more to pay" over a total that still includes a fee is the
// client/server disagreement the deferred-fee rules exist to avoid.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useCart, type CartItem } from '@/lib/store/cart';

const paidThisCycle: { current: boolean } = { current: false };
vi.mock('@/lib/queries', () => ({
  // undefined -> useOrderTotals falls back to the default (packing-fee) policy,
  // which is the behaviour these tests were written against.
  useKahatiDownpaymentPolicy: () => ({ data: undefined, isSuccess: true }),
  usePackingFees: () => ({ data: { solo: 200, kahati: 150, group_buy: 300, moq: 300 } }),
  useCyclePackingFeePaid: () => ({ data: paidThisCycle.current }),
}));

const { OrderSummary } = await import('./OrderSummary');

const campaign = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'gbuy:c1', kind: 'moq_campaign', refId: 'c1', name: 'Reta 20mg — group buy',
  spec: 'Group buy · batch #1', unitPricePhp: 10000, qty: 1, minQty: 1,
  packingFeePhp: 300, seriesId: 's1', ...o,
});

beforeEach(() => {
  useCart.getState().clear();
  paidThisCycle.current = false;
});

describe('OrderSummary — group buy packing fee', () => {
  it('charges the fee and says nothing about a waiver on a first commitment', () => {
    useCart.getState().add(campaign());
    render(<OrderSummary />);

    expect(screen.getByText('₱300')).toBeInTheDocument();
    expect(screen.queryByText(/bayad na ang packing fee/i)).toBeNull();
  });

  it('shows no fee and explains why once the parcel is already paid for', () => {
    useCart.getState().add(campaign());
    paidThisCycle.current = true;
    render(<OrderSummary />);

    expect(screen.queryByText('₱300')).toBeNull();
    expect(screen.getByText(/bayad na ang packing fee/i)).toBeInTheDocument();
  });

  it('charges one fee for two group buys when the cycle is not yet paid for', () => {
    // Two campaigns, one cycle, one parcel — so ₱300 once, and no promise of
    // "no new charge" over a total that carries one.
    useCart.getState().add(campaign({ seriesId: 's1' }));
    useCart.getState().add(campaign({ key: 'gbuy:c2', refId: 'c2', seriesId: 's2' }));
    paidThisCycle.current = false;
    render(<OrderSummary />);

    expect(screen.getByText('₱300')).toBeInTheDocument();
    expect(screen.queryByText(/walang bagong singil/i)).toBeNull();
  });
});
