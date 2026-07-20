'use client';
import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '@/lib/api-client';

// MOQ page visibility.
//
// The switch never guesses: it renders whatever the server last reported, and a
// failed save leaves it in its previous position with the error shown. An
// optimistic toggle here would be actively misleading — an admin would believe
// the storefront page was live while customers still got a 404.
export function MoqPageCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ moqPageEnabled: boolean }>('/admin/settings')
      .then((d) => setEnabled(d.moqPageEnabled))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the MOQ page status.'));
  }, []);

  const toggle = async () => {
    if (enabled == null || busy) return;
    setError(null);
    setBusy(true);
    try {
      const d = await apiSend<{ moqPageEnabled: boolean }>('/admin/settings', 'PATCH', { moqPageEnabled: !enabled });
      setEnabled(d.moqPageEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the MOQ page status.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl bg-white p-5 shadow-card">
      <h2 className="mb-1 font-display text-[16px] font-bold text-ink">MOQ page</h2>
      <p className="mb-4 text-[13px] text-ink-muted">
        Turn the storefront MOQ page on or off. While it is off the page is hidden from the menu and
        returns 404 even if a customer types the URL directly.
      </p>

      {enabled == null && !error && <p className="text-[13px] text-ink-muted">Loading…</p>}

      {enabled != null && (
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-bold text-ink">
              Status:{' '}
              <span className={enabled ? 'text-brand-greendark' : 'text-warn-fg'}>
                {enabled ? 'Visible to customers' : 'Hidden from customers'}
              </span>
            </div>
            <div className="mt-0.5 text-[12px] text-ink-muted">
              {enabled ? 'Customers can browse and buy MOQ products.' : 'The MOQ tab and route are unavailable.'}
            </div>
          </div>

          <button type="button" role="switch" aria-checked={enabled} aria-label="MOQ page"
            disabled={busy} onClick={toggle}
            className={`relative h-[30px] w-[54px] flex-none rounded-full transition-colors disabled:opacity-60 ${
              enabled ? 'bg-brand-green' : 'bg-[#c9d2c5]'}`}>
            <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-[left] duration-200 ${
              enabled ? 'left-[27px]' : 'left-[3px]'}`} />
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}
    </div>
  );
}
