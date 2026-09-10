// The orders board is this cycle's board. Every earlier cycle's orders are in
// the archive; "All cycles" brings them back for a search that spans them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const asked = vi.fn();
vi.mock('./WeeklyReportButton', () => ({ WeeklyReportButton: () => null }));
vi.mock('@/lib/admin-api', () => ({
  useAdminOrders: (args: unknown) => { asked(args); return { data: [], isLoading: false }; },
  useAdminProducts: () => ({ data: [] }),
  useAdminOrder: () => ({ data: null, isLoading: false }),
  useMutate: () => ({ setOrderStatus: { mutateAsync: vi.fn(), isPending: false } }),
}));

const { OrdersBoard } = await import('./OrdersBoard');

beforeEach(() => asked.mockClear());

describe('the cycle the orders board shows', () => {
  it('asks for the current cycle by default', () => {
    render(<OrdersBoard />);
    expect(asked).toHaveBeenLastCalledWith(expect.objectContaining({ cycle: 'current' }));
    expect(screen.getByText(/no orders this cycle/i)).toBeInTheDocument();
  });

  it('asks for every cycle once "All cycles" is ticked', () => {
    render(<OrdersBoard />);
    fireEvent.click(screen.getByRole('checkbox', { name: /all cycles/i }));
    expect(asked).toHaveBeenLastCalledWith(expect.objectContaining({ cycle: undefined }));
  });

  it('links to the cycle archives', () => {
    render(<OrdersBoard />);
    expect(screen.getByRole('link', { name: /cycle archives/i })).toHaveAttribute('href', '/admin/cycles');
  });
});
