// Which cart line a failed checkout is talking about.
//
// The checkout page drops a line the shop can no longer sell, because the cart
// persists in localStorage and such a line loops the same 400 on every retry
// until it is removed. That is right, and it is announced with a toast naming
// the item.
//
// It has to name the RIGHT item. The kahati branch matched the cart line whose
// name merely STARTS WITH the name in the server's message, and kahati counters
// are named after the peptide they carry — so "Retatrutide 10mg" is a prefix of
// "Retatrutide 10mg (Batch 2)". A customer with both in their cart could have
// the wrong one silently deleted, which is the reported "cart items suddenly
// disappear" with none of the compensating explanation, because the toast then
// names an item they did not lose.
import { describe, it, expect } from 'vitest';
import { staleCheckoutLine, matchesStaleLine, unavailableCheckoutLines } from '@/lib/checkout-error';

type Line = { key: string; kind: string; refId: string; name: string };

const kahatiLine = (refId: string, name: string): Line =>
  ({ key: `gb:${refId}`, kind: 'group_buy', refId, name: `${name} — kahati` });

describe('matching a stale line by id', () => {
  it('drops the line the server actually named', () => {
    const stale = staleCheckoutLine('Product not available: abc-123')!;
    const lines = [
      { key: 'product:abc-123:piece', kind: 'product', refId: 'abc-123', name: 'Tirzepatide 10mg' },
      { key: 'product:def-456:piece', kind: 'product', refId: 'def-456', name: 'Retatrutide 5mg' },
    ];

    expect(lines.filter((l) => matchesStaleLine(l, stale)).map((l) => l.refId)).toEqual(['abc-123']);
  });
});

describe('matching a closed kahati', () => {
  // The server names a closed kahati by NAME, not by id — that message has to
  // read well to a customer. So the match has to be exact rather than a prefix.
  const stale = staleCheckoutLine('Kahati "Retatrutide 10mg" has already closed and is no longer accepting commitments.')!;

  it('drops the kahati that closed', () => {
    const line = kahatiLine('gb-1', 'Retatrutide 10mg');
    expect(matchesStaleLine(line, stale)).toBe(true);
  });

  it('does NOT drop a different kahati whose name merely starts the same', () => {
    // The regression. Both of these were removed by a prefix match.
    expect(matchesStaleLine(kahatiLine('gb-2', 'Retatrutide 10mg (Batch 2)'), stale)).toBe(false);
    expect(matchesStaleLine(kahatiLine('gb-3', 'Retatrutide 10mg XL'), stale)).toBe(false);
  });

  it('does not touch a line of another kind that happens to share the name', () => {
    const onHand = { key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Retatrutide 10mg — kahati' };
    expect(matchesStaleLine(onHand, stale)).toBe(false);
  });

  it('removes exactly one line from a cart holding all three', () => {
    const cart = [
      kahatiLine('gb-1', 'Retatrutide 10mg'),
      kahatiLine('gb-2', 'Retatrutide 10mg (Batch 2)'),
      kahatiLine('gb-3', 'Retatrutide 10mg XL'),
    ];
    expect(cart.filter((l) => matchesStaleLine(l, stale)).map((l) => l.refId)).toEqual(['gb-1']);
  });
});

describe('a closed kahati named by id', () => {
  // Once the server names the counter by id, the name is only for the reader:
  // matching falls back to the name solely for a message that carries no id.
  it('matches on the id when the message carries one', () => {
    expect(staleCheckoutLine('Kahati "Retatrutide 10mg" is already closed: gb-9')).toEqual({ refId: 'gb-9' });
  });

  it('never drops a same-named line that is a different counter', () => {
    const stale = staleCheckoutLine('Kahati "Retatrutide 10mg" is already closed: gb-old')!;
    expect(matchesStaleLine(kahatiLine('gb-new', 'Retatrutide 10mg'), stale)).toBe(false);
    expect(matchesStaleLine(kahatiLine('gb-old', 'Retatrutide 10mg'), stale)).toBe(true);
  });
});

describe('every dead line in one refusal', () => {
  it('reads the refIds the server listed, in order', () => {
    const body = {
      success: false,
      error: 'Group buy not found: a',
      data: { unavailable: [
        { refId: 'a', kind: 'group_buy', name: 'Retatrutide (Salt Form) 20mg vial' },
        { refId: 'b', kind: 'moq_campaign', name: 'Retatrutide 10mg vial' },
      ] },
    };
    expect(unavailableCheckoutLines(body)).toEqual([
      { refId: 'a', name: 'Retatrutide (Salt Form) 20mg vial' },
      { refId: 'b', name: 'Retatrutide 10mg vial' },
    ]);
  });

  it('returns nothing for a refusal that carries no list', () => {
    expect(unavailableCheckoutLines({ success: false, error: 'Only 3 left in stock.', data: null })).toEqual([]);
    expect(unavailableCheckoutLines({})).toEqual([]);
    expect(unavailableCheckoutLines(null)).toEqual([]);
  });

  it('skips malformed entries rather than trusting them — this decides what is DELETED', () => {
    const body = { data: { unavailable: [{ refId: 'a', name: 'A' }, { name: 'no id' }, 'junk', { refId: 42, name: 'B' }] } };
    expect(unavailableCheckoutLines(body)).toEqual([{ refId: 'a', name: 'A' }]);
  });

  it('ignores a list that is not a list', () => {
    expect(unavailableCheckoutLines({ data: { unavailable: 'a,b' } })).toEqual([]);
  });
});

describe('what is NOT a stale line', () => {
  it('leaves a quantity shortfall alone, because the customer can fix it', () => {
    expect(staleCheckoutLine('Only 3 left in stock for Tirzepatide 10mg.')).toBeNull();
    expect(staleCheckoutLine('Only 2 vials left in this kahati.')).toBeNull();
  });

  it('leaves a price change alone — the cart is still sellable', () => {
    expect(staleCheckoutLine(
      'The price of Tirzepatide 10mg changed from ₱550 to ₱700 while it was in your cart.',
    )).toBeNull();
  });
});
