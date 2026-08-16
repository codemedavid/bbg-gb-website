// The MOQ shelf board.
//
// The behaviour that matters here is the one thing the MOQ page does that no
// other storefront surface does: the shelf is an aggregate buy, so a line is
// seeded at the per-ORDER floor and never at the shelf target — seeding it at
// the target would ask one customer to fill the whole buy single-handed.
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
// Only the store is stubbed. moqCartLine stays real so these assertions check the
// line the storefront actually builds, not a restatement of it.
vi.mock('@/lib/store/cart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/store/cart')>()),
  // `count` is read by the cart shortcut in SectionHeader, which every board
  // header now carries.
  useCart: (sel: (s: unknown) => unknown) => sel({ add, count: () => 0 }),
}));

const toast = vi.fn();
vi.mock('@/lib/store/toast', () => ({
  useToast: (sel: (s: unknown) => unknown) => sel({ show: toast }),
}));

const { MoqBoard } = await import('./MoqBoard');

const product = (o: Partial<MoqProduct> = {}): MoqProduct => ({
  id: 'm1', name: 'FUAN GTT1500', spec: '1500mg', description: null,
  imageUrl: null, imageEmoji: '📦', pricePhp: '4500.00', priceUsd: null,
  minOrderQty: 1, packingFeePhp: null, arrivalGroup: 'white_powder',
  isActive: true, sortOrder: 0,
  moq: 500, committed: 120, cycleNo: 1, remaining: 380, progress: 0.24, reached: false,
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

  it('seeds the cart line at the per-order floor, not at the shelf target', async () => {
    shelf = { data: [product({ moq: 500, minOrderQty: 1 })], isLoading: false };
    render(<MoqBoard />);

    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toMatchObject({
      key: 'moq:m1', kind: 'moq_product', refId: 'm1', qty: 1, minQty: 1, unitPricePhp: 4500,
    });
  });

  it('honours a raised per-order floor', async () => {
    shelf = { data: [product({ moq: 500, minOrderQty: 5 })], isLoading: false };
    render(<MoqBoard />);

    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(add.mock.calls[0][0]).toMatchObject({ qty: 5, minQty: 5 });
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

  // There is no unavailable state left to test: a listed item is always
  // buyable. What replaces it is that a full buy still takes more.
  it('still adds a product whose target has been reached', async () => {
    shelf = { data: [product({ committed: 620, remaining: 0, progress: 1, reached: true })], isLoading: false };
    render(<MoqBoard />);

    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(add).toHaveBeenCalledTimes(1);
  });
});
