import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Dashboard } from './Dashboard';
import { AdminProducts } from './AdminProducts';
import { AdminGroupBuys } from './AdminGroupBuys';
import { AdminOrders } from './AdminOrders';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: '📊', end: true },
  { to: '/admin/orders', label: 'Orders', icon: '📦' },
  { to: '/admin/products', label: 'Products', icon: '🧪' },
  { to: '/admin/groupbuys', label: 'Group Buys', icon: '🤝' },
];

export function AdminApp() {
  const { user, loading, logout } = useAuth();
  const nav = useNavigate();
  if (loading) return <div className="p-10 text-ink-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-[#eef1ec] text-ink">
      <div className="mx-auto flex max-w-[1200px] gap-6 p-4 md:p-6">
        <aside className="hidden w-56 flex-none md:block">
          <div className="sticky top-6">
            <div className="mb-6 font-display text-[20px] font-bold text-brand-navy">BBG<span className="text-brand-green"> Admin</span></div>
            <nav className="flex flex-col gap-1">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end}
                  className={({ isActive }) => `flex items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-[14px] font-semibold ${isActive ? 'bg-brand-navy text-white' : 'text-ink-body hover:bg-white'}`}>
                  <span>{n.icon}</span>{n.label}
                </NavLink>
              ))}
            </nav>
            <button onClick={() => { logout(); nav('/login'); }} className="mt-6 rounded-[10px] px-3.5 py-2.5 text-[13px] font-semibold text-ink-muted hover:bg-white">↪ Log out</button>
          </div>
        </aside>

        {/* mobile top nav */}
        <div className="fixed inset-x-0 top-0 z-20 flex gap-1 overflow-x-auto bg-white px-3 py-2 shadow-sm md:hidden">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold ${isActive ? 'bg-brand-navy text-white' : 'text-ink-body'}`}>
              {n.icon} {n.label}
            </NavLink>
          ))}
        </div>

        <main className="min-w-0 flex-1 pt-12 md:pt-0">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="products" element={<AdminProducts />} />
            <Route path="groupbuys" element={<AdminGroupBuys />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
