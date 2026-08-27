'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/store/cart';
import { useMoqPageEnabled } from '@/lib/queries';

// Group Buy and Search earn tabs as their own features. Calc gives up its slot
// because it is still reachable from the Home card that already links to it.
const TABS = [
  { href: '/', icon: '🏠', label: 'Home' },
  { href: '/search', icon: '🔎', label: 'Search' },
  { href: '/kahati', icon: '🤝', label: 'Kahati' },
  { href: '/groupbuy', icon: '🧺', label: 'Group Buy' },
  { href: '/shop', icon: '📦', label: 'On-hand' },
  { href: '/orders', icon: '🧾', label: 'Orders' },
  { href: '/account', icon: '👤', label: 'Account' },
];

// The MOQ tab is conditional, so it is defined apart from the fixed seven. Its
// label is deliberately the shortest in the bar: at 320px seven tabs leave only
// ~45px each, and "MOQ" is the one label that still fits comfortably there.
const MOQ_TAB = { href: '/moq', icon: '🏷️', label: 'MOQ' };

// MOQ sits next to On-hand rather than at the end of the bar: both are
// buy-now catalogues, so they read as a pair, and appending it after Account
// would have stranded it past the account tab where nobody looks for it.
const MOQ_AFTER = '/shop';

export function BottomNav() {
  const pathname = usePathname();
  // Undefined (still loading) is treated as off, so a tab never flashes in and
  // then disappears — and never points at a route that 404s.
  const { data: moqEnabled } = useMoqPageEnabled();
  const shopIndex = TABS.findIndex((t) => t.href === MOQ_AFTER);
  const tabs = moqEnabled
    ? [...TABS.slice(0, shopIndex + 1), MOQ_TAB, ...TABS.slice(shopIndex + 1)]
    : TABS;
  // The search tab makes the bar wider than a 320px viewport can fairly divide
  // into fixed columns, especially when MOQ is also enabled. Each tab keeps a
  // stable tap target and the bar scrolls sideways only when it has to.
  const labelSize = tabs.length > 7 ? 'text-[9px]' : 'text-[9.5px]';
  return (
    <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-app -translate-x-1/2 overflow-x-auto border-t border-line-mist bg-white pb-4 pt-2 md:max-w-2xl md:border-x lg:max-w-4xl">
      {tabs.map((t) => {
        const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href}
            className={`min-w-[54px] flex-1 whitespace-nowrap text-center font-semibold ${labelSize} ${active ? 'text-brand-greendark' : 'text-ink-faint'}`}>
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
