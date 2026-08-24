// The Kahati board's search and sort controls.
//
// The board is polled shared state, so the controls have to be client-side
// filtering over what the poll returns — a server round-trip per keystroke
// would fight the 15s refetch. These tests pin the behaviour a customer sees:
// typing narrows the board, sorting reorders it, and the two compose.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCart } from '@/lib/store/cart';
import type { GroupBuy } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

let boardState: { data: GroupBuy[] } = { data: [] };
vi.mock('@/lib/queries', () => ({
  // undefined -> the page falls back to the default (packing-fee) policy for its
  // "how it works" steps, which is what these tests were written against.
  useKahatiDownpaymentPolicy: () => ({ data: undefined, isSuccess: true }), useGroupBuys: () => boardState }));

const KahatiPage = (await import('./page')).default;

const hatian = (o: Partial<GroupBuy> = {}): GroupBuy => ({
  id: 'g1', name: 'Retatrutide 20mg vial', pricePerKitPhp: '9000.00',
  totalSlots: 10, claimedSlots: 0, minVials: 1, repackFeePhp: '150.00',
  status: 'open', opensAt: null, closesAt: null, arrivalGroup: 'white_powder',
  description: null, perVialPhp: 900, remaining: 10, progress: 0, ...o,
});

// The board renders one card per counter; each card leads with the counter's
// name. Read in DOM order, so the list doubles as the board's ordering.
const cardNames = (): string[] =>
  Array.from(document.querySelectorAll('.rounded-\\[16px\\] .text-\\[15px\\].font-bold'))
    .map((el) => el.textContent ?? '');

beforeEach(() => {
  useCart.getState().clear();
  boardState = {
    data: [
      hatian({ id: 'reta20', name: 'Retatrutide 20mg vial', claimedSlots: 9 }),
      hatian({ id: 'sema', name: 'Semaglutide 5mg vial', claimedSlots: 2 }),
      hatian({ id: 'aod', name: 'AOD9604 Pro Max 5mg vial', claimedSlots: 5 }),
    ],
  };
});

describe('KahatiPage — search', () => {
  it('shows every open hatian before anything is typed', () => {
    render(<KahatiPage />);

    expect(cardNames()).toEqual([
      'Retatrutide 20mg vial', 'Semaglutide 5mg vial', 'AOD9604 Pro Max 5mg vial',
    ]);
  });

  it('narrows the board to counters matching the product name', async () => {
    render(<KahatiPage />);

    await userEvent.type(screen.getByRole('searchbox'), 'semaglutide');

    expect(cardNames()).toEqual(['Semaglutide 5mg vial']);
  });

  it('matches the variant/specification, not just the product name', async () => {
    // "20mg" is the variant. A customer who knows which vial they want must be
    // able to type it.
    render(<KahatiPage />);

    await userEvent.type(screen.getByRole('searchbox'), '20mg');

    expect(cardNames()).toEqual(['Retatrutide 20mg vial']);
  });

  it('is case-insensitive', async () => {
    render(<KahatiPage />);

    await userEvent.type(screen.getByRole('searchbox'), 'RETA');

    expect(cardNames()).toEqual(['Retatrutide 20mg vial']);
  });

  it('says the search found nothing rather than showing the whole board', async () => {
    render(<KahatiPage />);

    await userEvent.type(screen.getByRole('searchbox'), 'insulin');

    expect(cardNames()).toEqual([]);
    expect(screen.getByText(/no hatians match/i)).toBeInTheDocument();
  });

  it('restores the board when the search is cleared', async () => {
    render(<KahatiPage />);
    await userEvent.type(screen.getByRole('searchbox'), 'insulin');

    await userEvent.click(screen.getByRole('button', { name: /clear search/i }));

    expect(cardNames()).toHaveLength(3);
  });
});

describe('KahatiPage — sorting', () => {
  it('defaults to the order the server sent, which is demand rank', () => {
    render(<KahatiPage />);

    expect(cardNames()).toEqual([
      'Retatrutide 20mg vial', 'Semaglutide 5mg vial', 'AOD9604 Pro Max 5mg vial',
    ]);
  });

  it('sorts A–Z by name', async () => {
    render(<KahatiPage />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'az');

    expect(cardNames()).toEqual([
      'AOD9604 Pro Max 5mg vial', 'Retatrutide 20mg vial', 'Semaglutide 5mg vial',
    ]);
  });

  it('sorts Z–A by name', async () => {
    render(<KahatiPage />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'za');

    expect(cardNames()).toEqual([
      'Semaglutide 5mg vial', 'Retatrutide 20mg vial', 'AOD9604 Pro Max 5mg vial',
    ]);
  });

  it('leads with the highest vial progress when asked', async () => {
    render(<KahatiPage />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'progress');

    expect(cardNames()).toEqual([
      'Retatrutide 20mg vial', 'AOD9604 Pro Max 5mg vial', 'Semaglutide 5mg vial',
    ]);
  });
});

describe('KahatiPage — search and sort together', () => {
  it('sorts what the search matched, not the whole board', async () => {
    boardState = {
      data: [
        hatian({ id: 'reta10', name: 'Retatrutide 10mg vial', claimedSlots: 1 }),
        hatian({ id: 'sema', name: 'Semaglutide 5mg vial', claimedSlots: 9 }),
        hatian({ id: 'reta20', name: 'Retatrutide 20mg vial', claimedSlots: 4 }),
      ],
    };
    render(<KahatiPage />);

    await userEvent.type(screen.getByRole('searchbox'), 'retatrutide');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'progress');

    // Semaglutide has the most vials but does not match, so it stays out.
    expect(cardNames()).toEqual(['Retatrutide 20mg vial', 'Retatrutide 10mg vial']);
  });
});

describe('KahatiPage — cart shortcut', () => {
  it('offers a cart shortcut on the board itself', () => {
    render(<KahatiPage />);

    expect(screen.getByRole('link', { name: /^cart,/i })).toHaveAttribute('href', '/cart');
  });

  it('shows the current item count in the shortcut', () => {
    useCart.getState().add({
      key: 'gb:reta20', kind: 'group_buy', refId: 'reta20', name: 'Retatrutide 20mg — kahati',
      spec: 'Kahati', unitPricePhp: 900, minQty: 1, qty: 2,
    });

    render(<KahatiPage />);

    expect(screen.getByRole('link', { name: /^cart,/i })).toHaveTextContent('Cart (2)');
  });
});
