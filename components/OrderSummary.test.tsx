// What the order summary promises about the packing fee.
//
// The fee lines are the one place the cart makes a claim about money before the
// server has ruled on it, so each note has to be true of THIS cart — a note that
// says "nothing more to pay" over a total that still includes a fee is the
// client/server disagreement the deferred-fee rules exist to avoid.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useCart, type CartItem } from '@/lib/store/cart';

const waivers: { current: Set<string> | undefined } = { current: undefined };
vi.mock('@/lib/queries', () => ({
  usePackingFees: () => ({ data: { solo: 200, kahati: 150, group_buy: 300, moq: 300 } }),
  useKahatiDownpayment: () => ({ data: 150 }),
  useCampaignPackingFeeWaivers: () => ({ data: waivers.current }),
}));

const { OrderSummary } = await import('./OrderSummary');

const campaign = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'gbuy:c1', kind: 'moq_campaign', refId: 'c1', name: 'Reta 20mg — group buy',
  spec: 'Group buy · batch #1', unitPricePhp: 10000, qty: 1, minQty: 1,
  packingFeePhp: 300, seriesId: 's1', ...o,
});

beforeEach(() => {
  useCart.getState().clear();
  waivers.current = undefined;
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
    waivers.current = new Set(['s1']);
    render(<OrderSummary />);

    expect(screen.queryByText('₱300')).toBeNull();
    expect(screen.getByText(/bayad na ang packing fee/i)).toBeInTheDocument();
  });

  it('does not promise "no new charge" when another group buy in the cart is still charged', () => {
    // Series s1 is paid for; s2 is new and its ₱300 IS charged. Telling the
    // customer there is no new charge here contradicts the total above it.
    useCart.getState().add(campaign({ seriesId: 's1' }));
    useCart.getState().add(campaign({ key: 'gbuy:c2', refId: 'c2', seriesId: 's2' }));
    waivers.current = new Set(['s1']);
    render(<OrderSummary />);

    expect(screen.getByText('₱300')).toBeInTheDocument();
    expect(screen.queryByText(/walang bagong singil/i)).toBeNull();
  });
});
