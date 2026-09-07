import { SUPPORT_PHONE, viberUrl, whatsappUrl } from '@/lib/contact';

// Brand marks, not the app palette: a WhatsApp button in BBG green would read
// as one more site control, and the whole point is that it is recognisable at
// a glance as the app the customer already has open on their phone.
const WHATSAPP_GREEN = '#25D366';
const VIBER_PURPLE = '#7360F2';

// 28px below 400px, 32px above: at 320 the wordmark, both marks, the cart, the
// Orders pill and the avatar are competing for the same row, and the wordmark
// is what gives — it wrapped to two lines and doubled the height of the header.
const badge =
  'flex h-7 w-7 flex-none items-center justify-center rounded-full text-white shadow-[0_1px_3px_rgba(20,40,20,.18)] xs:h-8 xs:w-8 ' +
  'transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1';

const WhatsAppMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="h-[15px] w-[15px] xs:h-[17px] xs:w-[17px]" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413" />
  </svg>
);

// Drawn rather than traced: a bubble with a handset in it, which is what the
// Viber mark reads as at 17px. The purple is what actually identifies it.
const ViberMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="h-[15px] w-[15px] xs:h-[17px] xs:w-[17px]">
    <path
      d="M12 2.6c-5 0-8.6 3.3-8.6 7.6 0 2.4 1.1 4.5 3 5.9v3.9c0 .4.4.6.7.4l3.3-2.1c.5.1 1.1.1 1.6.1 5 0 8.6-3.3 8.6-7.6S17 2.6 12 2.6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path
      d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
      fill="currentColor"
      transform="translate(6.9 3.5) scale(0.42)"
    />
  </svg>
);

// The two chat apps BBG actually runs the kahati on, sitting beside the
// wordmark on the storefront header.
//
// Every question a customer has — is this batch still open, did my proof land,
// can I pasalo my slot — arrives in a WhatsApp or Viber thread, and the number
// was only ever handed out inside those threads. Someone who finds bbgph.org
// cold had no way to start one. Plain <a>, not next/link: wa.me leaves the app
// and viber:// is a protocol handoff to the phone, neither of which the router
// should try to own.
export function ChatShortcuts() {
  return (
    <div className="flex flex-none items-center gap-1 xs:gap-1.5">
      <a
        href={whatsappUrl()}
        target="_blank"
        rel="noreferrer noopener"
        title={`WhatsApp ${SUPPORT_PHONE}`}
        aria-label={`Chat with BBG on WhatsApp, ${SUPPORT_PHONE}`}
        className={badge}
        style={{ backgroundColor: WHATSAPP_GREEN }}
      >
        <WhatsAppMark />
      </a>
      <a
        href={viberUrl()}
        title={`Viber ${SUPPORT_PHONE}`}
        aria-label={`Chat with BBG on Viber, ${SUPPORT_PHONE}`}
        className={badge}
        style={{ backgroundColor: VIBER_PURPLE }}
      >
        <ViberMark />
      </a>
    </div>
  );
}
