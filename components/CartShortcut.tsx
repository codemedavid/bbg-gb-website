'use client';
import Link from 'next/link';
import { useCart } from '@/lib/store/cart';

// The labelled cart control the board headers carry.
//
// Distinct from CartButton (components/BottomNav.tsx), which is the compact
// icon-with-badge the home and shop headers use where space is tight. A board
// header has room for the word, and the word is what makes the shortcut
// findable: a customer who has just added a vial on the Kahati tab needs to see
// where their basket went, not decode an emoji.
export function CartShortcut() {
  const count = useCart((s) => s.count());
  return (
    <Link
      href="/cart"
      aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}
      className={`flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
        count > 0
          ? 'bg-brand-blue text-white hover:bg-brand-navy'
          : 'border border-line bg-white text-ink-body hover:border-brand-green hover:text-brand-greendark'
      }`}
    >
      <span aria-hidden className="text-[14px] leading-none">🛒</span>
      <span aria-hidden>Cart ({count})</span>
    </Link>
  );
}
