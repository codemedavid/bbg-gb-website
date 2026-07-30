'use client';
// Admin → Group Buy.
//
// The section's front door. It exists so the workflow the client described has
// a home of its own rather than a nav entry sitting between Hatian and the
// product shelves — everything a group buy needs is reached from here.
import Link from 'next/link';
import { Breadcrumb } from './Breadcrumb';

const AREAS = [
  {
    href: '/admin/group-buy/campaigns',
    icon: '🎯',
    title: 'Campaigns',
    blurb: 'Open a batch, set its price and deadline, then approve, extend or cancel it.',
  },
];

export default function AdminGroupBuyPage() {
  return (
    <div className="pb-10">
      <Breadcrumb trail={[{ label: 'Admin', href: '/admin' }, { label: 'Group Buy' }]} />

      <h1 className="m-0 font-display text-[24px] font-bold">Group Buy</h1>
      <p className="mt-1 text-[13px] text-ink-muted">Minimum-order-quantity batches, kept separate from Hatian and the product shelves.</p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {AREAS.map((a) => (
          <Link key={a.href} href={a.href}
            className="rounded-[16px] bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="text-3xl">{a.icon}</div>
            <div className="mt-2 font-display text-[18px] font-bold text-brand-navy">{a.title}</div>
            <p className="mt-1 text-[13px] text-ink-muted">{a.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
