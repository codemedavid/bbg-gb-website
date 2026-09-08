'use client';
import Link from 'next/link';
import { BackHeader } from '@/components/headers';
import { useFeedbackFolders } from '@/lib/queries';

// What customers said, filed into folders the admin creates — one per batch,
// per product line, whatever the admin needs.
//
// The folder is the unit, which is why an EMPTY folder still gets a tile. An
// admin who creates "Batch 7 Reviews" the day the batch opens has to be able to
// see it here before anything is in it; a page that hid it until the first
// upload would be a page that disagrees with the screen the admin just used.
export default function FeedbackPage() {
  const { data: folders = [], isLoading } = useFeedbackFolders();

  return (
    <>
      <BackHeader title="Customer Feedback" showHome />
      <div className="flex flex-col gap-3.5 p-4 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-bold leading-tight text-ink">Customer Feedback</h1>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              Totoong mensahe ng mga sumali sa group buy. Buksan ang folder para makita ang lahat.
            </p>
          </div>
          <span className="flex-none rounded-full border border-brand-green bg-[#e8f5db] px-2.5 py-1 text-[9.5px] font-bold tracking-wider text-brand-greendark">
            REAL TALK
          </span>
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-[13px] text-ink-muted">Loading…</p>
        ) : folders.length === 0 ? (
          <p className="rounded-[16px] border-[1.5px] border-dashed border-[#a9c88f] bg-white px-4 py-10 text-center text-[13px] text-ink-muted">
            Wala pang feedback na na-publish. Balik ka na lang mamaya!
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/feedback/${f.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-[16px] bg-white shadow-card transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green active:scale-[.99]"
                >
                  {/* Fixed aspect box, so a folder with no cover yet occupies the
                      same space as one with a tall screenshot in it and the grid
                      does not reflow as covers load. */}
                  <div className="relative aspect-[16/10] overflow-hidden bg-surface-mist">
                    {f.coverUrl ? (
                      <img
                        src={f.coverUrl}
                        alt={f.name}
                        loading="lazy"
                        width={640}
                        height={400}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-[28px] opacity-40" aria-hidden>💬</div>
                    )}
                    <span className="absolute bottom-2 right-2 rounded-full bg-brand-navy/85 px-2.5 py-1 text-[10.5px] font-bold tracking-wide text-white backdrop-blur-sm">
                      {f.itemCount > 0 ? `${f.itemCount} feedbacks` : 'Wala pang feedback'}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3.5">
                    <span className="font-display text-[15px] font-bold leading-tight text-ink">{f.name}</span>
                    {f.description && (
                      <span className="text-[12px] leading-relaxed text-ink-muted">{f.description}</span>
                    )}
                    <span className="mt-auto pt-2 text-[12.5px] font-bold text-brand-green">Tingnan →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
