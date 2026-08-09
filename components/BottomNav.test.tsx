// The storefront tab bar.
//
// Search is a fixed tab. The MOQ tab is conditional, and it only exists while
// the admin has the MOQ page switched on. That is not cosmetic: a tab pointing
// at a route that 404s is a broken link, so the nav must never advertise a
// hidden page.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/lib/store/cart', () => ({ useCart: () => 0 }));

let moqEnabled: { data: boolean | undefined } = { data: false };
vi.mock('@/lib/queries', () => ({ useMoqPageEnabled: () => moqEnabled }));

const { BottomNav } = await import('./BottomNav');

const tabNames = () => screen.getAllByRole('link').map((a) => a.textContent ?? '');

beforeEach(() => { moqEnabled = { data: false }; });

describe('BottomNav MOQ tab', () => {
  it('hides the MOQ tab while the page is switched off', () => {
    moqEnabled = { data: false };
    render(<BottomNav />);
    expect(screen.queryByRole('link', { name: /MOQ/i })).not.toBeInTheDocument();
  });

  it('renders the fixed seven tabs when MOQ is off', () => {
    moqEnabled = { data: false };
    render(<BottomNav />);
    expect(screen.getAllByRole('link')).toHaveLength(7);
  });

  it('shows the MOQ tab once the page is switched on', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    const moq = screen.getByRole('link', { name: /MOQ/i });
    expect(moq).toBeInTheDocument();
    expect(moq).toHaveAttribute('href', '/moq');
  });

  it('renders eight tabs when MOQ is on', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    expect(screen.getAllByRole('link')).toHaveLength(8);
  });

  it('treats an unresolved setting as off, so no tab flashes in before it loads', () => {
    moqEnabled = { data: undefined };
    render(<BottomNav />);
    expect(screen.queryByRole('link', { name: /MOQ/i })).not.toBeInTheDocument();
  });

  it('still renders the pre-existing tabs alongside MOQ', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    const names = tabNames().join(' ');
    for (const label of ['Home', 'Search', 'Kahati', 'Group Buy', 'On-hand', 'Orders', 'Account']) {
      expect(names).toContain(label);
    }
  });
});

// Fitting eight tabs into 320px.
//
// Fixed columns get too narrow once Search and conditional MOQ are both present,
// so the bar uses stable-width tabs and horizontal overflow instead. JSDOM
// cannot measure the rendered width; these assertions pin the classes that
// prevent labels from wrapping under the bar.
describe('BottomNav compact typography', () => {
  const labelClassOf = (name: RegExp) =>
    screen.getByRole('link', { name }).className;

  it('uses the tightest label size when the MOQ tab is present', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    expect(labelClassOf(/Group Buy/i)).toContain('text-[9px]');
  });

  it('uses the standard compact label size when only fixed tabs render', () => {
    moqEnabled = { data: false };
    render(<BottomNav />);
    expect(labelClassOf(/Group Buy/i)).toContain('text-[9.5px]');
  });

  it('applies one consistent label size across all eight tabs', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    const sizes = screen.getAllByRole('link')
      .map((a) => (a.className.match(/text-\[[\d.]+px\]/) ?? [''])[0]);
    expect(new Set(sizes).size).toBe(1);
  });

  it('keeps each tab from shrinking below a usable tap target', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    expect(labelClassOf(/Group Buy/i)).toContain('min-w-[54px]');
    expect(labelClassOf(/Group Buy/i)).toContain('whitespace-nowrap');
  });
});
