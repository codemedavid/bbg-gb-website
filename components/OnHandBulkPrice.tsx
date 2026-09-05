'use client';
import { php } from '@/lib/format';
import { ON_HAND_BULK_MIN_VIALS, type OnHandQuote } from '@/lib/pricing';

// The shelf's bulk rate, told to the customer at the two moments it matters.
//
// Below the threshold it is a promise with a number on it — "6 more vials and
// every vial is ₱650" — because a discount nobody knows about changes nobody's
// basket. At the threshold it is a confirmation, with the old price struck
// through beside the new one, because a total that quietly drops is a total the
// customer distrusts.
//
// Purely presentational: it reads a quote and renders it. The arithmetic lives
// in lib/pricing.ts onHandQuote, which is the same function the server prices
// the order with — so this can never congratulate someone on a discount
// checkout is not going to give them.
export function OnHandBulkPrice({ quote }: { quote: OnHandQuote }) {
  // Nothing to say: this product states no bulk rate, or this is a kit line,
  // which already carries a kit price of its own.
  if (quote.bulkUnitPricePhp == null) return null;

  if (!quote.bulkApplied) {
    const left = quote.vialsToBulk;
    return (
      <div className="mb-3 flex items-start gap-2 rounded-[12px] border border-dashed border-[#a9c88f] bg-[#f7fbf2] px-3 py-2.5">
        <span aria-hidden="true" className="text-[15px] leading-none">🎁</span>
        <p className="m-0 text-[12.5px] leading-snug text-ink-body">
          <strong className="font-bold text-brand-greendark">
            {left} more {left === 1 ? 'vial' : 'vials'}
          </strong>{' '}
          and every vial drops to{' '}
          <strong className="font-bold text-brand-greendark">{php(quote.bulkUnitPricePhp)}</strong>.
          Check out {ON_HAND_BULK_MIN_VIALS} or more to get the bulk price.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-[12px] border-[1.5px] border-brand-green bg-[#eef7e2] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-[15px] leading-none">🎉</span>
        <strong className="text-[12.5px] font-bold text-brand-greendark">
          Congrats — you got the {ON_HAND_BULK_MIN_VIALS}-vial price!
        </strong>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        {/* The struck figure is decoration for sighted readers. A screen reader
            is told what the relationship is instead of reading two prices in a
            row with nothing to connect them. */}
        <span aria-label={`was ${php(quote.listUnitPricePhp)} per vial`}
          className="text-[13px] font-semibold text-ink-faint line-through">
          {php(quote.listUnitPricePhp)}
        </span>
        <span className="font-display text-[17px] font-bold text-brand-greendark">
          {php(quote.unitPricePhp)}
        </span>
        <span className="text-[11.5px] font-semibold text-ink-muted">per vial</span>
      </div>
      <p className="m-0 mt-0.5 text-[11.5px] text-ink-muted">
        You save {php(quote.savingsPhp)} on this order.
      </p>
    </div>
  );
}
