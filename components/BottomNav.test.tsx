// The storefront tab bar.
//
// The MOQ tab is the seventh, and it only exists while the admin has the MOQ
// page switched on. That is not cosmetic: a tab pointing at a route that 404s
// is a broken link, so the nav must never advertise a hidden page. With the
// page off the bar is back to its original six tabs.
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

  it('keeps the original six tabs when MOQ is off', () => {
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

  it('still renders the pre-existing tabs alongside MOQ', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    const names = tabNames().join(' ');
    for (const label of ['Home', 'Kahati', 'Group Buy', 'On-hand', 'Orders', 'Account']) {
      expect(names).toContain(label);
    }
  });
});

// Fitting seven tabs into 320px.
//
// At six tabs each slot is 53px and the widest label ("Group Buy") renders at
// 47px, so it fits on one line. The seventh tab drops slots to 46px and that
// label wraps, spilling below the bar — verified in Chrome at a true 320px
// viewport, which jsdom cannot measure. The nav therefore tightens its label
// type scale only in the seven-tab state, leaving the six-tab bar untouched.
describe('BottomNav seven-tab typography', () => {
  const labelClassOf = (name: RegExp) =>
    screen.getByRole('link', { name }).className;

  it('uses the compact label size when the MOQ tab is present', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    expect(labelClassOf(/Group Buy/i)).toContain('text-[9.5px]');
  });

  it('keeps the roomier label size when only six tabs render', () => {
    moqEnabled = { data: false };
    render(<BottomNav />);
    expect(labelClassOf(/Group Buy/i)).toContain('text-[10.5px]');
  });

  it('applies one consistent label size across all seven tabs', () => {
    moqEnabled = { data: true };
    render(<BottomNav />);
    const sizes = screen.getAllByRole('link')
      .map((a) => (a.className.match(/text-\[[\d.]+px\]/) ?? [''])[0]);
    expect(new Set(sizes).size).toBe(1);
  });
});
