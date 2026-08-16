import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refetch = vi.fn();

let stats = {
  isLoading: false,
  error: null as Error | null,
  refetch,
  data: {
    totals: {
      week: { count: 3, revenue: 5000 },
      month: { count: 8, revenue: 12000 },
      all: { count: 20, revenue: 40000 },
    },
    packingFees: { week: 350, month: 825, all: 1425 },
    weeklySummary: [] as { day: string; count: number; revenue: number }[],
    fastMoving: [] as { productId: string | null; name: string; unitsSold: number; revenue: number }[],
    pendingProofs: 2,
  },
};

vi.mock('@/lib/admin-api', () => ({
  useStats: () => stats,
}));

const DashboardPage = (await import('./page')).default;

beforeEach(() => {
  refetch.mockClear();
  stats = {
    isLoading: false,
    error: null,
    refetch,
    data: {
      totals: {
        week: { count: 3, revenue: 5000 },
        month: { count: 8, revenue: 12000 },
        all: { count: 20, revenue: 40000 },
      },
      packingFees: { week: 350, month: 825, all: 1425 },
      weeklySummary: [],
      fastMoving: [],
      pendingProofs: 2,
    },
  };
});

describe('admin dashboard packing-fee analytics', () => {
  it('shows the accumulated total with weekly and monthly context', () => {
    render(<DashboardPage />);

    expect(screen.getByText('Total packing fees')).toBeInTheDocument();
    expect(screen.getByText('₱1,425')).toBeInTheDocument();
    expect(screen.getByText('₱350 this week · ₱825 this month')).toBeInTheDocument();
  });

  it('keeps the analytics visible alongside populated dashboard insights', () => {
    stats.data.weeklySummary = [{ day: '2026-08-15', count: 4, revenue: 9000 }];
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
