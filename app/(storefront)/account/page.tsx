'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SectionHeader } from '@/components/headers';
import { useAuth } from '@/lib/useAuth';
import { apiSend } from '@/lib/api-client';
import { useToast } from '@/lib/store/toast';
import type { User } from '@/lib/types';

const field = 'w-full rounded-[10px] border-[1.5px] border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-brand-green';
const label = 'mb-1 block text-[12px] font-semibold text-ink-body';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[16px] bg-white p-4 shadow-card">
      <h2 className="mb-3 text-[13px] font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function AccountPage() {
  const { user, loading, logout, setUser } = useAuth();
  const router = useRouter();
  const toast = useToast((s) => s.show);

  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    if (user) setForm({ name: user.name, phone: user.phone || '', address: user.address || '' });
  }, [user]);
  useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);

  if (loading || !user) return <><SectionHeader title="👤 My Account" /><div className="p-10 text-center text-ink-muted">Loading…</div></>;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const d = await apiSend<{ user: User }>('/auth/profile', 'PATCH', {
        name: form.name, phone: form.phone || null, address: form.address || null,
      });
      setUser(d.user);
      toast('Profile saved ✓');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save profile');
    } finally { setSavingProfile(false); }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    if (pw.newPassword !== pw.confirm) { setPwError('New passwords do not match.'); return; }
    setPwBusy(true);
    try {
      await apiSend('/auth/password', 'POST', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast('Password changed ✓');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Could not change password');
    } finally { setPwBusy(false); }
  };

  return (
    <>
      <SectionHeader title="👤 My Account" sub="Profile · shipping address · password" />
      <div className="grid grid-cols-1 gap-3.5 p-4 md:grid-cols-2 md:items-start md:p-6">
        <div className="flex items-center gap-3 rounded-[16px] bg-gradient-to-br from-brand-navy to-brand-blue p-4 text-white md:col-span-2">
          <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-white/20 text-[20px] font-bold">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-[17px] font-bold">{user.name}</div>
            <div className="truncate text-[12.5px] opacity-85">{user.email}</div>
          </div>
          {user.role === 'admin' && (
            <button onClick={() => router.push('/admin')} className="ml-auto flex-none rounded-lg bg-white/20 px-3 py-1.5 text-[12px] font-bold">Admin →</button>
          )}
        </div>

        <Card title="Profile">
          <form onSubmit={saveProfile} className="flex flex-col gap-3">
            <div>
              <span className={label}>Full name</span>
              <input className={field} name="name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
            </div>
            <div>
              <span className={label}>Mobile number</span>
              <input className={field} name="phone" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0917 000 0000" />
            </div>
            <div>
              <span className={label}>Email</span>
              <input className={`${field} bg-surface-mist text-ink-muted`} value={user.email} disabled />
            </div>
            <button disabled={savingProfile} className="mt-1 rounded-[12px] bg-brand-green py-3 text-[14px] font-bold text-white active:scale-[.99] disabled:opacity-60">
              {savingProfile ? 'Saving…' : 'Save profile'}
            </button>
          </form>
        </Card>

        <Card title="📦 Shipping address">
          <form onSubmit={saveProfile} className="flex flex-col gap-3">
            <div>
              <span className={label}>Saved delivery address — prefilled at checkout</span>
              <textarea className={`${field} h-[76px] resize-none`} name="address" autoComplete="street-address"
                value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Unit / house no., street, barangay, city" />
            </div>
            <button disabled={savingProfile} className="rounded-[12px] bg-brand-green py-3 text-[14px] font-bold text-white active:scale-[.99] disabled:opacity-60">
              {savingProfile ? 'Saving…' : 'Save shipping address'}
            </button>
          </form>
        </Card>

        <Card title="🔒 Change password">
          <form onSubmit={changePassword} className="flex flex-col gap-3">
            <div>
              <span className={label}>Current password</span>
              <input className={field} type="password" name="currentPassword" autoComplete="current-password"
                value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
            </div>
            <div>
              <span className={label}>New password (min 8 characters)</span>
              <input className={field} type="password" name="newPassword" autoComplete="new-password" minLength={8}
                value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
            </div>
            <div>
              <span className={label}>Confirm new password</span>
              <input className={field} type="password" name="confirmPassword" autoComplete="new-password" minLength={8}
                value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
            </div>
            {pwError && <div className="rounded-lg bg-[#f6e0e0] px-3 py-2 text-[12.5px] text-[#b23b3b]">{pwError}</div>}
            <button disabled={pwBusy} className="rounded-[12px] bg-brand-blue py-3 text-[14px] font-bold text-white active:scale-[.99] disabled:opacity-60">
              {pwBusy ? 'Changing…' : 'Change password'}
            </button>
          </form>
        </Card>

        <button onClick={async () => { await logout(); router.push('/'); }}
          className="rounded-[12px] border-[1.5px] border-line bg-white py-3 text-[14px] font-semibold text-ink-body md:col-span-2">
          ↪ Log out
        </button>
      </div>
    </>
  );
}
