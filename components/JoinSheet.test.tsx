import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GroupBuy } from '@/lib/types';
import type { KahatiDownpaymentPolicy } from '@/lib/kahati-downpayment';
import { DEFAULT_KAHATI_DOWNPAYMENT_POLICY } from '@/lib/kahati-downpayment';
import { useCart, maxQtyFor } from '@/lib/store/cart';
import { JoinSheet } from './JoinSheet';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

// The refund terms are configurable (lib/kahati-downpayment.ts), and this sheet
// is where the customer actually commits the money they are being told about.
const policy: { current: KahatiDownpaymentPolicy | undefined } = { current: undefined };
vi.mock('@/lib/queries', () => ({
  useKahatiDownpaymentPolicy: () => ({ data: policy.current, isSuccess: policy.current !== undefined }),
}));

const gb: GroupBuy = {
  id: 'gb1', name: 'Reta 20mg', perVialPhp: 900, minVials: 1, remaining: 8,
  totalSlots: 10, claimedSlots: 2, repackFeePhp: 150,
} as unknown as GroupBuy;

beforeEach(() => {
  push.mockReset();
  policy.current = undefined;
  useCart.getState().clear();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
});

describe('JoinSheet (Kahati commit)', () => {
  // The fee is no longer charged when a customer joins a hatian — it is charged
  // once at their final checkout. The sheet advertising "₱150 packing fee" while
  // the cart totals ₱0 is the client/server disagreement this rule exists to
  // avoid, one surface removed.
  it('does not advertise a packing fee that joining no longer charges', () => {
    render(<JoinSheet g={gb} onClose={vi.fn()} />);
    expect(screen.queryByText(/₱150 packing fee/i)).toBeNull();
  });

  it('tells the customer the packing fee comes later, at the final checkout', () => {
    render(<JoinSheet g={gb} onClose={vi.fn()} />);
    expect(screen.getByText(/final checkout|huling checkout/i)).toBeInTheDocument();
  });

  it('adds the committed vials to the cart', () => {
    render(<JoinSheet g={gb} onClose={vi.fn()} />);
    screen.getByRole('button', { name: /commit/i }).click();

    const items = useCart.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'group_buy', refId: 'gb1' });
  });

  it('leaves the customer on the board instead of pushing them into checkout', () => {
    // Payment is reachable only from the cart. Sending the buyer straight to
    // the payment page after one join is what stopped them joining a second
    // hatian, or adding anything else, before paying.
    render(<JoinSheet g={gb} onClose={vi.fn()} />);
    screen.getByRole('button', { name: /commit/i }).click();

    expect(push).not.toHaveBeenCalled();
  });

  it('closes the sheet so the customer can keep browsing', () => {
    const onClose = vi.fn();
    render(<JoinSheet g={gb} onClose={onClose} />);
    screen.getByRole('button', { name: /commit/i }).click();

    expect(onClose).toHaveBeenCalled();
  });

  it('leaves the kahati line uncapped so the cart never clamps a multi-kit commitment', () => {
    // A kahati line is not limited by the counter's remainder nor by one kit:
    // checkout fills counters of 10 and opens fresh ones until the whole
    // commitment has landed, so the cart must not clamp what the server accepts.
    render(<JoinSheet g={gb} onClose={vi.fn()} />);
    screen.getByRole('button', { name: /commit/i }).click();

    expect(useCart.getState().items[0].stock).toBeUndefined();
    expect(maxQtyFor(useCart.getState().items[0])).toBe(Infinity);
  });

  it('lets the customer commit more vials than a single kit holds', () => {
    // 3 open and a kit of 10, yet the stepper must keep climbing: 13 vials fill
    // this counter, seal it, and roll the rest into the counters that open next.
    const nearlyFull = { ...gb, remaining: 3, totalSlots: 10, minVials: 1, claimedSlots: 7 } as GroupBuy;
    render(<JoinSheet g={nearlyFull} onClose={vi.fn()} />);
    const plus = screen.getByRole('button', { name: /add one/i });
    for (let i = 0; i < 12; i += 1) fireEvent.click(plus);
    fireEvent.click(screen.getByRole('button', { name: /commit/i }));

    expect(useCart.getState().items[0].qty).toBe(13); // starts at the 1-vial min, +12
  });

  it('never lets the stepper fall below the hatian’s per-person minimum', () => {
    const minThree = { ...gb, minVials: 3, remaining: 8, claimedSlots: 2 } as GroupBuy;
    render(<JoinSheet g={minThree} onClose={vi.fn()} />);
    const minus = screen.getByRole('button', { name: /remove one/i });
    for (let i = 0; i < 5; i += 1) fireEvent.click(minus);
    fireEvent.click(screen.getByRole('button', { name: /commit/i }));

    expect(useCart.getState().items[0].qty).toBe(3);
  });

  it('disables the commit and explains when fewer vials remain than the minimum', () => {
    const short = { ...gb, remaining: 2, minVials: 3, claimedSlots: 8 } as GroupBuy;
    render(<JoinSheet g={short} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /commit/i })).toBeDisabled();
    expect(screen.getByText(/only 2 vial/i)).toBeInTheDocument();
  });

  it('does not add to the cart when the remaining vials are below the minimum', () => {
    const short = { ...gb, remaining: 2, minVials: 3, claimedSlots: 8 } as GroupBuy;
    render(<JoinSheet g={short} onClose={vi.fn()} />);
    screen.getByRole('button', { name: /commit/i }).click();

    expect(useCart.getState().items).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });
});

// An admin who turns the refund off gets a storefront that contradicts itself
// unless every surface reads the same setting: the checkout card and the
// cancellation email already do, and this sheet is the one the customer reads
// at the moment they commit the money.
describe('the refund terms on the commit sheet', () => {
  const short = () => ({ ...gb, claimedSlots: 2, remaining: 8 } as GroupBuy);

  it('promises the refund while the policy is refundable', () => {
    policy.current = { ...DEFAULT_KAHATI_DOWNPAYMENT_POLICY, refundable: true };

    render(<JoinSheet g={short()} onClose={vi.fn()} />);

    expect(screen.getByText(/downpayment is refunded|refunded in full/i)).toBeInTheDocument();
  });

  it('does not promise a refund the admin has switched off', () => {
    policy.current = { ...DEFAULT_KAHATI_DOWNPAYMENT_POLICY, refundable: false };

    render(<JoinSheet g={short()} onClose={vi.fn()} />);

    expect(screen.queryByText(/downpayment is refunded/i)).toBeNull();
    expect(screen.getByText(/non-refundable/i)).toBeInTheDocument();
  });

  it('states the admin own wording where they wrote some', () => {
    // Embedded in the shortfall sentence rather than standing alone: this
    // surface explains the cancellation first, then what follows from it.
    policy.current = { ...DEFAULT_KAHATI_DOWNPAYMENT_POLICY, policyNote: 'Deposits roll over to your next hatian.' };

    render(<JoinSheet g={short()} onClose={vi.fn()} />);

    expect(screen.getByText(/Deposits roll over to your next hatian\./)).toBeInTheDocument();
  });

  it('keeps the historical refund promise while the policy has not loaded', () => {
    // The default policy is refundable, which is what this sheet has always
    // said. An unanswered request must not silently withdraw the promise.
    render(<JoinSheet g={short()} onClose={vi.fn()} />);

    expect(screen.getByText(/refunded/i)).toBeInTheDocument();
  });
});
