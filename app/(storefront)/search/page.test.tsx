// Storefront-wide search.
//
// The bottom-nav Search tab lands here, so the page has to search more than the
// on-hand shelf. A customer looking for "reta" should see the ready-stock card,
// open Kahati counters, Group Buy batches that carry the product, and MOQ shelf
// rows in one place.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupBuy, MoqCampaign, MoqProduct, Product } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/lib/store/cart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/store/cart')>()),
  useCart: (sel: (s: unknown) => unknown) => sel({ add: vi.fn(), count: () => 0 }),
}));
vi.mock('@/lib/store/toast', () => ({ useToast: (sel: (s: unknown) => unknown) => sel({ show: vi.fn() }) }));

let products: Product[] = [];
let hatians: GroupBuy[] = [];
let campaigns: MoqCampaign[] = [];
let moqProducts: MoqProduct[] = [];
let moqEnabled = true;

vi.mock('@/lib/queries', () => ({
  useProducts: () => ({ data: products, isLoading: false }),
  useGroupBuys: () => ({ data: hatians, isLoading: false }),
  useCampaigns: () => ({ data: campaigns, isLoading: false }),
  useMoqPageEnabled: () => ({ data: moqEnabled }),
  useMoqProducts: () => ({ data: moqProducts, isLoading: false }),
}));

const SearchPage = (await import('./page')).default;

const product = (o: Partial<Product> = {}): Product => ({
  id: 'p1', code: null, name: 'Retatrutide', spec: '20mg vial',
  pricePhp: '1200.00', priceUsd: null, categoryId: null, categorySlug: null,
  categoryName: 'GLP-1', isOnHand: true, onHandKitPhp: '10000.00',
  onHandPiecePhp: '1200.00', stock: 12, kitSize: 10,
  arrivalGroup: 'white_powder', description: null, imageEmoji: '💧', soldCount: 0,
  ...o,
});

const hatian = (o: Partial<GroupBuy> = {}): GroupBuy => ({
  id: 'g1', name: 'Retatrutide 20mg vial', pricePerKitPhp: '9000.00',
  totalSlots: 10, claimedSlots: 4, minVials: 1, repackFeePhp: '150.00',
  status: 'open', opensAt: null, closesAt: null, arrivalGroup: 'white_powder',
  description: null, perVialPhp: 900, remaining: 6, progress: 0.4,
  ...o,
});

const campaign = (o: Partial<MoqCampaign> = {}): MoqCampaign => ({
  id: 'c1', name: 'August Peptide Run', pricePerKitPhp: '9000.00',
  moq: 10, committed: 5, perCustomerMin: 1, shippingPhp: '300.00',
  status: 'open', opensAt: null, deadline: null,
  includedProducts: [{ productId: 'p1', name: 'Retatrutide 20mg' }],
  arrivalGroup: 'white_powder', description: null, createdAt: '2026-07-01T00:00:00Z',
  seriesId: 'c1', batchNo: 1, capacity: 10, progress: 0.5,
  remaining: 5, reached: false, full: false, outcome: 'awaiting_moq',
  ...o,
});

const moq = (o: Partial<MoqProduct> = {}): MoqProduct => ({
  id: 'm1', name: 'Retatrutide bulk', spec: '20mg', description: null,
  imageUrl: null, imageEmoji: '📦', pricePhp: '5000.00', priceUsd: null,
  minOrderQty: 1, packingFeePhp: null, arrivalGroup: 'white_powder',
  isActive: true, sortOrder: 0,
  moq: 500, committed: 120, cycleNo: 1, remaining: 380, progress: 0.24, reached: false,
  ...o,
});

beforeEach(() => {
  products = [product()];
  hatians = [hatian()];
  campaigns = [campaign()];
  moqProducts = [moq()];
  moqEnabled = true;
});

describe('SearchPage', () => {
  it('waits for a query before showing results', () => {
    render(<SearchPage />);

    expect(screen.getByText(/type a peptide name/i)).toBeInTheDocument();
    expect(screen.queryByText('Retatrutide')).not.toBeInTheDocument();
  });

  it('searches across on-hand, Kahati, Group Buy and MOQ', async () => {
    render(<SearchPage />);

    await userEvent.type(screen.getByRole('searchbox', { name: /search all products/i }), 'reta');

    expect(screen.getByRole('heading', { name: 'On-hand' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kahati' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Group Buy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'MOQ' })).toBeInTheDocument();
    expect(screen.getByText('Retatrutide 20mg vial')).toBeInTheDocument();
    expect(screen.getByText('August Peptide Run')).toBeInTheDocument();
    expect(screen.getByText('Retatrutide bulk')).toBeInTheDocument();
  });

  it('hides MOQ results when the MOQ page is switched off', async () => {
    moqEnabled = false;
    render(<SearchPage />);

    await userEvent.type(screen.getByRole('searchbox', { name: /search all products/i }), 'reta');

    expect(screen.queryByRole('heading', { name: 'MOQ' })).not.toBeInTheDocument();
  });
});
