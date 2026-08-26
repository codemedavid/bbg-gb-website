import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatsRange } from '@/lib/analytics-range';

const refetch = vi.fn();
const asked: (StatsRange | null)[] = [];

const baseData = () => ({
  totals: {
    week: { count: 3, revenue: 5000 },
    month: { count: 8, revenue: 12000 },
    all: { count: 20, revenue: 40000 },
    range: undefined as { count: number; revenue: number } | undefined,
  },
  packingFees: { week: 350, month: 825, all: 1425, range: undefined as number | undefined },
  dailySummary: [] as { day: string; count: number; revenue: number }[],
  fastMoving: [] as { productId: string | null; name: string; unitsSold: number; revenue: number }[],
  pendingProofs: 2,
  range: null as StatsRange | null,
});

let stats = {
  isLoading: false,
  error: null as Error | null,
  refetch,
  data: baseData(),
};

vi.mock('@/lib/admin-api', () => ({
  useStats: (range: StatsRange | null) => {
    asked.push(range);
    return stats;
  },
}));

const DashboardPage = (await import('./page')).default;

const lastAsked = () => asked[asked.length - 1];

beforeEach(() => {
  refetch.mockClear();
  asked.length = 0;
  stats = { isLoading: false, error: null, refetch, data: baseData() };
});

describe('admin dashboard packing-fee analytics', () => {
  it('shows the accumulated total with weekly and monthly context', () => {
    render(<DashboardPage />);

    expect(screen.getByText('Total packing fees')).toBeInTheDocument();
    expect(screen.getByText('₱1,425')).toBeInTheDocument();
    expect(screen.getByText('₱350 this week · ₱825 this month')).toBeInTheDocument();
  });

  it('keeps the analytics visible alongside populated dashboard insights', () => {
    stats.data.dailySummary = [{ day: '2026-08-15', count: 4, revenue: 9000 }];
    stats.data.fastMoving = [{ productId: 'p1', name: 'Retatrutide 10mg', unitsSold: 12, revenue: 12000 }];
    stats.data.pendingProofs = 0;

    render(<DashboardPage />);

    expect(screen.getByText('Total packing fees')).toBeInTheDocument();
    expect(screen.getByTitle('₱9,000')).toBeInTheDocument();
    expect(screen.getByText('Retatrutide 10mg')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText(/no orders in the last 7 days/i)).not.toBeInTheDocument();
  });

  it('shows the dashboard loading state while analytics are being fetched', () => {
    stats.isLoading = true;

    render(<DashboardPage />);

    expect(screen.getByText('Loading dashboard…')).toBeInTheDocument();
  });

  // A failed /admin/stats call used to leave the page on "Loading dashboard…"
  // forever, because the guard only asked for data and never for an error. The
  // reason the request failed has to reach the admin, not be swallowed.
  it('surfaces the failure instead of loading forever when analytics cannot be fetched', async () => {
    stats.isLoading = false;
    stats.error = new Error('Request failed (500)');
    stats.data = undefined as unknown as typeof stats.data;

    render(<DashboardPage />);

    expect(screen.queryByText('Loading dashboard…')).not.toBeInTheDocument();
    expect(screen.getByText(/could not load the dashboard/i)).toBeInTheDocument();
    expect(screen.getByText('Request failed (500)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('admin dashboard date filter', () => {
  const from = () => screen.getByLabelText(/dashboard start date/i);
  const to = () => screen.getByLabelText(/dashboard end date/i);

  it('starts unfiltered, showing the standing week, month and all-time cards', () => {
    render(<DashboardPage />);

    expect(lastAsked()).toBeNull();
    expect(from()).toHaveValue('');
    expect(to()).toHaveValue('');
    expect(screen.getByText('Orders this week')).toBeInTheDocument();
    expect(screen.getByText('Orders this month')).toBeInTheDocument();
  });

  it('asks for the chosen range only once both ends are set', async () => {
    render(<DashboardPage />);

    fireEvent.change(from(), { target: { value: '2026-08-10' } });
    expect(lastAsked()).toBeNull();

    fireEvent.change(to(), { target: { value: '2026-08-12' } });
    expect(lastAsked()).toEqual({ from: '2026-08-10', to: '2026-08-12' });
  });

  it('replaces the standing period cards with the range figures', async () => {
    stats.data.range = { from: '2026-08-10', to: '2026-08-12' };
    stats.data.totals.range = { count: 6, revenue: 18500 };
    stats.data.packingFees.range = 900;

    render(<DashboardPage />);
    fireEvent.change(from(), { target: { value: '2026-08-10' } });
    fireEvent.change(to(), { target: { value: '2026-08-12' } });

    expect(screen.getByText('Orders in range')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Revenue in range')).toBeInTheDocument();
    expect(screen.getByText('₱18,500')).toBeInTheDocument();
    expect(screen.getByText('Packing fees in range')).toBeInTheDocument();
    expect(screen.getByText('₱900')).toBeInTheDocument();
    expect(screen.getByText(/Aug 10, 2026 – Aug 12, 2026/)).toBeInTheDocument();
    expect(screen.queryByText('Orders this week')).not.toBeInTheDocument();
    // The lifetime figure is context the range never replaces.
    expect(screen.getByText('Total revenue')).toBeInTheDocument();
  });

  it('refuses to request a backwards range and says why', async () => {
    render(<DashboardPage />);

    fireEvent.change(from(), { target: { value: '2026-08-12' } });
    fireEvent.change(to(), { target: { value: '2026-08-10' } });

    expect(lastAsked()).toBeNull();
    expect(screen.getByText(/end date must be on or after the start date/i)).toBeInTheDocument();
  });

  it('returns to the unfiltered dashboard when the range is cleared', async () => {
    render(<DashboardPage />);
    fireEvent.change(from(), { target: { value: '2026-08-10' } });
    fireEvent.change(to(), { target: { value: '2026-08-12' } });
    expect(lastAsked()).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(lastAsked()).toBeNull();
    expect(from()).toHaveValue('');
    expect(to()).toHaveValue('');
    expect(screen.getByText('Orders this week')).toBeInTheDocument();
  });

  it('labels the summary chart for the range it is actually showing', async () => {
    stats.data.range = { from: '2026-08-10', to: '2026-08-12' };
    stats.data.totals.range = { count: 1, revenue: 100 };
    stats.data.packingFees.range = 0;
    stats.data.dailySummary = [{ day: '2026-08-10', count: 1, revenue: 100 }];

    render(<DashboardPage />);
    fireEvent.change(from(), { target: { value: '2026-08-10' } });
    fireEvent.change(to(), { target: { value: '2026-08-12' } });

    expect(screen.getByText('Daily order summary')).toBeInTheDocument();
    expect(screen.queryByText('Weekly order summary')).not.toBeInTheDocument();
  });

  it('says the range is empty rather than implying the last seven days were', async () => {
    stats.data.range = { from: '2026-08-10', to: '2026-08-12' };
    stats.data.totals.range = { count: 0, revenue: 0 };
    stats.data.packingFees.range = 0;

    render(<DashboardPage />);
    fireEvent.change(from(), { target: { value: '2026-08-10' } });
    fireEvent.change(to(), { target: { value: '2026-08-12' } });

    expect(screen.getByText(/no orders in the selected range/i)).toBeInTheDocument();
    expect(screen.queryByText(/last 7 days/i)).not.toBeInTheDocument();
  });
});
