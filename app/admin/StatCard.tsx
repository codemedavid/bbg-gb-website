'use client';

/**
 * Font-size steps for a stat card's headline figure, largest first.
 *
 * A card is a fifth of the dashboard's stat row, so its width is fixed by the
 * grid and not by its contents — a figure that outgrows it does not push the
 * card wider, it spills out of it. That is how total revenue reached production
 * reading "₱1,255,096.2": the last digit fell off the edge.
 *
 * The card cannot measure itself without JS, but it does not need to. Every
 * figure here is digits, commas and a dot, rendered with tabular-nums, so
 * character count is a faithful stand-in for rendered width. Each step still
 * clamps against the viewport, so the same figure also shrinks on a phone.
 */
export const STAT_VALUE_SIZES = [
  'text-[clamp(22px,1.1rem+0.8vw,28px)]',
  'text-[clamp(18px,0.95rem+0.6vw,23px)]',
  'text-[clamp(15px,0.8rem+0.5vw,19px)]',
] as const;

type StatValueSize = typeof STAT_VALUE_SIZES[number];

// Character counts, not pixels: a card is ~190px wide at the xl breakpoint, and
// these are where a tabular-nums display figure stops fitting one at each step.
const WIDE = 9;
const WIDER = 12;

export function statValueClass(value: string): StatValueSize {
  if (value.length > WIDER) return STAT_VALUE_SIZES[2];
  if (value.length > WIDE) return STAT_VALUE_SIZES[1];
  return STAT_VALUE_SIZES[0];
}

type Props = {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
};

export function StatCard({ label, value, sub, accent }: Props) {
  return (
    <div className="min-w-0 rounded-[16px] bg-white p-5 shadow-card">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      {/* break-words, not truncate: if a figure ever outgrows even the smallest
          step it wraps to a second line. Hiding digits is the one outcome a
          revenue card must never have. */}
      <div
        className={`mt-1.5 font-display font-bold leading-tight tabular-nums break-words ${statValueClass(value)}`}
        style={{ color: accent || '#1c2b26' }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[12.5px] text-ink-muted">{sub}</div>}
    </div>
  );
}
