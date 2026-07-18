'use client';
import { php } from '@/lib/format';
import { useCart, packingFeeFor } from '@/lib/store/cart';
import { usePackingFees } from '@/lib/queries';
import { PACKING_FEE_PHP } from '@/lib/pricing';

export function useOrderTotals() {
  const items = useCart((s) => s.items);
  const subtotal = useCart((s) => s.subtotal());
  const hasSolo = useCart((s) => s.hasSolo());
  const hasKahati = useCart((s) => s.hasKahati());
  const { data: fees } = usePackingFees();
  const soloFee = fees?.solo ?? PACKING_FEE_PHP.solo;
  const packingFee = packingFeeFor(items, soloFee);
  return { subtotal, packingFee, total: subtotal + packingFee, hasSolo, hasKahati };
}

export function OrderSummary() {
  const { subtotal, packingFee, total } = useOrderTotals();
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
    </div>
  );
}
