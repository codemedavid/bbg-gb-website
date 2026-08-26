import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STAT_VALUE_SIZES, StatCard, statValueClass } from './StatCard';

const step = (value: string) => STAT_VALUE_SIZES.indexOf(statValueClass(value));

describe('statValueClass', () => {
  it('keeps a short figure at the full display size', () => {
    expect(step('34')).toBe(0);
    expect(step('₱40,000')).toBe(0);
  });

  // Total revenue rendered as "₱1,255,096.2" on the live dashboard: at a fixed
  // 28px the figure is wider than a fifth of the stat row, so its last digit
  // was clipped. The card cannot know its own width, but the value's length is
  // a faithful proxy for it — every peso figure is digits, commas and a dot.
  it('steps a long peso figure down so it cannot overflow its card', () => {
    expect(step('₱1,255,096.25')).toBeGreaterThan(step('₱40,000'));
    expect(step('₱1,255,096.25')).toBeGreaterThan(step('₱125,096'));
  });

  it('never steps below the smallest legible size', () => {
    expect(step('₱123,456,789,012.34')).toBe(STAT_VALUE_SIZES.length - 1);
  });
});

describe('StatCard', () => {
  it('renders the whole figure at the size its length calls for', () => {
    render(<StatCard label="Total revenue" value="₱1,255,096.25" sub="214 orders all-time" />);

    const value = screen.getByText('₱1,255,096.25');
    expect(value.className).toContain(statValueClass('₱1,255,096.25'));
    // Truncation would hide the very digits the admin came for.
    expect(value.className).not.toContain('truncate');
  });
});
