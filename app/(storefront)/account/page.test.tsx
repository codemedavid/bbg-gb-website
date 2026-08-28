// My Account — now the only entrance to My Orders.
//
// Orders lost its slot in the tab bar (seven tabs plus a conditional MOQ tab
// did not fit a 320px phone). That is only a safe trade while Account carries
// the link: without it a customer has no way back to their own orders, and the
// hatian settle prompt that lives on that page becomes unreachable.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const user = { id: 'u1', name: 'Ana Cruz', email: 'ana@example.com', phone: '0917', address: 'x', role: 'customer' };
let auth: { user: typeof user | null; loading: boolean } = { user, loading: false };
vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ ...auth, logout: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/api-client', () => ({ apiSend: vi.fn() }));
vi.mock('@/lib/store/toast', () => ({
  useToast: (select: (s: { show: () => void }) => unknown) => select({ show: vi.fn() }),
}));

const AccountPage = (await import('./page')).default;

beforeEach(() => { auth = { user, loading: false }; });

const ordersLink = () => screen.getByRole('link', { name: /orders/i });

describe('Account page — My Orders entrance', () => {
  it('links to the orders page', () => {
    render(<AccountPage />);
    expect(ordersLink()).toHaveAttribute('href', '/orders');
  });

  it('names the link so a customer looking for their orders recognises it', () => {
    render(<AccountPage />);
    expect(ordersLink()).toHaveTextContent(/my orders/i);
  });

  // Position matters as much as presence: a customer opening Account is far
  // more often chasing an order than editing an address, and this link is now
  // the only way there. Asserted against the page's own content, not the
  // shared header — that chrome renders a cart link ahead of everything.
  it('puts the orders link above the profile forms', () => {
    render(<AccountPage />);
    const profile = screen.getByRole('heading', { name: /^profile$/i });
    const position = ordersLink().compareDocumentPosition(profile);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('still renders the profile, address and password cards', () => {
    render(<AccountPage />);
    expect(screen.getByRole('heading', { name: /^profile$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /shipping address/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /change password/i })).toBeInTheDocument();
  });

  it('sends a signed-out visitor to the login page instead of rendering the link', () => {
    auth = { user: null, loading: false };
    render(<AccountPage />);
    expect(replace).toHaveBeenCalledWith('/login');
    expect(screen.queryByRole('link', { name: /my orders/i })).not.toBeInTheDocument();
  });
});
