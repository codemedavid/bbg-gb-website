// The storefront tab bar.
//
// Search is a fixed tab. The MOQ tab is conditional, and it only exists while
// the admin has the MOQ page switched on. That is not cosmetic: a tab pointing
// at a route that 404s is a broken link, so the nav must never advertise a
// hidden page.
//
// Orders is deliberately NOT a tab. Eight tabs did not fit a 320px phone, so
// the bar scrolled sideways and MOQ — the tab meant to read as a pair with
// On-hand — was pushed off the visible strip. Orders moved under Account,
// where the customer already goes for their own records.
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

  it('renders the fixed six tabs when MOQ is off', () => {
    moqEnabled = { data: false };
    render(<BottomNav />);
    expect(screen.getAllByRole('link')).toHaveLength(6);
  });

  it('shows the MOQ tab once the page is switched on', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    const moq = screen.getByRole('link', { name: /MOQ/i });
    expect(moq).toBeInTheDocument();
    expect(moq).toHaveAttribute('href', '/moq');
  });

  it('renders seven tabs when MOQ is on', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    expect(screen.getAllByRole('link')).toHaveLength(7);
  });

  it('treats an unresolved setting as off, so no tab flashes in before it loads', () => {
    moqEnabled = { data: undefined };
    render(<BottomNav />);
    expect(screen.queryByRole('link', { name: /MOQ/i })).not.toBeInTheDocument();
  });

  it('places the MOQ tab directly after On-hand, not at the end of the bar', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    const names = tabNames();
    expect(names.indexOf('\u{1F3F7}️MOQ')).toBe(names.findIndex((n) => n.includes('On-hand')) + 1);
  });

  it('still renders the pre-existing tabs alongside MOQ', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    const names = tabNames().join(' ');
    for (const label of ['Home', 'Search', 'Kahati', 'Group Buy', 'On-hand', 'Account']) {
      expect(names).toContain(label);
    }
  });
});

// Orders moved off the bar.
describe('BottomNav Orders tab removal', () => {
  it('keeps Orders out of the bar while MOQ is off', () => {
    moqEnabled = { data: false };
    render(<BottomNav />);
    expect(screen.queryByRole('link', { name: /Orders/i })).not.toBeInTheDocument();
  });

  it('keeps Orders out of the bar while MOQ is on', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    expect(screen.queryByRole('link', { name: /Orders/i })).not.toBeInTheDocument();
  });

  it('links no tab at /orders, so the route has exactly one entrance', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/orders');
  });
});

// Fitting the bar into 320px.
//
// The narrowest phone the shop supports is 320px wide. Every tab must be on
// that strip at once: the bar can only scroll sideways if a tab is hidden, and
// a hidden tab is one the customer never taps. JSDOM cannot measure rendered
// width, so these assertions pin the reserved width per tab and the label size
// that keeps the text on one line inside it.
const NARROWEST_VIEWPORT_PX = 320;

const reservedWidth = () =>
  screen.getAllByRole('link')
    .map((a) => Number((a.className.match(/min-w-\[(\d+)px\]/) ?? [, '0'])[1]))
    .reduce((sum, w) => sum + w, 0);

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

  it('applies one consistent label size across all seven tabs', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    const sizes = screen.getAllByRole('link')
      .map((a) => (a.className.match(/text-\[[\d.]+px\]/) ?? [''])[0]);
    expect(new Set(sizes).size).toBe(1);
  });

  it('keeps each tab from shrinking below a usable tap target', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    expect(labelClassOf(/Group Buy/i)).toContain('min-w-[44px]');
    expect(labelClassOf(/Group Buy/i)).toContain('whitespace-nowrap');
  });

  it('fits all seven tabs on a 320px screen without scrolling MOQ out of view', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    expect(reservedWidth()).toBeLessThanOrEqual(NARROWEST_VIEWPORT_PX);
  });

  it('fits the six fixed tabs on a 320px screen', () => {
    moqEnabled = { data: false };
    render(<BottomNav />);
    expect(reservedWidth()).toBeLessThanOrEqual(NARROWEST_VIEWPORT_PX);
  });
});
