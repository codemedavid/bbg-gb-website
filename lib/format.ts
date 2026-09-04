/**
 * What is shown where a price should be but no price could be resolved.
 *
 * An em dash rather than a number, because the difference between "free" and
 * "we could not load this" has to survive being looked at. ₱0 is a price a
 * customer can act on — they will try to buy it — and it is the one answer a
 * broken price must never give.
 */
export const PRICE_UNAVAILABLE = '—';

/** Is this value something we can actually put a peso sign in front of? */
export function isDisplayablePrice(n: unknown): boolean {
  if (typeof n === 'number') return Number.isFinite(n);
  if (typeof n === 'string') return n.trim() !== '' && Number.isFinite(parseFloat(n));
  return false;
}

/**
 * Format an amount in pesos.
 *
 * The declared parameter stays `number | string` so a caller holding a nullable
 * value is still a compile error. The runtime guard is for what types cannot
 * reach: a field that arrives absent from an API response, a nullable money
 * column, a response whose shape changed.
 *
 * That guard used to answer every one of those with '₱0'. It was added because
 * the formatter threw on undefined and took a whole admin page down with it —
 * a real problem, and a formatter is never worth a blank screen. But the two
 * options were never "crash" or "lie": undefined, null, NaN, '', 'abc', {} and
 * [] all rendered as a believable, actionable, wrong price, and because this
 * fallback lives in the ONE formatter every screen shares, a single dropped
 * field became ₱0 everywhere at once. That is the reported "some product prices
 * occasionally display as ₱0", and it is why it looked like it might be an
 * attack — a price with no cause is indistinguishable from a tampered one.
 *
 * A real, known zero still formats as ₱0. A waived packing fee and a settled
 * balance are genuine answers. Only the UNKNOWN stops pretending to be one.
 */
export const php = (n: number | string) => {
  if (!isDisplayablePrice(n)) return PRICE_UNAVAILABLE;
  const v = typeof n === 'string' ? parseFloat(n) : n;
  return '₱' + (v % 1 ? v.toLocaleString('en-US', { minimumFractionDigits: 2 }) : v.toLocaleString('en-US'));
};

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function closesIn(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'closed';
  const days = Math.floor(ms / 86400_000);
  const hours = Math.floor((ms % 86400_000) / 3600_000);
  return `${days}d ${String(hours).padStart(2, '0')}h`;
}
