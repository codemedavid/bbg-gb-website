'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AuthShell, inputCls } from '@/components/AuthShell';
import { apiSend } from '@/lib/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await apiSend('/auth/forgot-password', 'POST', { email });
      setSent(true);
    } catch (err) {
      // Only a failed request gets an error. "No such account" never reaches
      // this screen by design — the route answers every address the same way.
      setError(err instanceof Error ? err.message : 'Could not send the reset link');
    } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Nakalimutan ang password?" sub="We'll email you a link to set a new one.">
      {sent ? (
        <div className="flex flex-col gap-3">
          <div role="status" className="rounded-[12px] bg-[#e8f5db] px-4 py-3.5 text-[13px] leading-relaxed text-ink-body">
            If there is an account for <strong>{email}</strong>, a reset link is on its way.
            Check your inbox — and the spam folder — then tap the link to choose a new password.
            <div className="mt-1.5 text-[12px] text-ink-muted">The link works once and expires in an hour.</div>
          </div>
          <button
            onClick={() => { setSent(false); setEmail(''); }}
            className="rounded-[12px] border-[1.5px] border-line bg-white py-3 text-[14px] font-semibold text-ink-body"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input className={inputCls} type="email" name="email" autoComplete="email" placeholder="Email"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
          {error && <div className="rounded-lg bg-[#f6e0e0] px-3 py-2 text-[12.5px] text-[#b23b3b]">{error}</div>}
          <button disabled={busy} className="mt-1 rounded-[12px] bg-brand-green py-3.5 text-[15px] font-bold text-white active:scale-[.99] disabled:opacity-60">
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <div className="mt-4 text-center text-[13px] text-ink-muted">
        <Link href="/login" className="font-bold text-brand-blue">← Back to log in</Link>
      </div>
    </AuthShell>
  );
}
