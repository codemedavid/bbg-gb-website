// Admin → Cycle archives, both screens.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const PAST = '2026-08-29T14:00:00.000Z';
vi.mock('next/navigation', () => ({
  useParams: () => ({ key: encodeURIComponent(PAST) }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/admin-api', () => ({
  useAdminCycles: () => ({
    data: [
      { cycleKey: '2026-09-05T14:00:00.000Z', label: 'Cycle of 5 Sep 2026', current: true, orders: 3, cancelledOrders: 0, kahatis: 2, vials: 14, campaigns: 1, kits: 4 },
      { cycleKey: PAST, label: 'Cycle of 29 Aug 2026', current: false, orders: 114, cancelledOrders: 2, kahatis: 40, vials: 260, campaigns: 9, kits: 31 },
    ],
    isLoading: false,
  }),
  useAdminCycle: () => ({
    data: {
      cycleKey: PAST, label: 'Cycle of 29 Aug 2026', current: false,
      kahatis: [{ id: 'g1', name: 'Retatrutide 20mg', claimedSlots: 7, totalSlots: 10, status: 'closed' }],
      campaigns: [{ id: 'c1', name: 'NAD+ 500mg', batchNo: 1, committed: 4, capacity: 10, status: 'approved' }],
      orders: [{ id: 'o1', orderNo: 'BBG-2417', shipName: 'Ana Reyes', customerEmail: 'ana@example.com', buyType: 'kahati', totalPhp: '2150.00', status: 'paid', createdAt: '2026-08-30T02:00:00Z' }],
    },
    isLoading: false,
  }),
  useAdminOrder: () => ({ data: null, isLoading: false }),
  useAdminProducts: () => ({ data: [] }),
  useMutate: () => ({ setOrderStatus: { mutateAsync: vi.fn(), isPending: false } }),
}));

const Index = (await import('./page')).default;
const Cycle = (await import('./[key]/page')).default;

describe('the archive index', () => {
  it('lists every cycle by name, newest first, marking the current one', () => {
    render(<Index />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Cycle of 5 Sep 2026');
    expect(rows[0]).toHaveTextContent('current');
    expect(rows[1]).toHaveTextContent('Cycle of 29 Aug 2026');
    expect(rows[1]).toHaveTextContent('114');
    expect(rows[1]).toHaveTextContent('2 cancelled');
    expect(rows[1]).toHaveTextContent('40 counters · 260 vials');
    expect(rows[1]).toHaveTextContent('9 batches · 31 kits');
  });

  it('links each cycle to its own page', () => {
    render(<Index />);
    expect(screen.getByRole('link', { name: 'Cycle of 29 Aug 2026' }))
      .toHaveAttribute('href', `/admin/cycles/${encodeURIComponent(PAST)}`);
  });
});

describe('one cycle', () => {
  it('shows the counters, batches and orders it took, vials and all', () => {
    render(<Cycle />);
    expect(screen.getByRole('heading', { name: /cycle of 29 aug 2026/i })).toBeInTheDocument();
    expect(screen.getByText('Retatrutide 20mg')).toBeInTheDocument();
    expect(screen.getByText('7/10')).toBeInTheDocument();
    expect(screen.getByText(/NAD\+ 500mg/)).toBeInTheDocument();
    expect(screen.getByText('4/10')).toBeInTheDocument();
    expect(screen.getByText('BBG-2417')).toBeInTheDocument();
  });
});
