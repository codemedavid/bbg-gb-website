'use client';
import { BackHeader } from '@/components/headers';
import { useCoaFiles } from '@/lib/queries';
import { shortDate } from '@/lib/format';
import type { PublicCoaFile } from '@/lib/types';

// Every batch's certificate of analysis, in one place a customer can be sent to.
//
// Until this page existed a COA lived on one product's detail screen, behind a
// button that toasted "available on request" whenever the row was empty — so the
// answer to "is this tested?" was a message to the admin. The lab result is the
// evidence the whole group buy runs on; it belongs on a page.
//
// Certificates open at /api/files/… — this site's own path. That is the point of
// the page and not an implementation detail: production stores these in ImageKit,
// and a customer asked to trust a lab result must not be handed a link to a CDN
// host they have never heard of. See lib/file-url.ts.

// A document that is not an image gets its type said out loud rather than an
// <img> that would resolve to a broken-image icon over the one file they came for.
const fileKind = (url: string): string => {
  const ext = url.split('.').pop() ?? '';
  return /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toUpperCase() : 'FILE';
};

function CoaCard({ c }: { c: PublicCoaFile }) {
  // The product name is a second line only when it says something the label does
  // not. An admin who names the certificate after the product — which is the
  // obvious thing to do — should not get that product printed twice.
  const subtitle = c.productName && c.productName !== c.label ? c.productName : null;

  return (
    <li>
      <a
        href={c.fileUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="group flex h-full flex-col overflow-hidden rounded-[16px] bg-white shadow-card transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green active:scale-[.99]"
      >
        {/* Portrait box: a certificate is a sheet of paper, and a fixed ratio
            keeps the grid from reflowing as the scans load. */}
        <div className="relative aspect-[4/5] overflow-hidden bg-surface-mist">
          {c.isImage ? (
            <img
              src={c.fileUrl}
              alt={c.label}
              loading="lazy"
              width={480}
              height={600}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-ink-muted">
              <span className="text-[34px] opacity-50" aria-hidden>📄</span>
              <span className="text-[11px] font-bold tracking-wider">{fileKind(c.fileUrl)}</span>
            </div>
          )}
          {c.batch && (
            <span className="absolute left-2 top-2 rounded-full bg-brand-navy/85 px-2.5 py-1 text-[10.5px] font-bold tracking-wide text-white backdrop-blur-sm">
              Batch {c.batch}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1 p-3.5">
          <span className="font-display text-[15px] font-bold leading-tight text-ink">{c.label}</span>
          {subtitle && <span className="text-[12px] leading-relaxed text-ink-muted">{subtitle}</span>}
          <span className="text-[11.5px] text-ink-muted">{`Uploaded ${shortDate(c.uploadedAt)}`}</span>
          <span className="mt-auto pt-2 text-[12.5px] font-bold text-brand-green">Buksan ang COA →</span>
        </div>
      </a>
    </li>
  );
}

export default function CoaPage() {
  const { data: files = [], isLoading } = useCoaFiles();

  return (
    <>
      <BackHeader title="COA — Lab Results" showHome />
      <div className="flex flex-col gap-3.5 p-4 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-bold leading-tight text-ink">Certificates of Analysis</h1>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              Third-party lab results ng mga batch namin. Pindutin ang certificate para mabuksan — dito lang sa
              BBG site, hindi ka ilalabas sa ibang website.
            </p>
          </div>
          <span className="flex-none rounded-full border border-brand-green bg-[#e8f5db] px-2.5 py-1 text-[9.5px] font-bold tracking-wider text-brand-greendark">
            LAB TESTED
          </span>
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-[13px] text-ink-muted">Loading…</p>
        ) : files.length === 0 ? (
          <p className="rounded-[16px] border-[1.5px] border-dashed border-[#a9c88f] bg-white px-4 py-10 text-center text-[13px] text-ink-muted">
            Wala pang COA na na-upload. Message mo lang kami kung kailangan mo ng lab result ng batch mo.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((c) => <CoaCard key={c.id} c={c} />)}
          </ul>
        )}
      </div>
    </>
  );
}
