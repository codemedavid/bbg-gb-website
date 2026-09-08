'use client';
import { use, useState } from 'react';
import { BackHeader } from '@/components/headers';
import { useFeedbackFolder } from '@/lib/queries';
import type { FeedbackItem } from '@/lib/types';

// One folder's screenshots.
//
// Two things about a chat screenshot drive this layout. It is unreadable as a
// tile on a phone, so every one of them opens full-size — that is what the
// dialog below is for, not decoration. And it is heavy: these are unedited
// camera-roll PNGs, so everything lazy-loads at a fixed aspect ratio and only
// the one the customer actually tapped is fetched eagerly.
export default function FeedbackFolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: folder, isLoading, isError } = useFeedbackFolder(id);
  const [open, setOpen] = useState<FeedbackItem | null>(null);

  const items = folder?.items ?? [];

  return (
    <>
      <BackHeader title={folder?.name ?? 'Customer Feedback'} showHome />
      <div className="flex flex-col gap-3.5 p-4 md:p-6">
        {isError ? (
          <p className="rounded-[16px] border-[1.5px] border-dashed border-line bg-white px-4 py-10 text-center text-[13px] text-ink-muted">
            Hindi mahanap ang folder na ito. Baka tinanggal na ito.
          </p>
        ) : isLoading ? (
          <p className="py-10 text-center text-[13px] text-ink-muted">Loading…</p>
        ) : (
          <>
            <div className="min-w-0">
              <h1 className="font-display text-[22px] font-bold leading-tight text-ink">{folder?.name}</h1>
              {folder?.description && (
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{folder.description}</p>
              )}
            </div>

            {items.length === 0 ? (
              <p className="rounded-[16px] border-[1.5px] border-dashed border-[#a9c88f] bg-white px-4 py-10 text-center text-[13px] text-ink-muted">
                Wala pang feedback sa folder na ito.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(item)}
                      // The accessible name is the customer's words, so the
                      // control announces as what it opens rather than as
                      // "button, image".
                      aria-label={item.caption ?? `Feedback mula kay ${item.customerName ?? 'customer'}`}
                      className="flex h-full w-full flex-col overflow-hidden rounded-[14px] bg-white text-left shadow-card transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green active:scale-[.99]"
                    >
                      <div className="aspect-[3/4] overflow-hidden bg-surface-mist">
                        <img
                          src={item.imageUrl}
                          alt={item.caption ?? 'Customer feedback screenshot'}
                          loading="lazy"
                          width={480}
                          height={640}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      {(item.caption || item.customerName) && (
                        <div className="flex flex-col gap-1 p-2.5">
                          {item.caption && (
                            <span className="text-[12.5px] font-semibold leading-snug text-ink">{item.caption}</span>
                          )}
                          {item.customerName && (
                            <span className="text-[11.5px] text-ink-muted">— {item.customerName}</span>
                          )}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={open.caption ?? 'Customer feedback'}
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
        >
          <img
            src={open.imageUrl}
            alt={open.caption ?? 'Customer feedback screenshot'}
            className="max-h-[75vh] w-auto max-w-full rounded-[12px] object-contain"
          />
          {(open.caption || open.customerName) && (
            <div className="max-w-[560px] text-center text-white">
              {open.caption && <p className="text-[14px] font-semibold leading-snug">{open.caption}</p>}
              {open.customerName && <p className="mt-1 text-[12.5px] opacity-80">— {open.customerName}</p>}
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="rounded-full bg-white/15 px-4 py-2 text-[13px] font-semibold text-white backdrop-blur-sm"
          >
            Isara
          </button>
        </div>
      )}
    </>
  );
}
