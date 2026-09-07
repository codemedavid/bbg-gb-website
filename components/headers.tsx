'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CartButton } from './BottomNav';
import { CartShortcut } from './CartShortcut';
import { OrdersShortcut } from './OrdersShortcut';
import { ChatShortcuts } from './ChatShortcuts';
import { useAuth } from '@/lib/useAuth';

// flex-none + nowrap: the header row is full at 320px, and a shrinkable
// wordmark is the first thing flexbox breaks — "BBG" over "Peptides".
const Logo = () => (
  <span className="flex-none whitespace-nowrap font-display text-[16px] font-bold tracking-tight text-brand-navy xs:text-[17px]">
    BBG<span className="text-brand-green"> Peptides</span>
  </span>
);

// Shows the signed-in user's avatar (-> /account) or a Log in button when signed out.
function AuthControl() {
  const { user, loading } = useAuth();
  if (loading) return <div className="h-8 w-8 rounded-full bg-line-soft xs:h-9 xs:w-9" aria-hidden />;
  if (!user) {
    return (
      <Link href="/login" className="rounded-[10px] bg-brand-green px-3.5 py-2 text-[12.5px] font-bold text-white">
        Log in
      </Link>
    );
  }
  return (
    <Link href="/account" aria-label="My account"
      className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-navy text-[13px] font-bold text-white xs:h-9 xs:w-9">
      {user.name.charAt(0).toUpperCase()}
    </Link>
  );
}

export function AppHeader({ greeting }: { greeting?: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-1.5 border-b-2 border-brand-green bg-white px-2.5 py-2.5 xs:gap-3 xs:px-4 md:px-6">
      <Logo />
      <ChatShortcuts />
      <div className="ml-auto flex items-center gap-1 xs:gap-2">
        {greeting && <span className="hidden text-[13px] font-semibold text-ink-body xs:inline">{greeting}</span>}
        <CartButton />
        <OrdersShortcut />
        <AuthControl />
      </div>
    </header>
  );
}

// Every board tab's header. The cart, Orders and chat shortcuts live here
// rather than on each page, so placing them once covers Kahati, Group Buy, MOQ,
// Search and Account — the customer can open their basket, check on an order
// they already placed, or ask BBG a question, from whichever tab they are
// browsing instead of hunting for the bottom nav.
export function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-1.5 border-b-2 border-brand-green bg-white px-3 py-3.5 xs:gap-3 xs:px-4 md:px-6">
      <div className="min-w-0">
        <div className="truncate font-display text-[15px] font-bold text-ink xs:text-[18px]">{title}</div>
        {sub && <div className="truncate text-[12px] text-ink-muted">{sub}</div>}
      </div>
      <ChatShortcuts />
      <div className="ml-auto flex items-center gap-1 xs:gap-2"><CartShortcut /><OrdersShortcut /><AuthControl /></div>
    </header>
  );
}

// `showHome` adds an explicit escape hatch to the storefront. Checkout is a
// dead end otherwise: it sits outside the bottom nav, so back-to-cart was the
// only way out.
export function BackHeader({ title, onBack, showHome = false }: { title: string; onBack?: () => void; showHome?: boolean }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-[5] flex items-center gap-1.5 border-b border-line-mist bg-white px-3 py-3 xs:gap-3 xs:px-4 md:px-6">
      <button onClick={onBack ?? (() => router.back())} aria-label="Go back"
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-line text-[16px] text-ink-body">←</button>
      <span className="truncate text-[15px] font-bold text-ink">{title}</span>
      <ChatShortcuts />
      {showHome && (
        <Link href="/" aria-label="Go to homepage"
          className="ml-auto flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-[12.5px] font-semibold text-ink-body transition-colors hover:border-brand-green hover:text-brand-greendark">
          <span aria-hidden>🏠</span> Home
        </Link>
      )}
    </header>
  );
}
