import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell, inputCls } from '../components/AuthShell';
import { useAuth } from '../hooks/useAuth';

export function Register() {
  const nav = useNavigate();
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', address: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await register(form);
      nav('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Registration failed'); setBusy(false);
    }
  };

  return (
    <AuthShell title="Create account" sub="Join BBG Peptides — mabilis lang.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={inputCls} name="name" autoComplete="name" placeholder="Full name" value={form.name} onChange={set('name')} required />
        <input className={inputCls} type="email" name="email" autoComplete="email" placeholder="Email" value={form.email} onChange={set('email')} required />
        <input className={inputCls} name="phone" autoComplete="tel" placeholder="Mobile number" value={form.phone} onChange={set('phone')} />
        <input className={inputCls} type="password" name="password" autoComplete="new-password" placeholder="Password (min 8 chars)" value={form.password} onChange={set('password')} required minLength={8} />
        <textarea className={`${inputCls} h-[60px] resize-none`} name="address" autoComplete="street-address" placeholder="Delivery address" value={form.address} onChange={set('address')} />
        {error && <div className="rounded-lg bg-[#f6e0e0] px-3 py-2 text-[12.5px] text-[#b23b3b]">{error}</div>}
        <button disabled={busy} className="mt-1 rounded-[12px] bg-brand-green py-3.5 text-[15px] font-bold text-white active:scale-[.99] disabled:opacity-60">
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <div className="mt-4 text-center text-[13px] text-ink-muted">
        May account na? <Link to="/login" className="font-bold text-brand-blue">Mag-login</Link>
      </div>
    </AuthShell>
  );
}
