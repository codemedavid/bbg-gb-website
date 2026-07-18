'use client';
import { useState, type FormEvent } from 'react';
import { apiSend } from '@/lib/api-client';
import { useAuth } from '@/lib/useAuth';
import { field, label, btnPrimary } from '@/components/admin-ui';

const empty = { currentPassword: '', newPassword: '', confirm: '' };

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const [pw, setPw] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setPw((p) => ({ ...p, [k]: e.target.value }));
    setError(null);
    setDone(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (pw.newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (pw.newPassword !== pw.confirm) { setError('New passwords do not match.'); return; }
    setBusy(true);
    try {
      await apiSend('/auth/password', 'POST', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw(empty);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[480px]">
      <h1 className="mb-1 font-display text-[24px] font-bold text-ink">⚙️ Settings</h1>
      <p className="mb-6 text-[13px] text-ink-muted">Signed in as <span className="font-semibold">{user?.email}</span></p>

      <div className="rounded-2xl bg-white p-5 shadow-card">
        <h2 className="mb-4 font-display text-[16px] font-bold text-ink">Change password</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <span className={label}>Current password</span>
            <input type="password" autoComplete="current-password" required className={field}
              value={pw.currentPassword} onChange={set('currentPassword')} />
          </div>
          <div>
            <span className={label}>New password</span>
            <input type="password" autoComplete="new-password" required minLength={8} className={field}
              value={pw.newPassword} onChange={set('newPassword')} placeholder="At least 8 characters" />
          </div>
          <div>
            <span className={label}>Confirm new password</span>
            <input type="password" autoComplete="new-password" required className={field}
              value={pw.confirm} onChange={set('confirm')} />
          </div>

          {error && <p role="alert" className="rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}
          {done && <p className="rounded-[10px] bg-[#e8f5db] px-3 py-2 text-[13px] text-brand-greendark">Password changed ✓</p>}

          <button type="submit" disabled={busy} className={`mt-1 ${btnPrimary}`}>
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
