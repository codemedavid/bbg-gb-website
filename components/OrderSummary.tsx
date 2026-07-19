'use client';
import { php } from '@/lib/format';
import { useCart, packingFeeFor } from '@/lib/store/cart';
import { useKahatiDownpayment, usePackingFees } from '@/lib/queries';
import { KAHATI_DOWNPAYMENT_PHP, PACKING_FEE_PHP, splitKahatiDownpayment } from '@/lib/pricing';

export function useOrderTotals() {
  const items = useCart((s) => s.items);
  const subtotal = useCart((s) => s.subtotal());
  const hasOnHand = useCart((s) => s.hasOnHand());
  const hasKahati = useCart((s) => s.hasKahati());
  const { data: fees } = usePackingFees();
  const { data: downpaymentSetting } = useKahatiDownpayment();
  const onHandFee = fees?.solo ?? PACKING_FEE_PHP.solo;
  const packingFee = packingFeeFor(items, onHandFee);
  const total = subtotal + packingFee;
  // Kahati carts reserve slots with a downpayment; the balance is settled after
  // the kahati ends. Mirrors the server split at checkout.
  const { downpayment, balance } = hasKahati
    ? splitKahatiDownpayment(total, downpaymentSetting ?? KAHATI_DOWNPAYMENT_PHP)
    : { downpayment: 0, balance: total };
  return { subtotal, packingFee, total, hasOnHand, hasKahati, downpayment, balance };
}

export function OrderSummary() {
  const { subtotal, packingFee, total, hasKahati, downpayment, balance } = useOrderTotals();
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
      {hasKahati && downpayment > 0 && (
        <div className="mt-2.5 rounded-[10px] bg-[#f2f8ec] px-3 py-2.5">
          <div className="flex justify-between text-[13px] font-bold text-brand-greendark">
            <span>Downpayment due now</span><span className="font-display">{php(downpayment)}</span>
          </div>
          <div className="mt-1 flex justify-between text-[12px] text-ink-body">
            <span>Balance (pay after the kahati ends)</span><span>{php(balance)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
