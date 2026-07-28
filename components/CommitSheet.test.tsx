// Committing to a Group Buy campaign IS "add to cart".
//
// It used to be its own payment path: the sheet collected shipping details and
// a payment proof and posted straight to /api/campaigns/:id/commit, so a
// customer could not put two group buys in one basket, could not keep shopping,
// and paid a packing fee per commitment. The sheet now only picks a quantity —
// the cart holds the commitment and the shared checkout takes the payment.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommitSheet } from './CommitSheet';
import { useCart, maxQtyFor } from '@/lib/store/cart';
import type { MoqCampaign } from '@/lib/types';

const campaign = (o: Partial<MoqCampaign> = {}): MoqCampaign => ({
  id: 'c1', name: 'Retatrutide 20mg', pricePerKitPhp: '9000.00', moq: 10, committed: 4,
  shippingPhp: '300.00', status: 'open', deadline: null,
  includedProducts: [], arrivalGroup: 'white_powder', description: null,
  createdAt: '2026-07-01T00:00:00Z',
  seriesId: 'c1', batchNo: 1,
  capacity: 10, progress: 0.4, remaining: 6, reached: false, full: false, outcome: 'awaiting_moq',
  ...o,
});

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Ana Reyes', email: 'ana@example.com', phone: '09171234567', address: '12 Mabini St' },
    loading: false,
  }),
}));

beforeEach(() => {
  useCart.getState().clear();
  vi.stubGlobal('fetch', vi.fn());
});

describe('CommitSheet', () => {
  it('starts at one kit — group buys have no minimum', () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onAdded={vi.fn()} />);

    expect(screen.getByTestId('commit-qty')).toHaveTextContent('1');
  });

  it('starts at the campaign’s per-customer minimum when it sets one', () => {
    render(<CommitSheet c={campaign({ perCustomerMin: 3 })} onClose={vi.fn()} onAdded={vi.fn()} />);

    expect(screen.getByTestId('commit-qty')).toHaveTextContent('3');
  });

  it('will not go below the minimum', async () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onAdded={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /decrease/i }));

    expect(screen.getByTestId('commit-qty')).toHaveTextContent('1');
  });

  it('adds the kits to the cart instead of taking payment', async () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onAdded={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /increase/i }));
    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    const items = useCart.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'moq_campaign', refId: 'c1', qty: 2, minQty: 1 });
    expect(items[0].packingFeePhp).toBe(300);
  });

  it('takes no payment of its own — the cart is the only way to pay', async () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onAdded={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for no shipping details or payment proof', () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onAdded={vi.fn()} />);

    expect(screen.queryByPlaceholderText(/full name/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/mobile/i)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('leaves the campaign line uncapped so a multi-batch commitment is not clamped', async () => {
    // Overflow seals the batch and opens its successor, so any quantity at or
    // above the minimum is valid — the cart must not clamp what checkout takes.
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onAdded={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(maxQtyFor(useCart.getState().items[0])).toBe(Infinity);
  });

  it('tells the customer the packing fee is charged once at checkout', () => {
    render(<CommitSheet c={campaign()} onClose={vi.fn()} onAdded={vi.fn()} />);

    expect(screen.getByText(/checkout/i)).toBeInTheDocument();
    expect(screen.queryByText(/total to send now/i)).toBeNull();
  });

  it('closes the sheet and reports back so the page can toast', async () => {
    const onClose = vi.fn();
    const onAdded = vi.fn();
    render(<CommitSheet c={campaign()} onClose={onClose} onAdded={onAdded} />);

    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(onAdded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
