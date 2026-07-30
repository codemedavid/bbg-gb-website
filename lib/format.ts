// The declared parameter stays `number | string` so a caller holding a nullable
// value is still a compile error. The runtime guard is for what types cannot
// reach: a field that arrives absent from an API response. This used to throw on
// `undefined` — a money formatter took the whole admin page down with it — and a
// formatter is never worth a blank screen.
export const php = (n: number | string) => {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (typeof v !== 'number' || !Number.isFinite(v)) return '₱0';
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
