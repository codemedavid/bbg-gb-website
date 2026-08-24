// What a payment method is for. Pure, and deliberately its own module so client
// components can import it without dragging in the storage/signing code that
// lib/payment-methods.ts needs.
//
// Two purposes, because a hatian downpayment and a full payment are different
// obligations for different amounts. Keeping them apart at the DATA level is
// what makes "the regular QR must not appear while the kit is incomplete"
// enforceable rather than a rule the checkout has to remember: a downpayment
// screen renders the downpayment set, and there is no full-payment row in it.
export const PAYMENT_PURPOSES = ['full', 'kahati_downpayment'] as const;
export type PaymentPurpose = typeof PAYMENT_PURPOSES[number];

export const DEFAULT_PAYMENT_PURPOSE: PaymentPurpose = 'full';

// Rows written before this column existed carry no purpose, and every one of
// them is a full-payment method — that was the only kind there was. An
// unrecognised value reads the same way rather than throwing: a typo in the
// database must not take the checkout's payment card down.
export function asPaymentPurpose(value: string | null | undefined): PaymentPurpose {
  return (PAYMENT_PURPOSES as readonly string[]).includes(value ?? '')
    ? (value as PaymentPurpose)
    : DEFAULT_PAYMENT_PURPOSE;
}

export const PAYMENT_PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  full: 'Full payment',
  kahati_downpayment: 'Kahati downpayment',
};
