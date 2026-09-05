'use client';
import { Fragment, useEffect, useState } from 'react';
import { useAdminAccounts, useIssueResetLink, type IssuedResetLink } from '@/lib/admin-api';
import { searchInput } from '@/components/admin-ui';
import { shortDate } from '@/lib/format';
import type { AccountRow } from '@/lib/accounts';

// Admin → Accounts: everyone who has registered on the shop.
//
// Every other admin screen finds a customer through something they did — an
// order, a commitment, a settlement — so anyone who signed up and never bought
// was invisible. The "last signed in" column is the activity signal: auth is a
// stateless JWT, so a stamp written at sign-in (users.last_login_at) is the only
// evidence that an account is still in use.
//
// It is also where a locked-out customer gets recovered. Account recovery runs
// on a PostHog workflow that has failed twice in three weeks, and each time the
// customer's only way back in was to register a new email address and abandon
// their order history. "Issue reset link" is the way back that does not depend
// on their inbox: the admin hands it over on WhatsApp, where BBG already talks
// to them.
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
  const issueLink = useIssueResetLink();
  // One at a time. A screenful of live credentials is a screenful to leak, and
  // the admin is working one customer's chat thread at a time anyway.
  const [issued, setIssued] = useState<(IssuedResetLink & { id: string }) | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleIssue = async (account: AccountRow) => {
    setIssueError(null);
    setCopied(false);
    setIssued(null);
    try {
      setIssued({ id: account.id, ...await issueLink.mutateAsync(account.id) });
    } catch (err) {
      // Named, and with the reason kept: an admin who has just promised a
      // customer a link needs to know it was never minted, and why.
      setIssueError(`Could not issue a reset link for ${account.name}. ${
        err instanceof Error ? err.message : 'Please try again.'}`);
    }
  };

  const handleCopy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.resetUrl);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright. The link is on screen and
      // selectable either way, so this is a downgrade, not a failure.
      setCopied(false);
    }
  };

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
          className={`ml-auto ${searchInput}`}
        />
      </div>

      {/* A failed load has to say so. Falling through to the empty state would
          read as "nobody has signed up", which is a very different fact. */}
      {error && (
        <p role="alert" className="rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">
          {error instanceof Error ? error.message : 'Could not load the accounts.'}
        </p>
      )}

      {issueError && (
        <p role="alert" className="rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">
          {issueError}
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
              <th className="px-4 py-3 text-right">Recovery</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? <tr><td className="px-4 py-6 text-ink-muted" colSpan={7}>Loading…</td></tr> :
              accounts.length ? accounts.map((a) => {
                const since = a.lastLoginAt ? relativeSince(a.lastLoginAt) : null;
                const showing = issued?.id === a.id ? issued : null;
                return (
                  <Fragment key={a.id}>
                  <tr className={`border-b border-line-soft/60 ${showing ? 'bg-brand-green/5' : ''}`}>
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
                    {/* Customers only. The server refuses to mint a credential
                        for another administrator, so offering the button would
                        only invite the error. */}
                    <td className="px-4 py-3 text-right">
                      {a.role === 'customer' && (
                        <button
                          type="button"
                          aria-label={`Issue reset link for ${a.name}`}
                          disabled={issueLink.isPending}
                          onClick={() => handleIssue(a)}
                          className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-body transition-colors hover:border-brand-greendark hover:bg-brand-greendark hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-greendark disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Issue reset link
                        </button>
                      )}
                    </td>
                  </tr>
                  {showing && (
                    <tr className="border-b border-line-soft/60 bg-brand-green/5">
                      <td colSpan={7} className="px-4 pb-4 pt-0">
                        <div className="rounded-[12px] border border-brand-greendark/25 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[12px] font-bold text-brand-greendark">
                              Reset link for {showing.email}
                            </span>
                            <button
                              type="button"
                              onClick={handleCopy}
                              className="rounded-full bg-brand-greendark px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-greendark"
                            >
                              {copied ? 'Copied' : 'Copy link'}
                            </button>
                          </div>
                          {/* Selectable and wrapped rather than truncated: this
                              is the one thing on the screen the admin has to get
                              out intact, and a clipboard write can be refused. */}
                          <code
                            data-testid={`reset-link-${a.id}`}
                            className="mt-2 block break-all rounded-[8px] bg-line/40 px-2.5 py-2 font-mono text-[11.5px] text-ink-body"
                          >
                            {showing.resetUrl}
                          </code>
                          {/* A link with no stated lifetime gets pasted into a
                              chat and clicked tomorrow, by which point it is
                              dead and reads as the feature being broken. */}
                          <p data-testid={`reset-link-note-${a.id}`} className="mt-2 text-[11.5px] text-ink-muted">
                            Works <strong>once</strong> and expires in <strong>{showing.expiresInMinutes} minutes</strong>.
                            Send it straight to the customer — anyone who has this link can set the password.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              }) : <tr><td className="px-4 py-6 text-ink-muted" colSpan={7}>No accounts match this view.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
