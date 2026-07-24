import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GroupBuy } from '@/lib/types';
import { useCart } from '@/lib/store/cart';
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

  it('passes the kit cap so the cart allows overflow that rolls into a fresh batch', () => {
    // The cart caps a kahati line at one kit, not the current counter's
    // remainder, so a customer can commit past what is open and let checkout
    // roll the excess into the auto-opened sibling.
    render(<JoinSheet g={gb} onClose={vi.fn()} />);
    screen.getByRole('button', { name: /commit/i }).click();

    expect(useCart.getState().items[0].stock).toBe(gb.totalSlots);
  });

  it('lets the customer commit more than the vials currently open in this counter', () => {
    // 3 open, but the kit holds 10 — the customer may commit up to the kit cap.
    const nearlyFull = { ...gb, remaining: 3, totalSlots: 10, minVials: 1, claimedSlots: 7 } as GroupBuy;
    render(<JoinSheet g={nearlyFull} onClose={vi.fn()} />);
    const plus = screen.getByRole('button', { name: /add one/i });
    for (let i = 0; i < 12; i += 1) fireEvent.click(plus);
    fireEvent.click(screen.getByRole('button', { name: /commit/i }));

    expect(useCart.getState().items[0].qty).toBe(10); // capped at the kit, well above the 3 open
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
