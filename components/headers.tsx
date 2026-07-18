'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CartButton } from './BottomNav';
import { useAuth } from '@/lib/useAuth';

const Logo = () => (
  <span className="font-display text-[17px] font-bold tracking-tight text-brand-navy">
    BBG<span className="text-brand-green"> Peptides</span>
  </span>
);

// Shows the signed-in user's avatar (-> /account) or a Log in button when signed out.
function AuthControl() {
  const { user, loading } = useAuth();
  if (loading) return <div className="h-9 w-9 rounded-full bg-line-soft" aria-hidden />;
  if (!user) {
    return (
      <Link href="/login" className="rounded-[10px] bg-brand-green px-3.5 py-2 text-[12.5px] font-bold text-white">
        Log in
      </Link>
    );
  }
  return (
    <Link href="/account" aria-label="My account"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-navy text-[13px] font-bold text-white">
      {user.name.charAt(0).toUpperCase()}
    </Link>
  );
}

export function AppHeader({ greeting }: { greeting?: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-brand-green bg-white px-4 py-2.5 md:px-6">
      <Logo />
      <div className="ml-auto flex items-center gap-2">
        {greeting && <span className="hidden text-[13px] font-semibold text-ink-body xs:inline">{greeting}</span>}
        <CartButton />
        <AuthControl />
      </div>
    </header>
  );
}

export function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-brand-green bg-white px-4 py-3.5 md:px-6">
      <div className="min-w-0">
        <div className="font-display text-[18px] font-bold text-ink">{title}</div>
        {sub && <div className="truncate text-[12px] text-ink-muted">{sub}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2"><AuthControl /></div>
    </header>
  );
}

export function BackHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-[5] flex items-center gap-3 border-b border-line-mist bg-white px-4 py-3 md:px-6">
      <button onClick={onBack ?? (() => router.back())} aria-label="Go back"
        className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-[16px] text-ink-body">←</button>
      <span className="text-[15px] font-bold text-ink">{title}</span>
    </header>
  );
}
