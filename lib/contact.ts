// The one phone number BBG answers on. WhatsApp and Viber ring the same
// handset, so both links are derived from it here rather than pasted into
// markup twice and drifting apart the next time the number changes.
export const SUPPORT_PHONE = '+63 991 446 2762';

const digits = (phone: string): string => phone.replace(/\D/g, '');

// The two apps disagree about the "+". wa.me takes bare digits — an escaped
// plus gives the customer a "phone number shared via url is invalid" page.
// Viber matches on the E.164 form, and without the country code it opens a
// chat with whoever holds that number locally.
export const whatsappUrl = (phone: string = SUPPORT_PHONE): string =>
  `https://wa.me/${digits(phone)}`;

export const viberUrl = (phone: string = SUPPORT_PHONE): string =>
  `viber://chat?number=%2B${digits(phone)}`;

// The BBG WhatsApp community invite. Separate from SUPPORT_PHONE above: that
// number opens a one-to-one thread with BBG, this is the broadcast room where
// a new batch, a restock and a cut-off get announced once to everybody. The
// code is issued by WhatsApp and is not derived from the phone number, so it
// is a literal rather than something built from `digits()`.
export const WHATSAPP_COMMUNITY_URL = 'https://chat.whatsapp.com/E7axKQSGT67GmDSdlqpygy';

// The WhatsApp brand mark's green, not the BBG palette's. Anything rendered in
// brand-green reads as one more site control; this is the colour that says "the
// app already on your phone". Shared so the header badge and the home-page
// community card cannot drift apart.
export const WHATSAPP_GREEN = '#25D366';
