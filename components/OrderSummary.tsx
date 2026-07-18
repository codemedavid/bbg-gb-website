'use client';
import { php } from '@/lib/format';
import { useCart, shippingFor, repackFor } from '@/lib/store/cart';

export function useOrderTotals() {
  const items = useCart((s) => s.items);
  const subtotal = useCart((s) => s.subtotal());
  const hasSolo = useCart((s) => s.hasSolo());
  const hasKahati = useCart((s) => s.hasKahati());
  const shipping = shippingFor(hasSolo);
  const repack = repackFor(items);
  return { subtotal, shipping, repack, total: subtotal + shipping + repack, hasSolo, hasKahati };
}

export function OrderSummary() {
  const { subtotal, shipping, repack, total, hasSolo, hasKahati } = useOrderTotals();
  const Row = ({ label, value }: { label: string; value: number }) => (
    <div className="mb-1.5 flex justify-between text-[13px] text-ink-body"><span>{label}</span><span>{php(value)}</span></div>
  );
  return (
    <div>
      <Row label="Subtotal" value={subtotal} />
      {hasSolo && <Row label="Shipping (LBC, PH-wide)" value={shipping} />}
      {hasKahati && <Row label="Kahati repack fee (shipping incl.)" value={repack} />}
      <div className="mt-1 flex justify-between border-t border-line-soft pt-2.5 text-[16px] font-bold text-ink">
        <span>Total</span><span className="font-display">{php(total)}</span>
      </div>
    </div>
  );
}
