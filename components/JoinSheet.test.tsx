import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GroupBuy } from '@/lib/types';
import { useCart, maxQtyFor } from '@/lib/store/cart';
import { JoinSheet } from './JoinSheet';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const gb: GroupBuy = {
  id: 'gb1', name: 'Reta 20mg', perVialPhp: 900, minVials: 1, remaining: 8,
  totalSlots: 10, claimedSlots: 2, repackFeePhp: 150,
} as unknown as GroupBuy;

beforeEach(() => {
  push.mockReset();
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

  it('redirects straight to the payment page after committing', () => {
    render(<JoinSheet g={gb} onClose={vi.fn()} />);
    screen.getByRole('button', { name: /commit/i }).click();

    expect(push).toHaveBeenCalledWith('/checkout');
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
