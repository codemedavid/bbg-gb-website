// What a customer pays TODAY to hold a place in a hatian kit — the rules, with
// no database in sight.
//
// The problem this module exists to solve is a refund problem. A hatian only
// gets ordered once its kit reaches KAHATI_MIN_VIABLE_VIALS; under that, the
// batch is cancelled and every peso collected has to go back. Collecting the
// FULL order price at checkout therefore books a refund liability on every
// commitment, for a kit that may never happen. Collecting a downpayment books a
// small, bounded one instead — which is the whole point.
//
// Three policies, because the business has used two of them and wants the third:
//
//   'packing_fee'  the historical rule — the hatian collects this cycle's
//                  packing fee and nothing else. Kept as the DEFAULT so an
//                  installation that has never configured a downpayment keeps
//                  behaving exactly as it did.
//   'fixed'        a flat peso deposit per kahati order.
//   'percent'      a share of the order total.
//
// The amount is global rather than per payment method on purpose. What the
// customer owes cannot depend on whether they picked GCash or Maya, and two QR
// codes quoting two different downpayments is a support ticket, not a feature.
import { round2 } from './pricing';
import { php } from './format';

export const KAHATI_DOWNPAYMENT_MODES = ['packing_fee', 'fixed', 'percent'] as const;
export type KahatiDownpaymentMode = typeof KAHATI_DOWNPAYMENT_MODES[number];

export type KahatiDownpaymentPolicy = {
  mode: KahatiDownpaymentMode;
  /** Flat peso deposit, read only under mode 'fixed'. */
  amountPhp: number;
  /** Share of the order total (0-100), read only under mode 'percent'. */
  percent: number;
  /**
   * Whether a cancelled kit gives the downpayment back. Refundable is the
   * default because it is what the storefront has always promised
   * (app/(storefront)/kahati/page.tsx) — a non-refundable deposit is a policy
   * change an admin has to make deliberately, not one a migration makes for them.
   */
  refundable: boolean;
  /** The admin's own wording, which overrides the generated notice when set. */
  policyNote: string | null;
};

export const DEFAULT_KAHATI_DOWNPAYMENT_POLICY: KahatiDownpaymentPolicy = {
  mode: 'packing_fee', amountPhp: 0, percent: 0, refundable: true, policyNote: null,
};

/** The order figures a downpayment is computed against. */
export type DownpaymentBasis = { subtotal: number; packingFee: number };

/**
 * What this kahati order collects at checkout.
 *
 * Bounded at both ends. The floor keeps a negative configuration from crediting
 * the customer; the ceiling — the order total — keeps a flat ₱5,000 deposit from
 * over-collecting on a ₱900 order, which would manufacture the refund the whole
 * feature exists to prevent. An unusable figure yields 0 rather than NaN: a
 * checkout that quotes "₱NaN due now" is worse than one that asks for nothing
 * and lets the admin notice.
 */
export function kahatiDownpaymentDue(policy: KahatiDownpaymentPolicy, basis: DownpaymentBasis): number {
  const total = round2(Math.max(0, basis.subtotal) + Math.max(0, basis.packingFee));
  const raw =
    policy.mode === 'fixed' ? policy.amountPhp
    : policy.mode === 'percent' ? (policy.percent / 100) * total
    : basis.packingFee;
  if (!Number.isFinite(raw)) return 0;
  return round2(Math.min(Math.max(raw, 0), total));
}

/**
 * Whether one payment covers every hatian joined in the same trading cycle.
 *
 * True only for the packing fee, and for a concrete reason: the packing fee pays
 * to pack ONE parcel, and ten hatians settled together are one parcel
 * (lib/packing-cycle.ts). A deposit is the opposite — it secures a specific kit,
 * so a second kit needs a second deposit, or the second kit is unsecured.
 */
export function isDownpaymentWaivableByCycle(policy: KahatiDownpaymentPolicy): boolean {
  return policy.mode === 'packing_fee';
}

/** How the configured policy reads in a sentence, for admin and checkout copy. */
export function describeKahatiDownpayment(policy: KahatiDownpaymentPolicy): string {
  if (policy.mode === 'fixed') return `${php(policy.amountPhp)} per kahati order`;
  if (policy.mode === 'percent') return `${policy.percent}% of the order total`;
  return 'the packing fee for the cycle';
}

/**
 * What happens to the downpayment if the kit never fills, or the customer backs
 * out ("ligwak"). The admin's own wording wins where they wrote one, because
 * a real policy has terms this module cannot guess.
 */
export function refundNoticeFor(policy: KahatiDownpaymentPolicy): string {
  if (policy.policyNote && policy.policyNote.trim()) return policy.policyNote.trim();
  return policy.refundable
    ? 'If the kahati is cancelled, your downpayment is refunded in full to the account you paid from.'
    : 'This downpayment is non-refundable once the kahati is confirmed.';
}

/**
 * The same terms, read out AFTER the kit has fallen through.
 *
 * refundNoticeFor is written for the screens where the customer has not
 * committed yet, so its sentences are conditional ("if the kahati is
 * cancelled…") or forward-looking ("…once the kahati is confirmed"). Both read
 * wrongly in the email that announces the cancellation, and the second is
 * false: it names a condition — confirmation — that never happened, and tells a
 * customer their money is gone on the strength of it.
 *
 * policyNote is deliberately not consulted. It is storefront copy, written to
 * be read before the commitment; the refundable flag is the machine-readable
 * fact, and this is the one place the fact has to be stated plainly.
 */
export function cancellationRefundNoticeFor(policy: KahatiDownpaymentPolicy): string {
  return policy.refundable
    ? 'will be refunded to the account you paid from. Please allow 1-3 banking days.'
    : 'is non-refundable under the hatian terms, so it will not be returned. Message us if you think this is a mistake.';
}

/**
 * What to call the amount an order collected at checkout.
 *
 * Read off the ORDER rather than off the current policy, because an order
 * placed last month under the packing-fee rule keeps meaning what it meant then
 * — relabelling it "downpayment" because the setting changed since would make
 * the customer's receipt and their order page disagree. The two are told apart
 * by arithmetic: a collection that is exactly the packing fee IS the packing fee.
 */
export function collectedAmountLabel(collectedPhp: number, packingFeePhp: number): string {
  return Math.abs(collectedPhp - packingFeePhp) < 0.01 ? 'Packing fee paid' : 'Downpayment paid';
}

// ---- Storage shape ---------------------------------------------------------
//
// The policy lives in the `settings` key/value table, so every field arrives as
// a string or not at all. Parsing is separated from reading so it can be tested
// without a database, and so a corrupt row is repaired in exactly one place.
export const KAHATI_DOWNPAYMENT_KEYS = {
  mode: 'kahati_downpayment_mode',
  amount: 'kahati_downpayment_amount',
  percent: 'kahati_downpayment_percent',
  refundable: 'kahati_downpayment_refundable',
  note: 'kahati_downpayment_note',
} as const;

/**
 * Reads stored settings back into a policy, repairing anything unusable.
 *
 * Fails back to the packing fee rather than closed: an unreadable mode must not
 * leave the hatian checkout unable to quote ANY figure, and the packing fee is
 * the rule that predates the setting, so falling back to it is the smallest
 * possible surprise.
 */
export function parseKahatiDownpaymentPolicy(rows: Record<string, string>): KahatiDownpaymentPolicy {
  const num = (key: string, fallback: number): number => {
    const v = rows[key];
    if (v == null || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const rawMode = rows[KAHATI_DOWNPAYMENT_KEYS.mode];
  const mode = (KAHATI_DOWNPAYMENT_MODES as readonly string[]).includes(rawMode ?? '')
    ? (rawMode as KahatiDownpaymentMode)
    : DEFAULT_KAHATI_DOWNPAYMENT_POLICY.mode;
  const note = rows[KAHATI_DOWNPAYMENT_KEYS.note];
  return {
    mode,
    amountPhp: num(KAHATI_DOWNPAYMENT_KEYS.amount, DEFAULT_KAHATI_DOWNPAYMENT_POLICY.amountPhp),
    percent: num(KAHATI_DOWNPAYMENT_KEYS.percent, DEFAULT_KAHATI_DOWNPAYMENT_POLICY.percent),
    // Only the exact string 'false' turns the refund promise off — an absent or
    // corrupt value keeps the promise the storefront already makes.
    refundable: rows[KAHATI_DOWNPAYMENT_KEYS.refundable] !== 'false',
    policyNote: note != null && note.trim() !== '' ? note : null,
  };
}

/** The inverse: a policy as the rows that store it. */
export function serializeKahatiDownpaymentPolicy(p: KahatiDownpaymentPolicy): Record<string, string> {
  return {
    [KAHATI_DOWNPAYMENT_KEYS.mode]: p.mode,
    [KAHATI_DOWNPAYMENT_KEYS.amount]: String(p.amountPhp),
    [KAHATI_DOWNPAYMENT_KEYS.percent]: String(p.percent),
    [KAHATI_DOWNPAYMENT_KEYS.refundable]: String(p.refundable),
    [KAHATI_DOWNPAYMENT_KEYS.note]: p.policyNote ?? '',
  };
}
