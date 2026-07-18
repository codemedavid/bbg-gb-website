'use client';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/useAuth';

// Admin sign-in gate shown in place of the admin UI until an admin session exists.
// Uses the dedicated /api/admin/login endpoint, which rejects non-admin accounts.
export function AdminLogin({ signedInEmail }: { signedInEmail?: string }) {
  const { adminLogin, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await adminLogin(email.trim().toLowerCase(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full rounded-[10px] border border-line bg-surface-field px-3.5 py-2.5 text-[14px] text-ink outline-none focus:border-brand-green';

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#eef1ec] px-4">
      <div className="w-full max-w-[380px] rounded-2xl bg-white p-7 shadow-card">
        <div className="mb-1 font-display text-[22px] font-bold text-brand-navy">
          BBG<span className="text-brand-green"> Admin</span>
        </div>
        <p className="mb-6 text-[13px] text-ink-muted">Sign in with an admin account to continue.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-body">Email</span>
            <input
              type="email" name="email" autoComplete="username" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@bbgpeptides.ph" className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-body">Password</span>
            <input
              type="password" name="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" className={inputCls}
            />
          </label>

          {error && (
            <p role="alert" className="rounded-[10px] bg-[#fdeaea] px-3 py-2 text-[13px] text-[#a33]">{error}</p>
          )}

          <button
            type="submit" disabled={busy}
            className="mt-1 rounded-[10px] bg-brand-green px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in to admin'}
          </button>
        </form>

        {signedInEmail && (
          <p className="mt-5 text-[12px] text-ink-muted">
            Signed in as <span className="font-semibold">{signedInEmail}</span>, which is not an admin account.{' '}
            <button onClick={() => logout()} className="font-semibold text-brand-blue hover:underline">Log out</button>
          </p>
        )}
      </div>
    </div>
  );
}
