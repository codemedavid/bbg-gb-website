import { WHATSAPP_COMMUNITY_URL, WHATSAPP_GREEN } from '@/lib/contact';

// The home page's invitation into the WhatsApp community.
//
// The invite is offered twice in the one card, and that is the point. Almost
// everyone who reaches bbgph.org is holding a phone, and a QR on the screen of
// the device you would have to scan it WITH is useless — so the card itself is
// the link, and the QR is there for the desktop visitor and for the customer
// showing a friend. Same URL either way.
//
// Plain <a>, not next/link, for the same reason ChatShortcuts uses one:
// chat.whatsapp.com hands off to the WhatsApp app and leaves the site, which
// is not a navigation the router should try to own.
export function CommunityCard() {
  return (
    <a
      href={WHATSAPP_COMMUNITY_URL}
      target="_blank"
      rel="noreferrer noopener"
      className="group mt-2.5 block rounded-[16px] border-[1.5px] border-line bg-white p-3.5 transition-colors duration-150
                 hover:border-[#9fe3bb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1"
    >
      <div className="mb-2.5 text-[11px] font-bold tracking-wider" style={{ color: WHATSAPP_GREEN }}>
        💬 BBG COMMUNITY
      </div>

      <div className="flex items-center gap-3.5">
        {/* The plate is white and padded because a QR needs its quiet zone to
            scan; the border is what separates that white from the card's. */}
        <div className="flex-none rounded-[10px] border border-line-soft bg-white p-1.5">
          <img
            src="/whatsapp-community-qr.png"
            alt="BBG WhatsApp community QR code"
            width={96}
            height={96}
            loading="lazy"
            decoding="async"
            className="block h-24 w-24 xs:h-[104px] xs:w-[104px]"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-bold leading-tight text-ink xs:text-[16px]">
            Sali sa WhatsApp community
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            Updates, restock at bagong hatian — dito muna ini-anunsyo.
          </div>
          <div
            className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold"
            style={{ color: WHATSAPP_GREEN }}
          >
            Open WhatsApp
            {/* Moves on hover rather than the whole card: the arrow is the part
                that means "this leaves the page". */}
            <span className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
          </div>
        </div>
      </div>

      <div className="mt-2.5 text-[11px] text-ink-faint">I-scan ang QR mula sa ibang phone.</div>
    </a>
  );
}
