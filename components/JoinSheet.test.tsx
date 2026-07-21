import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GroupBuy } from '@/lib/types';
import { useCart } from '@/lib/store/cart';
import { JoinSheet } from './JoinSheet';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const gb: GroupBuy = {
  id: 'gb1', name: 'Reta 20mg', perVialPhp: 900, minVials: 1, remaining: 10,
  claimedSlots: 2, repackFeePhp: 150,
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
});
