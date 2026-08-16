'use client';
import { useState } from 'react';
import { php } from '@/lib/format';
import type { OrderItem } from '@/lib/types';

// Editing the lines of an order that is not yet paid for in full.
//
// Client feedback: "clients can edit yung added items na di pa nababayadan in
// full sa cart nila". Before this, changing a placed order meant messaging an
// admin, who then edited it by hand.
//
// The draft is held here and only sent on Save. An order is a commercial record
// and a bank transfer may already be in flight against its total — a control
// that wrote every keystrokestraight through would leave the customer chasing a
// figure that moved while they were reading it.

export type OrderItemDraft = { id: string; qty: number };

type Props = {
  items: readonly OrderItem[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (items: OrderItemDraft[]) => void;
};

export function OrderItemsEditor({ items, isSaving, onCancel, onSave }: Props) {
  // Quantities by line id; a line dropped from the map is one being removed.
  const [draft, setDraft] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map((i) => [i.id, i.qty])),
  );

  const kept = items.filter((i) => draft[i.id] != null);
  const subtotal = kept.reduce((sum, i) => sum + Number(i.unitPricePhp) * draft[i.id], 0);
  // Every line removed is a cancellation, which this screen does not do — the
  // server refuses it too, and saying so here saves a round trip to be told.
  const isEmpty = kept.length === 0;

  const setQty = (id: string, qty: number) =>
    setDraft((prev) => ({ ...prev, [id]: Math.max(1, Math.min(9999, qty)) }));

  const drop = (id: string) => setDraft((prev) => {
    const next = { ...prev };
    delete next[id];
    return next;
  });

  const restore = (id: string, qty: number) => setDraft((prev) => ({ ...prev, [id]: qty }));

  return (
    <div data-testid="order-items-editor">
      <ul className="m-0 list-none divide-y divide-line-soft p-0">
        {items.map((item) => {
          const qty = draft[item.id];
          const removed = qty == null;
          return (
            <li key={item.id} className={`flex items-start gap-3 py-2.5 ${removed ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="break-words text-[13px] font-bold leading-snug text-ink">{item.nameSnapshot}</div>
                {item.specSnapshot && (
                  <div className="break-words text-[11.5px] leading-snug text-ink-muted">{item.specSnapshot}</div>
                )}
                <div className="mt-0.5 text-[11.5px] text-ink-muted">{php(item.unitPricePhp)} each</div>
              </div>

              {removed ? (
                <button
                  type="button"
                  onClick={() => restore(item.id, item.qty)}
                  className="rounded-[9px] border border-line px-2.5 py-1.5 text-[12px] font-semibold text-ink-body"
                >
                  Undo
                </button>
              ) : (
                <>
                  <div className="flex items-center overflow-hidden rounded-[9px] border border-line">
                    <button
                      type="button"
                      onClick={() => setQty(item.id, qty - 1)}
                      disabled={qty <= 1}
                      aria-label={`Reduce ${item.nameSnapshot}`}
                      className="flex h-[30px] w-7 items-center justify-center font-bold text-ink-body disabled:text-ink-faint"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      value={qty}
                      aria-label={`Quantity for ${item.nameSnapshot}`}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (Number.isInteger(next) && next > 0) setQty(item.id, next);
                      }}
                      className="h-[30px] w-12 border-x border-line bg-white text-center text-[13px] font-bold outline-none focus:bg-surface-field"
                    />
                    <button
                      type="button"
                      onClick={() => setQty(item.id, qty + 1)}
                      aria-label={`Add one ${item.nameSnapshot}`}
                      className="flex h-[30px] w-7 items-center justify-center font-bold text-ink-body"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => drop(item.id)}
                    aria-label={`Remove ${item.nameSnapshot}`}
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[15px] leading-none text-ink-faint transition-colors hover:bg-[#fdeaea] hover:text-[#a33]"
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex justify-between border-t border-line-soft pt-2 text-[13px] font-bold text-ink">
        <span>New product subtotal</span>
        <span>{php(subtotal)}</span>
      </div>
      {/* The fee is not re-derived when the lines change: the parcel still
          ships, and a customer who removes one vial has not stopped needing it
          packed. Said plainly so the new total is not read as an error. */}
      <p className="mt-1 text-[11.5px] leading-snug text-ink-muted">
        Hindi mababago ang packing fee — isang parcel pa rin ang ipapadala.
      </p>

      {isEmpty && (
        <p data-testid="order-edit-empty" className="mt-2 rounded-[10px] bg-warn-softbg px-3 py-2 text-[11.5px] leading-snug text-[#6b5a24]">
          Kailangan may kahit isang item ang order. Message us kung gusto mong i-cancel ang buong order.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onSave(kept.map((i) => ({ id: i.id, qty: draft[i.id] })))}
          disabled={isEmpty || isSaving}
          className={`flex-1 rounded-[12px] py-3 text-[14px] font-bold text-white ${isEmpty || isSaving ? 'bg-[#b9c6b4]' : 'bg-brand-green active:scale-[.99]'}`}
        >
          {isSaving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-[12px] border-[1.5px] border-line bg-white px-4 py-3 text-[14px] font-semibold text-ink-body"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
