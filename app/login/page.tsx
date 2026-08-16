'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthShell, inputCls } from '@/components/AuthShell';
import { useAuth } from '@/lib/useAuth';
import { safeReturnPath } from '@/lib/return-path';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    // Back to wherever they were headed — an emailed order link, usually. The
    // guard is not optional: `next` comes from the URL, so an unchecked value
    // turns this screen into an open redirect.
    try { await login(email, password); router.replace(safeReturnPath(searchParams.get('next'))); }
    catch (err) { setError(err instanceof Error ? err.message : 'Login failed'); setBusy(false); }
  };

  return (
    <AuthShell title="Kumusta! 👋" sub="Log in to track orders and join kahati.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={inputCls} type="email" name="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className={inputCls} type="password" name="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="rounded-lg bg-[#f6e0e0] px-3 py-2 text-[12.5px] text-[#b23b3b]">{error}</div>}
        <button disabled={busy} className="mt-1 rounded-[12px] bg-brand-green py-3.5 text-[15px] font-bold text-white active:scale-[.99] disabled:opacity-60">
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <div className="mt-3 text-center text-[13px]">
        <Link href="/forgot-password" className="font-semibold text-brand-blue">Nakalimutan ang password?</Link>
      </div>
      <div className="mt-3 text-center text-[13px] text-ink-muted">
        Wala pang account? <Link href="/register" className="font-bold text-brand-blue">Mag-register</Link>
      </div>
    </AuthShell>
  );
}

// useSearchParams suspends during prerender, so the boundary is required for the
// route to build — same shape as the reset-password page.
export default function LoginPage() {
  return (
    <Suspense fallback={<AuthShell title="Kumusta! 👋" sub="Log in to track orders and join kahati."><div /></AuthShell>}>
      <LoginForm />
    </Suspense>
  );
}
