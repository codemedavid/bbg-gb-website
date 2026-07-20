// The MOQ shelf board.
//
// The behaviour that matters here is the one thing the MOQ page does that no
// other storefront surface does: adding a product seeds the cart line at the
// product's minimum order quantity, not at 1. A line seeded at 1 would be
// rejected by checkout, so getting this wrong is a dead end for the customer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MoqProduct } from '@/lib/types';

// SectionHeader reads auth for the cart/greeting chrome; the board itself does not.
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/moq' }));

let shelf: { data: MoqProduct[]; isLoading: boolean } = { data: [], isLoading: false };
vi.mock('@/lib/queries', () => ({ useMoqProducts: () => shelf }));

const add = vi.fn();
vi.mock('@/lib/store/cart', () => ({
  useCart: (sel: (s: unknown) => unknown) => sel({ add }),
}));

const toast = vi.fn();
vi.mock('@/lib/store/toast', () => ({
  useToast: (sel: (s: unknown) => unknown) => sel({ show: toast }),
}));

const { MoqBoard } = await import('./MoqBoard');

const product = (o: Partial<MoqProduct> = {}): MoqProduct => ({
  id: 'm1', name: 'FUAN GTT1500', spec: '1500mg', description: null,
  imageUrl: null, imageEmoji: '📦', pricePhp: '4500.00', priceUsd: null,
  stock: 50, minOrderQty: 5, packingFeePhp: null, arrivalGroup: 'white_powder',
  isActive: true, sortOrder: 0, inStock: true,
  ...o,
});

beforeEach(() => {
  add.mockReset();
  toast.mockReset();
  shelf = { data: [], isLoading: false };
});

describe('MoqBoard', () => {
  it('shows a loading state while the shelf is fetching', () => {
    shelf = { data: [], isLoading: true };
    render(<MoqBoard />);
    expect(screen.getByText(/loading the moq shelf/i)).toBeInTheDocument();
  });

  it('explains the empty shelf rather than rendering a blank page', () => {
    render(<MoqBoard />);
    expect(screen.getByText(/no moq products are listed/i)).toBeInTheDocument();
  });

  it('renders every product on the shelf', () => {
    shelf = {
      data: [product({ id: 'a', name: 'FUAN GTT1500' }), product({ id: 'b', name: 'TR30 + CGL5 Blends' })],
      isLoading: false,
    };
    render(<MoqBoard />);
    expect(screen.getByText(/FUAN GTT1500/)).toBeInTheDocument();
    expect(screen.getByText(/TR30 \+ CGL5 Blends/)).toBeInTheDocument();
  });

  it('seeds the cart line at the minimum order quantity, not at 1', async () => {
    shelf = { data: [product({ minOrderQty: 5 })], isLoading: false };
    render(<MoqBoard />);

    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toMatchObject({
      key: 'moq:m1', kind: 'moq', refId: 'm1', qty: 5, minQty: 5, unitPricePhp: 4500, stock: 50,
    });
  });

  it('passes a per-listing packing fee through to the cart line', async () => {
    shelf = { data: [product({ packingFeePhp: '450.00' })], isLoading: false };
    render(<MoqBoard />);

    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(add.mock.calls[0][0].packingFeePhp).toBe(450);
  });

  it('leaves the packing fee unset so the global MOQ default applies', async () => {
    shelf = { data: [product({ packingFeePhp: null })], isLoading: false };
    render(<MoqBoard />);

    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(add.mock.calls[0][0].packingFeePhp).toBeUndefined();
  });

  it('confirms the add with a toast naming the quantity', async () => {
    shelf = { data: [product({ minOrderQty: 5 })], isLoading: false };
    render(<MoqBoard />);

    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('5'));
  });

  it('does not add an out-of-stock product', async () => {
    shelf = { data: [product({ stock: 0, inStock: false })], isLoading: false };
    render(<MoqBoard />);

    await userEvent.click(screen.getByRole('button', { name: /unavailable/i }));
    expect(add).not.toHaveBeenCalled();
  });
});
