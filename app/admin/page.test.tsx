import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin-api', () => ({
  useStats: () => ({
    isLoading: false,
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
  }),
}));

const DashboardPage = (await import('./page')).default;

describe('admin dashboard packing-fee analytics', () => {
  it('shows the accumulated total with weekly and monthly context', () => {
    render(<DashboardPage />);

    expect(screen.getByText('Total packing fees')).toBeInTheDocument();
    expect(screen.getByText('₱1,425')).toBeInTheDocument();
    expect(screen.getByText('₱350 this week · ₱825 this month')).toBeInTheDocument();
  });
});
