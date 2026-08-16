'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthShell, inputCls } from '@/components/AuthShell';
import { apiSend } from '@/lib/api-client';

const MIN_PASSWORD = 8;

function ResetInner() {
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // A link with no token cannot be repaired here — send them back for a new one
  // rather than showing a form whose submit is guaranteed to fail.
  if (!token) {
    return (
      <AuthShell title="Link is incomplete" sub="This reset link is missing its code.">
        <div className="rounded-[12px] bg-[#f6e0e0] px-4 py-3.5 text-[13px] leading-relaxed text-[#b23b3b]">
          Open the link straight from the email, or ask for a new one — reset links expire after an hour.
        </div>
        <Link href="/forgot-password" className="mt-4 block rounded-[12px] bg-brand-green py-3.5 text-center text-[15px] font-bold text-white">
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password updated ✓" sub="You can log in with your new password.">
        <Link href="/login" className="block rounded-[12px] bg-brand-green py-3.5 text-center text-[15px] font-bold text-white">
          Log in
        </Link>
      </AuthShell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // Checked here so a typo costs a retry, not the whole link: the route spends
    // the token on any request that reaches it with a valid password.
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      await apiSend('/auth/reset-password', 'POST', { token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password');
    } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Set a new password" sub={`At least ${MIN_PASSWORD} characters.`}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={inputCls} type="password" name="newPassword" autoComplete="new-password"
          placeholder="New password" minLength={MIN_PASSWORD}
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        <input className={inputCls} type="password" name="confirmPassword" autoComplete="new-password"
          placeholder="Confirm new password" minLength={MIN_PASSWORD}
          value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <div className="rounded-lg bg-[#f6e0e0] px-3 py-2 text-[12.5px] text-[#b23b3b]">{error}</div>}
        <button disabled={busy} className="mt-1 rounded-[12px] bg-brand-green py-3.5 text-[15px] font-bold text-white active:scale-[.99] disabled:opacity-60">
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
      <div className="mt-4 text-center text-[13px] text-ink-muted">
        <Link href="/login" className="font-bold text-brand-blue">← Back to log in</Link>
      </div>
    </AuthShell>
  );
}

// useSearchParams suspends during prerender, so the boundary is required for the
// route to build — same shape as the shop page.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthShell title="Set a new password" sub="Loading your reset link…"><div /></AuthShell>}>
      <ResetInner />
    </Suspense>
  );
}
