// Admin → Accounts.
//
// The shop had no way to see who had signed up: the only view of a customer was
// through an order they had already placed, so anyone who registered and never
// bought was invisible. This screen is that list, and the "last signed in"
// column is what separates a live account from a dormant one — auth is a
// stateless JWT, so a stamp at sign-in is the only activity signal that exists.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const makeRows = () => [
  {
    id: 'u1', name: 'Ana Cruz', email: 'ana@example.com', phone: '09171234567',
    role: 'customer', orderCount: 3,
    createdAt: new Date('2026-05-02T00:00:00Z').toISOString(),
    lastLoginAt: new Date('2026-08-16T00:00:00Z').toISOString(),
  },
  {
    id: 'u2', name: 'Ben Reyes', email: 'ben@example.com', phone: null,
    role: 'admin', orderCount: 0,
    createdAt: new Date('2026-04-01T00:00:00Z').toISOString(),
    lastLoginAt: null,
  },
] as unknown[];

const rows = { current: makeRows() };
const lastArgs = { current: null as unknown };

vi.mock('@/lib/admin-api', () => ({
  useAdminAccounts: (search?: string, role?: string) => {
    lastArgs.current = { search, role };
    return { data: rows.current, isLoading: false, error: null };
  },
}));

const Page = (await import('./page')).default;

beforeEach(() => {
  rows.current = makeRows();
  lastArgs.current = null;
});

describe('AdminAccountsPage', () => {
  it('lists every account with its name and email', () => {
    render(<Page />);

    expect(screen.getByText('Ana Cruz')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Ben Reyes')).toBeInTheDocument();
  });

  it('shows how many orders each account has placed', () => {
    render(<Page />);

    expect(screen.getByTestId('order-count-u1')).toHaveTextContent('3');
    expect(screen.getByTestId('order-count-u2')).toHaveTextContent('0');
  });

  it('shows when an account last signed in', () => {
    render(<Page />);

    expect(screen.getByTestId('last-login-u1')).toHaveTextContent('Aug 16, 2026');
  });

  // Blank would read as a rendering bug, and a date would be a lie.
  it('says Never for an account that has not signed in', () => {
    render(<Page />);

    expect(screen.getByTestId('last-login-u2')).toHaveTextContent(/never/i);
  });

  it('marks which accounts hold admin access', () => {
    render(<Page />);

    expect(screen.getByTestId('role-u2')).toHaveTextContent(/admin/i);
    expect(screen.getByTestId('role-u1')).toHaveTextContent(/customer/i);
  });

  it('asks the API for the typed search term', async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.type(screen.getByRole('searchbox', { name: /search/i }), 'ana');

    await waitFor(() => expect(lastArgs.current).toMatchObject({ search: 'ana' }));
  });

  it('asks the API for a single role when a filter is chosen', async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.click(screen.getByRole('button', { name: /admins/i }));

    await waitFor(() => expect(lastArgs.current).toMatchObject({ role: 'admin' }));
  });

  it('says so when there are no accounts rather than showing a blank table', () => {
    rows.current = [];
    render(<Page />);

    expect(screen.getByText(/no accounts/i)).toBeInTheDocument();
  });
});
