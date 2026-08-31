// Orders split into their own pages: All, On-Hand, Group Buy and Kahati.
//
// One table held all three workflows at once, so an admin packing on-hand
// parcels scrolled past hatian commitments and campaign pre-orders to find the
// next row that was theirs. Each segment gets its own URL rather than another
// pill on the shared filter row: these are separate jobs, often done by
// separate people, and a URL is what can be bookmarked and handed over.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const ordersQuery = vi.fn();
vi.mock('./WeeklyReportButton', () => ({ WeeklyReportButton: () => null }));
vi.mock('@/lib/admin-api', () => ({
  useAdminOrders: (opts?: unknown) => {
    ordersQuery(opts);
    return {
      data: [{
        id: 'o1', orderNo: 'KH-2735', shipName: 'Analyn Mangrobang', customerEmail: 'lhyn@example.com',
        buyType: 'kahati', totalPhp: '1920.00', status: 'payment_confirmed', createdAt: '2026-09-01T10:00:00Z',
      }],
      isLoading: false,
    };
  },
  useAdminProducts: () => ({ data: [] }),
  useAdminOrder: () => ({ data: null, isLoading: true }),
  useMutate: () => ({ setOrderStatus: { mutateAsync: vi.fn(), isPending: false } }),
}));

const AllPage = (await import('./page')).default;
const OnHandPage = (await import('./on-hand/page')).default;
const GroupBuyPage = (await import('./group-buy/page')).default;
const KahatiPage = (await import('./kahati/page')).default;

const tab = (name: RegExp) => screen.getByRole('link', { name });

beforeEach(() => { ordersQuery.mockReset(); });

describe('admin order segment pages', () => {
  it('asks the server for only the on-hand segment', () => {
    render(<OnHandPage />);
    expect(ordersQuery).toHaveBeenCalledWith(expect.objectContaining({ segment: 'onhand' }));
  });

  it('asks the server for only the group-buy segment', () => {
    render(<GroupBuyPage />);
    expect(ordersQuery).toHaveBeenCalledWith(expect.objectContaining({ segment: 'groupbuy' }));
  });

  it('asks the server for only the kahati segment', () => {
    render(<KahatiPage />);
    expect(ordersQuery).toHaveBeenCalledWith(expect.objectContaining({ segment: 'kahati' }));
  });

  it('asks for every order on the all-orders page', () => {
    render(<AllPage />);
    expect(ordersQuery).toHaveBeenCalledWith(expect.objectContaining({ segment: undefined }));
  });

  it('names the segment in the heading so the page is not mistaken for all orders', () => {
    render(<KahatiPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/kahati orders/i);
  });

  it('links every segment page from every segment page', () => {
    render(<OnHandPage />);
    expect(tab(/^all orders$/i)).toHaveAttribute('href', '/admin/orders');
    expect(tab(/^on-hand$/i)).toHaveAttribute('href', '/admin/orders/on-hand');
    expect(tab(/^group buy$/i)).toHaveAttribute('href', '/admin/orders/group-buy');
    expect(tab(/^kahati$/i)).toHaveAttribute('href', '/admin/orders/kahati');
  });

  it('marks the open segment as the current page', () => {
    render(<GroupBuyPage />);
    expect(tab(/^group buy$/i)).toHaveAttribute('aria-current', 'page');
    expect(tab(/^kahati$/i)).not.toHaveAttribute('aria-current');
  });

  // The status pills, the weekly report toolbar and the order sheet are the
  // whole point of the page — a segment page that lost them would just be a
  // narrower dead end.
  it('keeps the status filters and the order table on a segment page', () => {
    render(<KahatiPage />);
    expect(screen.getByRole('button', { name: 'Proof review' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('KH-2735')).toBeInTheDocument();
  });
});
