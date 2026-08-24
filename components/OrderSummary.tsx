'use client';
import { php } from '@/lib/format';
import { useCart, packingFeeFor, CART_KIND_MODE } from '@/lib/store/cart';
import { chargeCycleFeeOnce } from '@/lib/packing-cycle';
import { useCyclePackingFeePaid, useKahatiDownpaymentPolicy, usePackingFees } from '@/lib/queries';
import { PACKING_FEE_PHP, round2 } from '@/lib/pricing';
import {
  DEFAULT_KAHATI_DOWNPAYMENT_POLICY, describeKahatiDownpayment,
  isDownpaymentWaivableByCycle, kahatiDownpaymentDue,
} from '@/lib/kahati-downpayment';

// `paidThisCycle` says this customer has already paid to have this cycle's
// parcel packed, so this checkout owes no further packing fee. It is passed in
// rather than fetched here because the server decides it — see
// lib/packing-cycle.ts and GET /api/kahati/commitments.
export function useOrderTotals(paidThisCycle = false) {
  const items = useCart((s) => s.items);
  const subtotal = useCart((s) => s.subtotal());
  const hasOnHand = useCart((s) => s.hasOnHand());
  const hasKahati = useCart((s) => s.hasKahati());
  const hasGroupBuy = useCart((s) => s.hasGroupBuy());
  const { data: fees } = usePackingFees();
  // Only asked for when the cart actually holds a line the cycle covers — there
  // is nothing to waive otherwise, and an anonymous browse should not poll.
  const { data: fetchedPaid } = useCyclePackingFeePaid(hasKahati || hasGroupBuy);
  const alreadyPaid = paidThisCycle || !!fetchedPaid;
  // Every mode's fee comes from the admin settings; PACKING_FEE_PHP is only the
  // pre-fetch fallback so the summary never flashes a wrong number.
  const packingFee = packingFeeFor(items, fees ?? PACKING_FEE_PHP, alreadyPaid);
  const total = round2(subtotal + packingFee);

  // A hatian collects a DEPOSIT now — the goods are settled once the kit
  // completes — and the deposit is whatever the admin configured. Quoted here
  // against the hatian portion of the cart ALONE, because that is what the
  // server prices: a mixed cart becomes one order per mode (lib/order-modes.ts),
  // and a deposit computed over on-hand items too would quote a figure no order
  // ever carries.
  const { data: policy, isSuccess: policyLoaded } = useKahatiDownpaymentPolicy();
  const downpaymentPolicy = policy ?? DEFAULT_KAHATI_DOWNPAYMENT_POLICY;
  //
  // The hatian segment's PACKING FEE cannot be computed from the hatian lines
  // alone. One cycle fee covers both boards, and chargeCycleFeeOnce keeps it on
  // the DEAREST cycle line — so a cart holding a ₱150 hatian and a ₱300 Group
  // Buy leaves the hatian order carrying no fee at all. Pricing the hatian lines
  // in isolation would give them a ₱150 fee the server never charges, and quote
  // a deposit against a total no order has. So the cart is charged the way the
  // server charges it FIRST, then segmented.
  const resolvedFees = fees ?? PACKING_FEE_PHP;
  const charged = chargeCycleFeeOnce(
    // Each line's fee resolved the way the server resolves it, because
    // chargeCycleFeeOnce compares fees to pick the dearest and reads an absent
    // one as zero — which would hand the fee to the wrong line.
    items.map((i) => ({ ...i, packingFeePhp: i.packingFeePhp ?? resolvedFees[CART_KIND_MODE[i.kind]] })),
    alreadyPaid,
  );
  const kahatiItems = charged.filter((i) => i.kind === 'group_buy');
  const kahatiSubtotal = round2(kahatiItems.reduce((sum, i) => sum + i.unitPricePhp * i.qty, 0));
  // `false`: chargeCycleFeeOnce has already applied the waiver, and passing it
  // again would be a second, invisible application of the same rule.
  const kahatiPackingFee = packingFeeFor(kahatiItems, resolvedFees, false);
  const kahatiTotal = round2(kahatiSubtotal + kahatiPackingFee);
  const downpayment = hasKahati
    ? kahatiDownpaymentDue(downpaymentPolicy, { subtotal: kahatiSubtotal, packingFee: kahatiPackingFee })
    : 0;

  // Everything that is NOT a hatian line is paid in full today. Splitting it out
  // this way keeps a mixed cart honest: "due now" is the deposit on the hatian
  // orders plus the whole price of the others, never one at the expense of the
  // other.
  const dueOnOtherModes = round2(Math.max(0, total - kahatiTotal));
  const dueNow = round2(downpayment + dueOnOtherModes);
  // What the hatian orders still owe once their kits complete. The deposit is
  // deducted here and nowhere else — the order total already includes it.
  const balance = hasKahati ? round2(Math.max(0, kahatiTotal - downpayment)) : 0;
  return {
    subtotal, packingFee, total, hasOnHand, hasKahati, hasGroupBuy,
    dueNow, balance, paidThisCycle: alreadyPaid,
    // The non-hatian half of `dueNow`, kept separate so a caller can tell a
    // deposit apart from the full price of everything else in the same figure.
    dueOnOtherModes,
    // The deposit due on the hatian portion, and how the policy reads in words.
    // Both are what the checkout's downpayment card renders.
    downpayment, downpaymentPolicy,
    downpaymentLabel: describeKahatiDownpayment(downpaymentPolicy),
    // Whether the policy above is the CONFIGURED one or the fallback standing in
    // for a request that has not landed. The two are indistinguishable from the
    // policy object alone, and the difference decides whether a screen may skip
    // asking for payment — so it is reported rather than inferred.
    downpaymentPolicyLoaded: policyLoaded,
    // A configured deposit is not a per-cycle parcel charge, so "you already
    // paid this cycle" does not silence it.
    downpaymentIsDeposit: !isDownpaymentWaivableByCycle(downpaymentPolicy),
    // The cycle's fee is already paid, so the fee line reads ₱0 and needs saying
    // out loud — a missing fee otherwise reads as one the customer dodged and
    // will be surprised by later.
    cycleFeeWaived: alreadyPaid && (hasKahati || hasGroupBuy),
  };
}

export function OrderSummary({ paidThisCycle = false }: { paidThisCycle?: boolean } = {}) {
  const { subtotal, packingFee, total, hasKahati, dueNow, dueOnOtherModes, balance, cycleFeeWaived, downpaymentIsDeposit } =
    useOrderTotals(paidThisCycle);
  // "Downpayment due now" names the whole figure, so it may only be used when
  // the whole figure IS the deposit. On a mixed cart `dueNow` is the deposit
  // PLUS the full price of every on-hand line, and calling that a downpayment
  // invites the customer to read the lot as refundable.
  const dueNowLabel = dueNow <= 0 ? 'Due now'
    : !downpaymentIsDeposit ? 'Packing fee due now'
    : dueOnOtherModes > 0 ? 'Due now'
    : 'Downpayment due now';
  const Row = ({ label, value }: { label: string; value: number }) => (
    <div className="mb-1.5 flex justify-between text-[13px] text-ink-body"><span>{label}</span><span>{php(value)}</span></div>
  );
  return (
    <div>
      <Row label="Subtotal" value={subtotal} />
      {packingFee > 0 && <Row label="Packing fee (local shipping incl.)" value={packingFee} />}
      <div className="mt-1 flex justify-between border-t border-line-soft pt-2.5 text-[16px] font-bold text-ink">
        <span>Total</span><span className="font-display">{php(total)}</span>
      </div>
      {hasKahati && (
        // What leaves their pocket today versus what is left to settle. Stated
        // explicitly because a hatian total with no "due now" beneath it reads
        // as the amount to send.
        <div className="mt-2.5 rounded-[10px] bg-[#f2f8ec] px-3 py-2.5">
          <div className="flex justify-between text-[13px] font-bold text-brand-greendark">
            <span>{dueNowLabel}</span>
            <span className="font-display">{php(dueNow)}</span>
          </div>
          <div className="mt-1 flex justify-between text-[12px] text-ink-body">
            <span>Balance (pay after the kahati ends)</span><span>{php(balance)}</span>
          </div>
        </div>
      )}
      {hasKahati && downpaymentIsDeposit && (
        // Says out loud what the deposit is FOR. Without it the customer reads a
        // number smaller than the total as a discount, and the balance notice
        // above as a second charge they did not agree to.
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
          🔒 Downpayment lang muna ang bayad ngayon para ma-secure ang slot mo. Ang
          natitirang balance ay sisingilin lang kapag kumpleto na ang kahati kit.
        </p>
      )}
      {cycleFeeWaived && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
          📦 Bayad na ang packing fee mo ngayong Group Buy/Hatian — walang bagong
          singil sa checkout na ito.
        </p>
      )}
      {hasKahati && !cycleFeeWaived && (
        // One fee covers everything they join this cycle. Say so, or the
        // customer reads the fee on this order as one they will pay again on
        // the next hatian they join this week.
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
          📦 Isang packing fee lang bawat Group Buy/Hatian — kahit ilang hatian pa
          ang salihan mo ngayong linggo, hindi na ito uulitin.
        </p>
      )}
    </div>
  );
}
