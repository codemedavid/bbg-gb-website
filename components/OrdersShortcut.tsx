'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';

// The Orders control that rides beside the cart in the storefront headers.
//
// My Orders gave up its tab when the bottom bar ran out of room at 320px, and
// its only entrance became a card on the Account page — two taps, and only for
// a customer who guesses that "Account" is where a delivery is tracked. Chasing
// an order is the most common reason to open the app at all, so it belongs in
// the header chrome the cart already occupies rather than one screen deeper.
//
// Signed-out visitors get nothing: /orders bounces them to /login, and a
// shortcut to a login wall is a dead end dressed as a feature. Nothing renders
// while auth is still resolving either — showing the link and then yanking it
// away on the first paint is worse than showing it a beat late.
export function OrdersShortcut() {
  const { user, loading } = useAuth();
  if (loading || !user) return null;
  return (
    <Link
      href="/orders"
      aria-label="My orders"
      className="flex flex-none items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-bold text-ink-body transition-colors hover:border-brand-green hover:text-brand-greendark"
    >
      <span aria-hidden className="text-[14px] leading-none">📦</span>
      {/* The word is what makes the shortcut findable — an emoji alone has to
          be decoded. It is dropped below 400px because the cart pill, the
          avatar and this control together leave a board title like "Kahati
          Board" no room; the aria-label carries the meaning either way. */}
      <span aria-hidden className="hidden xs:inline">Orders</span>
    </Link>
  );
}
