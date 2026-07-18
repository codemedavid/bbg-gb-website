'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/store/cart';

const TABS = [
  { href: '/', icon: '🏠', label: 'Home' },
  { href: '/kahati', icon: '🤝', label: 'Kahati' },
  { href: '/shop', icon: '🧪', label: 'Shop' },
  { href: '/calc', icon: '🧮', label: 'Calc' },
  { href: '/orders', icon: '📦', label: 'Orders' },
  { href: '/account', icon: '👤', label: 'Account' },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-1/2 z-20 grid w-full max-w-app -translate-x-1/2 grid-cols-6 border-t border-line-mist bg-white pb-4 pt-2 md:max-w-2xl md:border-x lg:max-w-4xl">
      {TABS.map((t) => {
        const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href}
            className={`text-center text-[10.5px] font-semibold ${active ? 'text-brand-greendark' : 'text-ink-faint'}`}>
            <div className="mb-0.5 text-[19px] leading-none">{t.icon}</div>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function CartButton({ size = 40 }: { size?: number }) {
  const count = useCart((s) => s.count());
  return (
    <Link href="/cart" style={{ width: size, height: size }}
      className="relative flex items-center justify-center rounded-full bg-brand-blue text-white">
      <span className="text-[15px]">🛒</span>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-brand-green px-[5px] py-px text-[10px] font-bold text-white">{count}</span>
      )}
    </Link>
  );
}
