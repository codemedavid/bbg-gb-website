'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OverlayShell } from '@/components/OverlayShell';
import { BackHeader } from '@/components/headers';
import { OrderSummary } from '@/components/OrderSummary';
import { CartEditActions } from '@/components/CartEditActions';
import { useCart, groupCartByMode, maxQtyFor, type CartGroup, type CartItem } from '@/lib/store/cart';
import { php } from '@/lib/format';
import { VIALS_PER_KIT } from '@/lib/pricing';
import type { PackingMode } from '@/lib/pricing';

// What each section is, in one line. The cart is where a customer reconciles
// "I clicked around four different boards" with "what am I actually buying", so
// each group says what happens to it — the lifecycles genuinely differ and a
// customer who expects their hatian vial to ship tomorrow has been misled.
const MODE_BLURB: Record<PackingMode, string> = {
  solo: 'Ready stock — ships within 24h.',
  kahati: 'Shared kits — you pay a downpayment now and settle once the hatian fills.',
  group_buy: 'Whole kits — ordered from the supplier once the batch reaches its MOQ.',
  moq: 'Bulk shelf — ships once your minimum order is packed.',
};

const MODE_ACCENT: Record<PackingMode, string> = {
  solo: 'bg-surface-mist text-ink-body',
  kahati: 'bg-[#e8f5db] text-brand-greendark',
  group_buy: 'bg-[#dbe8f5] text-brand-navy',
  moq: 'bg-warn-softbg text-[#8a6400]',
};

const NOTE_MAX = 500;

function CartLine({ item }: { item: CartItem }) {
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const [quantityText, setQuantityText] = useState(String(item.qty));
  useEffect(() => setQuantityText(String(item.qty)), [item.qty]);

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-bold text-ink">{item.name}</div>
        <div className="text-[11.5px] text-ink-muted">
          {item.unit === 'kit' ? `Kit of ${VIALS_PER_KIT}` : item.unit === 'piece' ? 'Per piece' : item.spec}
        </div>
      </div>
      <div className="flex items-center overflow-hidden rounded-[9px] border border-line">
        <button onClick={() => dec(item.key)} aria-label={`Remove one ${item.name}`}
          className="flex h-[30px] w-7 items-center justify-center font-bold text-ink-body">−</button>
        <input
          aria-label={`Quantity for ${item.name}`}
          type="number"
          min={item.minQty}
          max={Number.isFinite(maxQtyFor(item)) ? maxQtyFor(item) : undefined}
          value={quantityText}
          onChange={(e) => {
            setQuantityText(e.target.value);
            const qty = Number(e.target.value);
            if (Number.isInteger(qty) && qty > 0) setQty(item.key, qty);
          }}
          onBlur={() => setQuantityText(String(useCart.getState().items.find((line) => line.key === item.key)?.qty ?? item.qty))}
          className="h-[30px] w-10 border-x border-line bg-white text-center text-[13px] font-bold outline-none focus:bg-surface-field"
        />
        <button onClick={() => inc(item.key)} disabled={item.qty >= maxQtyFor(item)} aria-label={`Add one ${item.name}`}
          className="flex h-[30px] w-7 items-center justify-center font-bold text-ink-body disabled:text-ink-faint">+</button>
      </div>
      <strong className="w-[70px] text-right text-[13.5px] text-ink">{php(item.qty * item.unitPricePhp)}</strong>
      {/* Stepping down to zero already drops the line, but that takes as many
          taps as the quantity. A customer removing a 10-vial commitment should
          not have to press "−" ten times. */}
      <button onClick={() => remove(item.key)} aria-label={`Remove ${item.name} from cart`}
        className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[15px] leading-none text-ink-faint transition-colors hover:bg-[#fdeaea] hover:text-[#a33]">
        ×
      </button>
    </div>
  );
}

function CartSection({ group }: { group: CartGroup }) {
  return (
    <section aria-labelledby={`cart-group-${group.mode}`} className="rounded-[14px] bg-white p-3.5 shadow-card">
      <header className="mb-1 flex items-center gap-2">
        <h2 id={`cart-group-${group.mode}`}
          className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${MODE_ACCENT[group.mode]}`}>
          {group.label}
        </h2>
        <span className="text-[11.5px] text-ink-muted">
          {group.count} {group.count === 1 ? 'item' : 'items'}
        </span>
        <strong className="ml-auto text-[13px] text-ink">{php(group.subtotal)}</strong>
      </header>
      <p className="m-0 mb-1 text-[11.5px] leading-snug text-ink-muted">{MODE_BLURB[group.mode]}</p>
      <div className="divide-y divide-line-soft">
        {group.items.map((i) => <CartLine key={i.key} item={i} />)}
      </div>
    </section>
  );
}

export default function CartPage() {
  const router = useRouter();
  const items = useCart((s) => s.items);
  const count = useCart((s) => s.count());
  const note = useCart((s) => s.note);
  const setNote = useCart((s) => s.setNote);

  // Grouped rather than flat: Group Buy and Kahati become separate orders with
  // separate references at checkout, and the cart is the last screen that can
  // say so before the customer pays.
  const groups = groupCartByMode(items);
  const isSplit = groups.length > 1;

  return (
    <OverlayShell>
      {/* An explicit destination, not router.back(). Checkout's back button
          leads here, so falling through to history walked straight back into
          checkout — the two screens pointed at each other and the only way out
          was the bottom nav. Back from the cart means "keep shopping". */}
      <BackHeader title={`Cart · ${count}`} onBack={() => router.push('/')} />
      <div className="mx-auto w-full max-w-xl p-4">
        {!items.length && (
          <div className="px-5 py-16 text-center text-ink-muted">
            <div className="mb-2.5 text-4xl">🛒</div>
            <div className="mb-1 font-bold text-ink-body">Wala pang laman</div>
            <div className="text-[13px]">Join a kahati, add a group buy, or shop the shelf.</div>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {groups.map((g) => <CartSection key={g.mode} group={g} />)}
        </div>

        {isSplit && (
          <p className="mt-2.5 rounded-[10px] bg-warn-softbg px-3 py-2 text-[11.5px] leading-snug text-[#6b5a24]">
            These ship on different timelines, so each group becomes its own order with its own
            reference — Group Buy and Kahati are tracked separately. You still pay once.
          </p>
        )}

        {items.length > 0 && (
          <>
            {/* Paired deliberately: the destructive one is never the only
                button within reach of a thumb. */}
            <div className="mt-2.5"><CartEditActions /></div>

            <div className="mt-3.5 rounded-[14px] bg-white p-4 shadow-card">
              <label htmlFor="order-note" className="mb-1 block text-[13px] font-bold text-ink">
                Add a note to your order
              </label>
              <p className="m-0 mb-2 text-[11.5px] leading-snug text-ink-muted">
                Special instructions — packing, delivery timing, anything we should know. This does not
                change your price or quantities.
              </p>
              <textarea
                id="order-note"
                name="note"
                value={note}
                maxLength={NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Please text before delivery — gate closes at 8pm."
                className="h-[74px] w-full resize-none rounded-[10px] border-[1.5px] border-line bg-surface-field px-3.5 py-2.5 text-[14px] outline-none transition-colors focus:border-brand-green"
              />
              <div className="mt-1 text-right text-[11px] text-ink-faint">{note.length}/{NOTE_MAX}</div>
            </div>

            <div className="mt-3.5 rounded-[14px] bg-white p-4 shadow-card"><OrderSummary /></div>
            <button onClick={() => router.push('/checkout')}
              className="mt-3.5 block w-full rounded-[12px] bg-brand-blue py-[15px] text-center text-[15px] font-bold text-white active:scale-[.99]">
              Proceed to checkout
            </button>
          </>
        )}
      </div>
    </OverlayShell>
  );
}
