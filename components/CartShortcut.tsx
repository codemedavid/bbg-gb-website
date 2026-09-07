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
      className={`flex flex-none items-center gap-1 rounded-full px-2.5 py-1.5 text-[12.5px] font-bold transition-colors xs:gap-1.5 xs:px-3 ${
        count > 0
          ? 'bg-brand-blue text-white hover:bg-brand-navy'
          : 'border border-line bg-white text-ink-body hover:border-brand-green hover:text-brand-greendark'
      }`}
    >
      <span aria-hidden className="text-[14px] leading-none">🛒</span>
      {/* The word goes below 400px, the count never does. The board header now
          also carries the WhatsApp and Viber marks, and at 320px "Cart" and a
          readable board title cannot both fit — same breakpoint, same reason
          the Orders shortcut drops its label. */}
      <span aria-hidden className="hidden xs:inline">Cart </span>
      <span aria-hidden>({count})</span>
    </Link>
  );
}
