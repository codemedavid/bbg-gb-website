'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiSend } from '@/lib/api-client';
import { useAuth } from '@/lib/useAuth';
import { field, label, btnPrimary } from '@/components/admin-ui';

const empty = { currentPassword: '', newPassword: '', confirm: '' };

type PackingFees = { solo: number; kahati: number; group_buy: number };
const PACKING_FIELDS: { key: keyof PackingFees; label: string; hint: string }[] = [
  { key: 'group_buy', label: 'Pasabay (Group Buy) ₱', hint: 'Rides the batch import' },
  { key: 'solo', label: 'On-hand (Solo Buy) ₱', hint: 'Ready stock, buy direct' },
  { key: 'kahati', label: 'Hatian (Kahati) ₱', hint: 'Default for new kahati listings' },
];

function PackingFeesCard() {
  const [fees, setFees] = useState<PackingFees | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ packingFees: PackingFees }>('/admin/settings')
      .then((d) => setFees(d.packingFees))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load packing fees.'));
  }, []);

  const set = (k: keyof PackingFees) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFees((f) => (f ? { ...f, [k]: Number(e.target.value) } : f));
    setDone(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fees) return;
    if (Object.values(fees).some((v) => !Number.isFinite(v) || v < 0)) {
      setError('Fees must be zero or more.');
      return;
    }
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      const d = await apiSend<{ packingFees: PackingFees }>('/admin/settings', 'PATCH', { packingFees: fees });
      setFees(d.packingFees);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save packing fees.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl bg-white p-5 shadow-card">
      <h2 className="mb-1 font-display text-[16px] font-bold text-ink">Packing fees</h2>
      <p className="mb-4 text-[13px] text-ink-muted">One fee per order — local shipping included, no admin fee.</p>
      {!fees && !error && <p className="text-[13px] text-ink-muted">Loading…</p>}
      {fees && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {PACKING_FIELDS.map(({ key, label: lbl, hint }) => (
            <div key={key}>
              <span className={label}>{lbl}</span>
              <input type="number" min={0} step="1" required className={field}
                value={fees[key]} onChange={set(key)} />
              <span className="mt-0.5 block text-[12px] text-ink-muted">{hint}</span>
            </div>
          ))}
          {done && <p className="rounded-[10px] bg-[#e8f5db] px-3 py-2 text-[13px] text-brand-greendark">Packing fees saved ✓</p>}
          <button type="submit" disabled={busy} className={`mt-1 ${btnPrimary}`}>
            {busy ? 'Saving…' : 'Update packing fees'}
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}
    </div>
  );
}

function DownpaymentCard() {
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ kahatiDownpayment: number }>('/admin/settings')
      .then((d) => setAmount(d.kahatiDownpayment))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the downpayment.'));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (amount == null) return;
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Downpayment must be zero or more.');
      return;
    }
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      const d = await apiSend<{ kahatiDownpayment: number }>('/admin/settings', 'PATCH', { kahatiDownpayment: amount });
      setAmount(d.kahatiDownpayment);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the downpayment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl bg-white p-5 shadow-card">
      <h2 className="mb-1 font-display text-[16px] font-bold text-ink">Hatian downpayment</h2>
      <p className="mb-4 text-[13px] text-ink-muted">
        Paid at checkout to reserve kahati slots — deducted from the order total. The balance is collected after the kahati ends.
      </p>
      {amount == null && !error && <p className="text-[13px] text-ink-muted">Loading…</p>}
      {amount != null && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <span className={label}>Downpayment per kahati order ₱</span>
            <input type="number" min={0} step="1" required className={field}
              value={amount} onChange={(e) => { setAmount(Number(e.target.value)); setDone(false); }} />
            <span className="mt-0.5 block text-[12px] text-ink-muted">Small orders are capped at the order total.</span>
          </div>
          {done && <p className="rounded-[10px] bg-[#e8f5db] px-3 py-2 text-[13px] text-brand-greendark">Downpayment saved ✓</p>}
          <button type="submit" disabled={busy} className={`mt-1 ${btnPrimary}`}>
            {busy ? 'Saving…' : 'Update downpayment'}
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-3 rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>}
    </div>
  );
}

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

      <PackingFeesCard />
      <DownpaymentCard />
    </div>
  );
}
