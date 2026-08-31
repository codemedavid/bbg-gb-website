// The Orders shortcut that sits beside the cart in every storefront header.
//
// My Orders lost its slot in the bottom nav and became reachable only through
// the Account page — two taps, and only if you guess that "Account" is where
// your orders live. A customer chasing a delivery is the most common reason to
// open the app at all, so the shortcut belongs in the header chrome the cart
// already occupies.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from '@/lib/types';

const signedIn = { id: 'u1', name: 'Yna', email: 'yna@example.com', role: 'customer' } as unknown as User;

let auth: { user: User | null; loading: boolean } = { user: signedIn, loading: false };
vi.mock('@/lib/useAuth', () => ({ useAuth: () => auth }));

const { OrdersShortcut } = await import('./OrdersShortcut');

beforeEach(() => {
  auth = { user: signedIn, loading: false };
});

describe('OrdersShortcut', () => {
  it('links to My Orders', () => {
    render(<OrdersShortcut />);

    expect(screen.getByRole('link', { name: /orders/i })).toHaveAttribute('href', '/orders');
  });

  it('names itself for screen readers rather than leaving a bare emoji', () => {
    render(<OrdersShortcut />);

    expect(screen.getByRole('link', { name: 'My orders' })).toBeInTheDocument();
  });

  it('carries the word, not just the icon', () => {
    // The same argument the cart shortcut makes: a header has room for the
    // word, and the word is what makes the shortcut findable.
    render(<OrdersShortcut />);

    expect(screen.getByRole('link', { name: 'My orders' })).toHaveTextContent('Orders');
  });

  it('renders nothing for a signed-out visitor', () => {
    // /orders bounces anonymous visitors to /login. Offering the shortcut to
    // someone who cannot use it is a dead end dressed as a feature.
    auth = { user: null, loading: false };

    render(<OrdersShortcut />);

    expect(screen.queryByRole('link', { name: /orders/i })).not.toBeInTheDocument();
  });

  it('renders nothing while auth is still resolving', () => {
    // Auth loads after first paint. Showing the link and then yanking it away
    // is worse than showing it a beat late.
    auth = { user: null, loading: true };

    render(<OrdersShortcut />);

    expect(screen.queryByRole('link', { name: /orders/i })).not.toBeInTheDocument();
  });
});
