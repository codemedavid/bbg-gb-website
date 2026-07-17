import { NavLink } from 'react-router-dom';
import { useCart } from '../store/cart';

const TABS = [
  { to: '/', icon: '🏠', label: 'Home' },
  { to: '/kahati', icon: '🤝', label: 'Kahati' },
  { to: '/shop', icon: '🧪', label: 'Shop' },
  { to: '/calc', icon: '🧮', label: 'Calc' },
  { to: '/orders', icon: '📦', label: 'Orders' },
];

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-1/2 z-20 grid w-full max-w-app -translate-x-1/2 grid-cols-5 border-t border-line-mist bg-white pb-4 pt-2">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.to === '/'}
          className={({ isActive }) =>
            `text-center text-[10.5px] font-semibold ${isActive ? 'text-brand-greendark' : 'text-ink-faint'}`}>
          <div className="text-[19px] leading-none mb-0.5">{t.icon}</div>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function CartButton({ onClick, size = 40 }: { onClick: () => void; size?: number }) {
  const count = useCart((s) => s.count());
  return (
    <button onClick={onClick} style={{ width: size, height: size }}
      className="relative flex items-center justify-center rounded-full bg-brand-blue text-white">
      <span className="text-[15px]">🛒</span>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-brand-green px-[5px] py-px text-[10px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}
