'use client';
import { php } from '@/lib/format';
import { useCart, packingFeeFor } from '@/lib/store/cart';
import { useCampaignPackingFeeWaivers, useKahatiDownpayment, usePackingFees } from '@/lib/queries';
import { KAHATI_DOWNPAYMENT_PHP, PACKING_FEE_PHP, splitKahatiDownpayment } from '@/lib/pricing';

// `downpaymentWaived` says this customer already holds a live kahati
// commitment, so their reservation deposit is paid and this one owes none. It
// is passed in rather than fetched here because the server decides it — see
// lib/kahati-commitment.ts and GET /api/kahati/commitments.
export function useOrderTotals(downpaymentWaived = false) {
  const items = useCart((s) => s.items);
  const subtotal = useCart((s) => s.subtotal());
  const hasOnHand = useCart((s) => s.hasOnHand());
  const hasKahati = useCart((s) => s.hasKahati());
  const hasGroupBuy = useCart((s) => s.hasGroupBuy());
  const { data: fees } = usePackingFees();
  const { data: downpaymentSetting } = useKahatiDownpayment();
  // Only asked for when the cart actually holds a group buy — there is nothing
  // to waive otherwise, and an anonymous browse should not poll for it.
  const { data: paidSeriesIds } = useCampaignPackingFeeWaivers(hasGroupBuy);
  // Every mode's fee comes from the admin settings; PACKING_FEE_PHP is only the
  // pre-fetch fallback so the summary never flashes a wrong number.
  const packingFee = packingFeeFor(items, fees ?? PACKING_FEE_PHP, paidSeriesIds);
  const total = subtotal + packingFee;
  // Kahati carts reserve slots with a downpayment; the balance is settled after
  // the kahati ends. Mirrors the server split at checkout.
  const { downpayment, balance } = hasKahati && !downpaymentWaived
    ? splitKahatiDownpayment(total, downpaymentSetting ?? KAHATI_DOWNPAYMENT_PHP)
    : { downpayment: 0, balance: total };
  return {
    subtotal, packingFee, total, hasOnHand, hasKahati, hasGroupBuy,
    downpayment, balance, downpaymentWaived,
    // The cart holds a group buy whose parcel is already paid for, so the fee
    // line reads ₱0 and needs saying out loud — a missing fee otherwise reads
    // as one the customer dodged and will be surprised by later.
    groupBuyFeeWaived: hasGroupBuy && items.some((i) => i.kind === 'moq_campaign' && i.seriesId && paidSeriesIds?.has(i.seriesId)),
  };
}

export function OrderSummary({ downpaymentWaived = false }: { downpaymentWaived?: boolean } = {}) {
  const { subtotal, packingFee, total, hasKahati, downpayment, balance, groupBuyFeeWaived } =
    useOrderTotals(downpaymentWaived);
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
      {hasKahati && downpaymentWaived && (
        // Their deposit is already held against an ongoing hatian, so this
        // commitment collects nothing. Say so plainly — a total with no
        // "due now" line beneath it otherwise reads as the amount to send.
        <div className="mt-2.5 rounded-[10px] bg-[#f2f8ec] px-3 py-2.5">
          <div className="flex justify-between text-[13px] font-bold text-brand-greendark">
            <span>Due now</span><span className="font-display">{php(0)}</span>
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-body">
            May ongoing kahati ka na — walang bagong downpayment. Babayaran ang buo sa huling checkout.
          </div>
        </div>
      )}
      {hasKahati && !downpaymentWaived && downpayment > 0 && (
        <div className="mt-2.5 rounded-[10px] bg-[#f2f8ec] px-3 py-2.5">
          <div className="flex justify-between text-[13px] font-bold text-brand-greendark">
            <span>Downpayment due now</span><span className="font-display">{php(downpayment)}</span>
          </div>
          <div className="mt-1 flex justify-between text-[12px] text-ink-body">
            <span>Balance (pay after the kahati ends)</span><span>{php(balance)}</span>
          </div>
        </div>
      )}
      {groupBuyFeeWaived && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
          📦 May order ka nang naka-antay sa group buy na ito, kaya bayad na ang
          packing fee — walang bagong singil sa checkout na ito.
        </p>
      )}
      {hasKahati && (
        // The hatian packing fee is deferred, so the summary above shows none for
        // it. Say why, or the customer reads a missing fee as a fee they dodged
        // and is surprised by it at the final checkout.
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
          📦 Walang packing fee sa pag-join ng hatian. Isang packing fee lang ang
          singil sa huling checkout, kahit ilang hatian pa ang sinalihan mo.
        </p>
      )}
    </div>
  );
}
