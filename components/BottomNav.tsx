'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/store/cart';
import { useMoqPageEnabled } from '@/lib/queries';

// Group Buy earns a tab as its own feature. A seventh would leave ~45px per tab
// at 320px, so Calc gives up its slot — it is still reachable from the Home card
// that already links to it, whereas a group buy has no other entry point.
const TABS = [
  { href: '/', icon: '🏠', label: 'Home' },
  { href: '/kahati', icon: '🤝', label: 'Kahati' },
  { href: '/groupbuy', icon: '🧺', label: 'Group Buy' },
  { href: '/shop', icon: '📦', label: 'On-hand' },
  { href: '/orders', icon: '🧾', label: 'Orders' },
  { href: '/account', icon: '👤', label: 'Account' },
];

// The MOQ tab is conditional, so it is defined apart from the fixed six. Its
// label is deliberately the shortest in the bar: at 320px seven tabs leave only
// ~45px each, and "MOQ" is the one label that still fits comfortably there.
const MOQ_TAB = { href: '/moq', icon: '🏷️', label: 'MOQ' };

export function BottomNav() {
  const pathname = usePathname();
  // Undefined (still loading) is treated as off, so a tab never flashes in and
  // then disappears — and never points at a route that 404s.
  const { data: moqEnabled } = useMoqPageEnabled();
  const tabs = moqEnabled ? [...TABS, MOQ_TAB] : TABS;
  // At 320px six tabs get 53px each and the widest label ("Group Buy", 47px)
  // fits on one line. A seventh drops that to 46px and the label wraps below
  // the bar, so the seven-tab state tightens the type scale. The six-tab bar
  // keeps its original size.
  const labelSize = moqEnabled ? 'text-[9.5px]' : 'text-[10.5px]';
  return (
    <nav className={`fixed bottom-0 left-1/2 z-20 grid w-full max-w-app -translate-x-1/2 border-t border-line-mist bg-white pb-4 pt-2 md:max-w-2xl md:border-x lg:max-w-4xl ${
      moqEnabled ? 'grid-cols-7' : 'grid-cols-6'}`}>
      {tabs.map((t) => {
        const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href}
            className={`text-center font-semibold ${labelSize} ${active ? 'text-brand-greendark' : 'text-ink-faint'}`}>
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
