import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthShell, inputCls } from '../components/AuthShell';
import { useAuth } from '../hooks/useAuth';

export function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await login(email, password);
      const to = (loc.state as { from?: string })?.from || '/';
      nav(to === '/login' ? '/' : to, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed'); setBusy(false);
    }
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
      <div className="mt-4 text-center text-[13px] text-ink-muted">
        Wala pang account? <Link to="/register" className="font-bold text-brand-blue">Mag-register</Link>
      </div>
      <div className="mt-5 rounded-[10px] border border-line bg-white px-3.5 py-3 text-[12px] text-ink-muted">
        Demo: <strong>ana@example.com</strong> / <strong>password123</strong> · Admin: <strong>admin@bbgpeptides.ph</strong>
      </div>
    </AuthShell>
  );
}
