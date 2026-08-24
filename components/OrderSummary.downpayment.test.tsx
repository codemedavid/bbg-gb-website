// What the summary quotes as "due now" on a hatian cart, against a configured
// deposit — and specifically that it agrees with what the server will charge.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useCart, type CartItem } from '@/lib/store/cart';
import type { KahatiDownpaymentPolicy } from '@/lib/kahati-downpayment';

const policy: { current: KahatiDownpaymentPolicy | undefined } = { current: undefined };

vi.mock('@/lib/queries', () => ({
  usePackingFees: () => ({ data: { solo: 200, kahati: 150, group_buy: 300, moq: 200 } }),
  useCyclePackingFeePaid: () => ({ data: false }),
  useKahatiDownpaymentPolicy: () => ({ data: policy.current, isSuccess: true }),
}));

const { OrderSummary, useOrderTotals } = await import('./OrderSummary');

const kahatiLine = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'gb:k1', kind: 'group_buy', refId: 'k1', name: 'Reta 10mg — kahati',
  spec: 'Kahati', unitPricePhp: 900, qty: 2, minQty: 1, packingFeePhp: 150, ...o,
});
const campaignLine = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'gbuy:c1', kind: 'moq_campaign', refId: 'c1', name: 'Reta 20mg — group buy',
  spec: 'Group buy', unitPricePhp: 10000, qty: 1, minQty: 1, packingFeePhp: 300, seriesId: 's1', ...o,
});

/** Renders the hook's numbers so they can be asserted without a component. */
function Totals() {
  const t = useOrderTotals();
  return <div data-testid="t">{JSON.stringify({ dueNow: t.dueNow, balance: t.balance, downpayment: t.downpayment })}</div>;
}
const readTotals = () => JSON.parse(screen.getByTestId('t').textContent!);

beforeEach(() => {
  useCart.getState().clear();
  policy.current = undefined;
});

describe('a hatian-only cart with a fixed deposit', () => {
  it('collects the deposit now and leaves the rest as the balance', () => {
    // Arrange — 2 vials @ ₱900 + ₱150 fee = ₱1,950.
    policy.current = { mode: 'fixed', amountPhp: 500, percent: 0, refundable: true, policyNote: null };
    useCart.getState().add(kahatiLine());
    // Act
    render(<Totals />);
    // Assert
    expect(readTotals()).toEqual({ dueNow: 500, balance: 1450, downpayment: 500 });
  });
});

describe('a cart holding BOTH a hatian and a Group Buy', () => {
  it('leaves the single cycle fee on the dearest line, exactly as the server does', () => {
    // One cycle fee buys one parcel, and chargeCycleFeeOnce keeps it on the
    // dearest cycle line — the ₱300 Group Buy. Pricing the hatian lines on their
    // own would give them a ₱150 fee no order ever carries, and quote a deposit
    // ₱30 higher than the server charges.
    policy.current = { mode: 'percent', amountPhp: 0, percent: 20, refundable: true, policyNote: null };
    useCart.getState().add(kahatiLine());
    useCart.getState().add(campaignLine());

    render(<Totals />);

    const t = readTotals();
    // The hatian order the server writes: ₱1,800 goods, ₱0 packing fee -> 20% = ₱360.
    expect(t.downpayment).toBe(360);
    // Due now = that deposit + the Group Buy order in full (₱10,000 + ₱300).
    expect(t.dueNow).toBe(10660);
    // The hatian balance left to settle is its goods less the deposit.
    expect(t.balance).toBe(1440);
  });

  it('quotes a due-now and balance that add up to the cart total', () => {
    policy.current = { mode: 'percent', amountPhp: 0, percent: 20, refundable: true, policyNote: null };
    useCart.getState().add(kahatiLine());
    useCart.getState().add(campaignLine());

    render(<OrderSummary />);
    render(<Totals />);

    const t = readTotals();
    // ₱1,800 + ₱10,000 goods + one ₱300 cycle fee.
    expect(t.dueNow + t.balance).toBe(12100);
  });
});

describe('a hatian cart under the default packing-fee rule', () => {
  it('still collects the packing fee and nothing else', () => {
    useCart.getState().add(kahatiLine());

    render(<Totals />);

    expect(readTotals()).toEqual({ dueNow: 150, balance: 1800, downpayment: 150 });
  });
});

// The deposit label is the only thing on the summary that names what the money
// IS, so it must not name money that is not that.
describe('the "due now" label on a mixed cart', () => {
  const onHandLine = (o: Partial<CartItem> = {}): CartItem => ({
    key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
    spec: '10mg', unitPricePhp: 1000, qty: 2, minQty: 1, unit: 'piece', stock: 100, ...o,
  });

  it('does not call the whole total a downpayment when most of it is not', () => {
    // ₱500 deposit on the hatian + ₱2,000 of on-hand stock + its ₱200 fee.
    // "Downpayment due now ₱2,700" invites the customer to read the entire sum
    // as a refundable deposit.
    policy.current = { mode: 'fixed', amountPhp: 500, percent: 0, refundable: true, policyNote: null };
    useCart.getState().add(kahatiLine());
    useCart.getState().add(onHandLine());

    render(<OrderSummary />);

    expect(screen.queryByText('Downpayment due now')).toBeNull();
    expect(screen.getByText('Due now')).toBeInTheDocument();
  });

  it('still calls it a downpayment when the deposit is all there is', () => {
    policy.current = { mode: 'fixed', amountPhp: 500, percent: 0, refundable: true, policyNote: null };
    useCart.getState().add(kahatiLine());

    render(<OrderSummary />);

    expect(screen.getByText('Downpayment due now')).toBeInTheDocument();
  });
});
