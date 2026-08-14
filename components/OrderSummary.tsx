'use client';
import { php } from '@/lib/format';
import { useCart, packingFeeFor } from '@/lib/store/cart';
import { useCyclePackingFeePaid, usePackingFees } from '@/lib/queries';
import { PACKING_FEE_PHP } from '@/lib/pricing';

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
  const total = subtotal + packingFee;
  // A hatian collects only the packing fee now — the goods are settled once the
  // hatian ends. The fee is ADDED to the products, never taken out of them, so
  // the balance left to settle is the subtotal in full.
  const dueNow = hasKahati ? packingFee : total;
  const balance = hasKahati ? subtotal : 0;
  return {
    subtotal, packingFee, total, hasOnHand, hasKahati, hasGroupBuy,
    dueNow, balance, paidThisCycle: alreadyPaid,
    // The cycle's fee is already paid, so the fee line reads ₱0 and needs saying
    // out loud — a missing fee otherwise reads as one the customer dodged and
    // will be surprised by later.
    cycleFeeWaived: alreadyPaid && (hasKahati || hasGroupBuy),
  };
}

export function OrderSummary({ paidThisCycle = false }: { paidThisCycle?: boolean } = {}) {
  const { subtotal, packingFee, total, hasKahati, dueNow, balance, cycleFeeWaived } =
    useOrderTotals(paidThisCycle);
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
            <span>{dueNow > 0 ? 'Packing fee due now' : 'Due now'}</span>
            <span className="font-display">{php(dueNow)}</span>
          </div>
          <div className="mt-1 flex justify-between text-[12px] text-ink-body">
            <span>Balance (pay after the kahati ends)</span><span>{php(balance)}</span>
          </div>
        </div>
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
