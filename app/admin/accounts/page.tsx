'use client';
import { useEffect, useState } from 'react';
import { useAdminAccounts } from '@/lib/admin-api';
import { shortDate } from '@/lib/format';
import type { AccountRow } from '@/lib/accounts';

// Admin → Accounts: everyone who has registered on the shop.
//
// Every other admin screen finds a customer through something they did — an
// order, a commitment, a settlement — so anyone who signed up and never bought
// was invisible. The "last signed in" column is the activity signal: auth is a
// stateless JWT, so a stamp written at sign-in (users.last_login_at) is the only
// evidence that an account is still in use.
const FILTERS = [['', 'All'], ['customer', 'Customers'], ['admin', 'Admins']] as const;

const ROLE_BADGE: Record<AccountRow['role'], string> = {
  admin: 'bg-[#e4ecff] text-[#0b46b8]',
  customer: 'bg-line text-ink-body',
};

// Long enough that a fast typist sends one request instead of five, short enough
// that the table does not feel stuck behind the keystroke.
const SEARCH_DEBOUNCE_MS = 300;

/**
 * "3 hours ago" for a date, or null when the gap is better read as a date.
 *
 * The question this screen answers is "is this account still in use", and days
 * are the unit that answers it. Past a week the exact date carries more than a
 * count of days does, so this stops rather than reporting "63 days ago".
 */
function relativeSince(iso: string): string | null {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return null;
  const hours = Math.floor(ms / 3600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days <= 7 ? `${days}d ago` : null;
}

export default function AdminAccountsPage() {
  const [role, setRole] = useState('');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const { data: accounts = [], isLoading, error } = useAdminAccounts(search || undefined, role || undefined);

  // Debounced so the list is not re-queried on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearch(typed.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [typed]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 font-display text-[24px] font-bold">Accounts</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Everyone who has registered, including customers who have not ordered yet.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([val, lbl]) => (
          <button key={val} onClick={() => setRole(val)}
            aria-pressed={role === val}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${role === val ? 'bg-brand-navy text-white' : 'bg-white text-ink-body'}`}>{lbl}</button>
        ))}
        <input
          type="search"
          aria-label="Search accounts"
          placeholder="Search name or email…"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="ml-auto w-full rounded-[10px] border border-line bg-white px-3 py-1.5 text-[13px] sm:w-64"
        />
      </div>

      {/* A failed load has to say so. Falling through to the empty state would
          read as "nobody has signed up", which is a very different fact. */}
      {error && (
        <p role="alert" className="rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">
          {error instanceof Error ? error.message : 'Could not load the accounts.'}
        </p>
      )}

      <div className="overflow-x-auto rounded-[16px] bg-white shadow-card">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="border-b border-line-soft text-[11.5px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Orders</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Last signed in</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td className="px-4 py-6 text-ink-muted" colSpan={6}>Loading…</td></tr> :
              accounts.length ? accounts.map((a) => {
                const since = a.lastLoginAt ? relativeSince(a.lastLoginAt) : null;
                return (
                  <tr key={a.id} className="border-b border-line-soft/60">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{a.name}</div>
                      <div className="text-[11px] text-ink-muted">{a.email}</div>
                    </td>
                    <td className="px-4 py-3 text-ink-body">{a.phone || <span className="text-ink-muted">—</span>}</td>
                    <td className="px-4 py-3">
                      <span data-testid={`role-${a.id}`} className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${ROLE_BADGE[a.role]}`}>
                        {a.role === 'admin' ? 'Admin' : 'Customer'}
                      </span>
                    </td>
                    <td data-testid={`order-count-${a.id}`} className="px-4 py-3 font-bold text-ink">{a.orderCount}</td>
                    <td className="px-4 py-3 text-ink-muted">{shortDate(a.createdAt)}</td>
                    {/* Never, not blank: an account can genuinely have no
                        sign-in, and an empty cell reads as a broken column. */}
                    <td data-testid={`last-login-${a.id}`} className="px-4 py-3">
                      {a.lastLoginAt ? (
                        <>
                          <div className="text-ink-body">{shortDate(a.lastLoginAt)}</div>
                          {since && <div className="text-[11px] text-brand-greendark">{since}</div>}
                        </>
                      ) : <span className="text-[12px] font-semibold text-ink-muted">Never</span>}
                    </td>
                  </tr>
                );
              }) : <tr><td className="px-4 py-6 text-ink-muted" colSpan={6}>No accounts match this view.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
