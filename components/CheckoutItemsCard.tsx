'use client';
import { useCart, groupCartByMode } from '@/lib/store/cart';
import { CartEditActions } from '@/components/CartEditActions';
import { php } from '@/lib/format';

// What the customer is about to pay for, itemised, with a way out of each line.
// Checkout used to show totals only: a peptide added by mistake four boards ago
// could only be taken back out by walking to the cart, and nothing on the
// screen said so. Quantities are still the cart's job — this is the "did I add
// the right things" pass, not the "how many" one.
export function CheckoutItemsCard() {
  const items = useCart((s) => s.items);
  const remove = useCart((s) => s.remove);
  const groups = groupCartByMode(items);

  if (!items.length) {
    return (
      <div className="rounded-[14px] bg-white p-4 shadow-card">
        <div className="px-2 py-6 text-center">
          <div className="mb-2 text-3xl" aria-hidden>🛒</div>
          <div className="mb-1 text-[14px] font-bold text-ink-body">Wala nang laman ang cart mo</div>
          <p className="m-0 mb-3.5 text-[12.5px] leading-snug text-ink-muted">
            Add a peptide from a board and come back — your details here are kept.
          </p>
          <CartEditActions addLabel="Add items" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] bg-white p-4 shadow-card">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold text-ink">Your items</h2>
        <span className="text-[11.5px] text-ink-muted">Tap × to remove anything added by mistake</span>
      </div>

      <div className="flex flex-col gap-2.5">
        {groups.map((group) => (
          <section key={group.mode} aria-labelledby={`checkout-group-${group.mode}`}>
            <h3 id={`checkout-group-${group.mode}`}
              className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              {group.label}
            </h3>
            <div className="divide-y divide-line-soft">
              {group.items.map((item) => (
                <div key={item.key} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-bold text-ink">{item.name}</div>
                    <div className="text-[11.5px] text-ink-muted">
                      {item.qty} × {php(item.unitPricePhp)}
                    </div>
                  </div>
                  <strong className="text-[13.5px] text-ink">{php(item.qty * item.unitPricePhp)}</strong>
                  <button type="button" onClick={() => remove(item.key)}
                    aria-label={`Remove ${item.name} from cart`}
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[15px] leading-none text-ink-faint transition-colors hover:bg-[#fdeaea] hover:text-[#a33]">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-3">
        <CartEditActions />
      </div>
    </div>
  );
}
