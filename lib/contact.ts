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
