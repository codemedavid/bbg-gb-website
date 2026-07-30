'use client';
// The section's trail: Admin → Group Buy → Campaigns → Create Campaign.
//
// The client described the workflow as a path, so the screens show it as one.
// The last crumb is where you are and is not a link.
import Link from 'next/link';

export type Crumb = { label: string; href?: string };

export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-muted">
        {trail.map((c, i) => (
          <li key={c.label} className="flex items-center gap-1.5">
            {c.href ? (
              <Link href={c.href} className="font-semibold text-brand-blue hover:underline">{c.label}</Link>
            ) : (
              <span aria-current="page" className="font-semibold text-ink-body">{c.label}</span>
            )}
            {i < trail.length - 1 && <span aria-hidden="true">›</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
