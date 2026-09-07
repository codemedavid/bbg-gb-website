// BackHeader — the Checkout page's only navigation. Checkout sits outside the
// bottom nav, so without an explicit Home link the page is a dead end.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from '@/lib/types';

const back = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back, push, replace: vi.fn(), prefetch: vi.fn() }),
}));
// AuthControl (used by the other headers) pulls in the auth context; BackHeader
// does not, so a minimal stub keeps this file focused on navigation.
let auth: { user: User | null; loading: boolean } = { user: null, loading: false };
vi.mock('@/lib/useAuth', () => ({ useAuth: () => auth }));

const { BackHeader, SectionHeader, AppHeader } = await import('./headers');

const signedIn = { id: 'u1', name: 'Yna', email: 'yna@example.com', role: 'customer' } as unknown as User;

beforeEach(() => {
  auth = { user: null, loading: false };
});

describe('BackHeader', () => {
  it('shows no Home link by default', () => {
    render(<BackHeader title="Cart · 2" />);

    expect(screen.queryByRole('link', { name: /home/i })).not.toBeInTheDocument();
  });

  it('offers a Home link to the storefront when asked', () => {
    render(<BackHeader title="Checkout" showHome />);

    const home = screen.getByRole('link', { name: /home/i });
    expect(home).toBeInTheDocument();
    expect(home).toHaveAttribute('href', '/');
  });

  it('still renders the back control alongside Home', () => {
    render(<BackHeader title="Checkout" showHome />);

    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
    expect(screen.getByText('Checkout')).toBeInTheDocument();
  });

  it('runs a supplied onBack instead of router.back()', async () => {
    const onBack = vi.fn();
    render(<BackHeader title="Checkout" onBack={onBack} showHome />);

    screen.getByRole('button', { name: /go back/i }).click();

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });
});

// The shortcut the customer uses to reach their own orders. It rides the header
// rather than each page so one placement covers every board tab, and it sits
// next to the cart because that is the control they already look to on the
// right-hand side of the header.
describe('Orders shortcut in the headers', () => {
  it('sits beside the cart on a board header when signed in', () => {
    auth = { user: signedIn, loading: false };

    render(<SectionHeader title="Kahati Board" />);

    const cart = screen.getByRole('link', { name: /^cart/i });
    const orders = screen.getByRole('link', { name: 'My orders' });
    expect(orders).toHaveAttribute('href', '/orders');
    expect(cart.nextElementSibling).toBe(orders);
  });

  it('sits beside the cart on the home header when signed in', () => {
    auth = { user: signedIn, loading: false };

    // The home header's cart is the compact icon button, which carries no
    // accessible name of its own — matched by destination instead.
    const { container } = render(<AppHeader />);

    const cart = container.querySelector('a[href="/cart"]');
    const orders = screen.getByRole('link', { name: 'My orders' });
    expect(cart?.nextElementSibling).toBe(orders);
  });

  it('is absent from a board header for a signed-out visitor', () => {
    render(<SectionHeader title="Kahati Board" />);

    expect(screen.queryByRole('link', { name: 'My orders' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^cart/i })).toBeInTheDocument();
  });

  it('is absent from the home header for a signed-out visitor', () => {
    render(<AppHeader />);

    expect(screen.queryByRole('link', { name: 'My orders' })).not.toBeInTheDocument();
  });
});

// BBG's customers ask their questions on chat, not email — the whole kahati
// runs on WhatsApp and Viber threads. The number was only ever handed out in
// those threads, so a visitor who lands on the site cold has no way to start
// one. It rides beside the wordmark because that is the first thing read on
// the page, and it is there for signed-out visitors too: the people most
// likely to need to ask something before they commit a vial.
describe('Chat shortcuts in the home header', () => {
  it('offers WhatsApp and Viber links to the BBG number', () => {
    render(<AppHeader />);

    expect(screen.getByRole('link', { name: /whatsapp/i })).toHaveAttribute(
      'href',
      'https://wa.me/639914462762',
    );
    expect(screen.getByRole('link', { name: /viber/i })).toHaveAttribute(
      'href',
      'viber://chat?number=%2B639914462762',
    );
  });

  it('sits after the wordmark and before the cart controls', () => {
    const { container } = render(<AppHeader greeting="Hi, BBG 👋" />);

    const wordmark = screen.getByText(/Peptides/);
    const whatsapp = screen.getByRole('link', { name: /whatsapp/i });
    const viber = screen.getByRole('link', { name: /viber/i });
    const cart = container.querySelector('a[href="/cart"]')!;

    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(wordmark, whatsapp)).toBe(true);
    expect(follows(whatsapp, viber)).toBe(true);
    expect(follows(viber, cart)).toBe(true);
  });

  it('opens WhatsApp in its own tab without handing it the referrer', () => {
    render(<AppHeader />);

    const whatsapp = screen.getByRole('link', { name: /whatsapp/i });
    expect(whatsapp).toHaveAttribute('target', '_blank');
    expect(whatsapp).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('stays put once the customer is signed in', () => {
    auth = { user: signedIn, loading: false };

    render(<AppHeader greeting="Hi, Yna 👋" />);

    expect(screen.getByRole('link', { name: /whatsapp/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /viber/i })).toBeInTheDocument();
  });
});

// The board tabs and the pages outside the nav carry the same two links. A
// customer stuck at checkout, or looking at a hatian that has not moved, is
// exactly who needs to ask something — and asking should not cost them a trip
// back to the homepage to find the buttons.
describe('Chat shortcuts on the other headers', () => {
  const links = () => ({
    whatsapp: screen.getByRole('link', { name: /whatsapp/i }),
    viber: screen.getByRole('link', { name: /viber/i }),
  });

  it('rides the board headers, after the title and before the cart', () => {
    const { container } = render(<SectionHeader title="🤝 Kahati Board" sub="Shared orders" />);

    const { whatsapp, viber } = links();
    expect(whatsapp).toHaveAttribute('href', 'https://wa.me/639914462762');
    expect(viber).toHaveAttribute('href', 'viber://chat?number=%2B639914462762');

    const title = screen.getByText('🤝 Kahati Board');
    const cart = container.querySelector('a[href="/cart"]')!;
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(title, whatsapp)).toBe(true);
    expect(follows(viber, cart)).toBe(true);
  });

  it('rides a board header for a signed-in customer too', () => {
    auth = { user: signedIn, loading: false };

    render(<SectionHeader title="📦 My Orders" />);

    expect(links().whatsapp).toBeInTheDocument();
    expect(links().viber).toBeInTheDocument();
  });

  it('rides the back header without displacing the back control or Home', () => {
    render(<BackHeader title="Checkout" showHome />);

    const { whatsapp, viber } = links();
    expect(whatsapp).toHaveAttribute('href', 'https://wa.me/639914462762');
    expect(viber).toHaveAttribute('href', 'viber://chat?number=%2B639914462762');
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
  });

  it('rides a back header that has no Home link', () => {
    render(<BackHeader title="Cart · 2" />);

    expect(links().whatsapp).toBeInTheDocument();
    expect(links().viber).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /home/i })).not.toBeInTheDocument();
  });
});
