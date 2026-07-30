// The admin nav.
//
// Three entries used to read almost identically — "Group Buys" (which is the
// hatian board), "Group Buy Campaigns", and "MOQ Products" — and the client
// asked for the campaign workflow to be told apart from Hatian. The nav is
// where that separation is either obvious or lost, so it is asserted here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let pathname = '/admin';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ user: { email: 'admin@bbg.ph', role: 'admin' }, loading: false, logout: vi.fn() }),
}));

vi.mock('@/components/Toast', () => ({ Toast: () => null }));

const AdminLayout = (await import('./layout')).default;

// Every nav renders twice — a desktop rail and a mobile strip — so a link is
// looked up by name and its shared href checked.
const navLink = (name: RegExp) => screen.getAllByRole('link', { name });
const hrefOf = (name: RegExp) => navLink(name)[0].getAttribute('href');

beforeEach(() => { pathname = '/admin'; });

describe('telling the two group buys apart', () => {
  it('gives the campaign workflow its own Group Buy section', () => {
    render(<AdminLayout><div /></AdminLayout>);
    expect(hrefOf(/^group buy$/i)).toBe('/admin/group-buy');
  });

  it('names the hatian board Hatian rather than Group Buys', () => {
    render(<AdminLayout><div /></AdminLayout>);
    expect(hrefOf(/^hatian$/i)).toBe('/admin/groupbuys');
    expect(screen.queryByRole('link', { name: /^group buys$/i })).not.toBeInTheDocument();
  });

  it('no longer offers the old campaigns entry', () => {
    render(<AdminLayout><div /></AdminLayout>);
    expect(screen.queryByRole('link', { name: /group buy campaigns/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^campaigns$/i })).not.toBeInTheDocument();
  });
});

describe('marking where you are', () => {
  it('marks Group Buy as current anywhere inside the section', () => {
    pathname = '/admin/group-buy/campaigns/new';
    render(<AdminLayout><div /></AdminLayout>);
    expect(navLink(/^group buy$/i)[0]).toHaveAttribute('aria-current', 'page');
  });

  // The two hrefs are not prefixes of one another, and the nav must not treat
  // them as if they were.
  it('does not mark Hatian as current while inside Group Buy', () => {
    pathname = '/admin/group-buy/campaigns';
    render(<AdminLayout><div /></AdminLayout>);
    expect(navLink(/^hatian$/i)[0]).not.toHaveAttribute('aria-current');
  });

  it('marks the dashboard current only on the dashboard itself', () => {
    pathname = '/admin/orders';
    render(<AdminLayout><div /></AdminLayout>);
    expect(navLink(/^dashboard$/i)[0]).not.toHaveAttribute('aria-current');
  });
});
