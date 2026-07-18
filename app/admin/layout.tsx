'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import { AdminLogin } from './AdminLogin';

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: '📊', exact: true },
  { href: '/admin/orders', label: 'Orders', icon: '📦' },
  { href: '/admin/products', label: 'Products', icon: '🧪' },
  { href: '/admin/groupbuys', label: 'Group Buys', icon: '🤝' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (loading) return <div className="p-10 text-ink-muted">Loading…</div>;
  // No admin session yet: gate the admin UI behind a dedicated admin sign-in
  // instead of bouncing to the customer login.
  if (!user || user.role !== 'admin') return <AdminLogin signedInEmail={user?.email} />;

  const isActive = (n: (typeof NAV)[number]) => (n.exact ? pathname === n.href : pathname.startsWith(n.href));

  return (
    <div className="min-h-screen bg-[#eef1ec] text-ink">
      <div className="mx-auto flex max-w-[1200px] gap-6 p-4 md:p-6">
        <aside className="hidden w-56 flex-none md:block">
          <div className="sticky top-6">
            <div className="mb-6 font-display text-[20px] font-bold text-brand-navy">BBG<span className="text-brand-green"> Admin</span></div>
            <nav className="flex flex-col gap-1">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href}
                  className={`flex items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-[14px] font-semibold ${isActive(n) ? 'bg-brand-navy text-white' : 'text-ink-body hover:bg-white'}`}>
                  <span>{n.icon}</span>{n.label}
                </Link>
              ))}
            </nav>
            <button onClick={() => { logout(); router.push('/login'); }} className="mt-6 rounded-[10px] px-3.5 py-2.5 text-[13px] font-semibold text-ink-muted hover:bg-white">↪ Log out</button>
          </div>
        </aside>

        <div className="fixed inset-x-0 top-0 z-20 flex gap-1 overflow-x-auto bg-white px-3 py-2 shadow-sm md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold ${isActive(n) ? 'bg-brand-navy text-white' : 'text-ink-body'}`}>
              {n.icon} {n.label}
            </Link>
          ))}
        </div>

        <main className="min-w-0 flex-1 pt-12 md:pt-0">{children}</main>
      </div>
    </div>
  );
}
