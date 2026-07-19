// The hatian board card. Two display bugs lived here: the progress bar read
// `g.progress` (NaN when the cap was 0) and the badge used a `remaining <= 10`
// threshold that is always true at a 10-vial cap, so every card read "N VIALS LEFT".
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GroupBuy } from '@/lib/types';
import { GroupBuyCard } from './GroupBuyCard';

const gb = (o: Partial<GroupBuy> = {}): GroupBuy => ({
  id: 'g1', name: 'Retatrutide Hatian', pricePerKitPhp: '9000', perVialPhp: 900,
  totalSlots: 10, claimedSlots: 0, remaining: 10, progress: 0, minVials: 1,
  repackFeePhp: '150', status: 'open', closesAt: null, arrivalGroup: 'white_powder',
  description: null, createdAt: new Date().toISOString(),
  ...o,
} as unknown as GroupBuy);

const bar = (): HTMLElement => document.querySelector('[style*="width"]') as HTMLElement;

// "4/10" is built from three JSX text nodes, so a plain string matcher misses it.
const counter = (text: string) =>
  screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === text);

describe('GroupBuyCard', () => {
  it('badges a fresh hatian OPEN, not "10 VIALS LEFT"', () => {
    render(<GroupBuyCard g={gb()} onJoin={vi.fn()} />);

    expect(screen.getByText('OPEN')).toBeInTheDocument();
  });

  it('warns FILLING FAST once half the kit is claimed', () => {
    render(<GroupBuyCard g={gb({ claimedSlots: 5, remaining: 5 })} onJoin={vi.fn()} />);

    expect(screen.getByText('FILLING FAST')).toBeInTheDocument();
  });

  it('counts down the final vials in the singular', () => {
    render(<GroupBuyCard g={gb({ claimedSlots: 9, remaining: 1 })} onJoin={vi.fn()} />);

    expect(screen.getByText('1 VIAL LEFT')).toBeInTheDocument();
  });

  it('shows the live vial count', () => {
    render(<GroupBuyCard g={gb({ claimedSlots: 4 })} onJoin={vi.fn()} />);

    expect(counter('4/10')).toBeInTheDocument();
  });

  it('fills the progress bar proportionally to the claimed vials', () => {
    render(<GroupBuyCard g={gb({ claimedSlots: 3 })} onJoin={vi.fn()} />);

    expect(bar()).toHaveStyle({ width: '30%' });
  });

  it('renders a 0%-wide bar — never NaN — when the cap is zero', () => {
    render(<GroupBuyCard g={gb({ totalSlots: 0, claimedSlots: 0 })} onJoin={vi.fn()} />);

    expect(bar().style.width).toBe('0%');
  });

  it('never overflows the bar past 100%', () => {
    render(<GroupBuyCard g={gb({ claimedSlots: 14 })} onJoin={vi.fn()} />);

    expect(bar()).toHaveStyle({ width: '100%' });
  });

  it('lets an open hatian be joined', () => {
    const onJoin = vi.fn();
    render(<GroupBuyCard g={gb()} onJoin={onJoin} />);

    screen.getByRole('button', { name: 'Sali!' }).click();

    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it('blocks joining a closed hatian', () => {
    const onJoin = vi.fn();
    render(<GroupBuyCard g={gb({ status: 'closed', claimedSlots: 10, remaining: 0 })} onJoin={onJoin} />);

    const button = screen.getByRole('button', { name: 'Closed' });
    expect(button).toBeDisabled();
    expect(screen.getByText('CLOSED')).toBeInTheDocument();

    button.click();
    expect(onJoin).not.toHaveBeenCalled();
  });
});
