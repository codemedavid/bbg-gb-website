// Which sales channels a product may be offered through.
//
// Three independent switches, one per channel, set by the admin on the product
// form. This replaces the hardcoded "Korean products are Group Buy only" rule:
// the packing fact that made a Rejuran unsplittable is now expressed as Kahati
// = off, which an admin can set for any product without a code change.
//
// The rule is pure and lives in one module because it is enforced in many:
// the two board seeders, the two board listings, the campaign writer, and
// checkout — which is the one that actually has to refuse money.
import { describe, it, expect } from 'vitest';
import {
  isChannelEnabled, channelRefusal, CHANNEL_LABELS, SALES_CHANNELS,
  type ProductChannels,
} from '@/lib/product-channels';

// Everything on, so each test can switch off exactly the one it is about.
const product = (o: Partial<ProductChannels> = {}): ProductChannels => ({
  isOnHand: true, isGroupBuy: true, isKahati: true, isActive: true, ...o,
});

describe('SALES_CHANNELS', () => {
  it('lists exactly the three channels the admin can tick', () => {
    // The form, the enforcement points and this list must not drift apart.
    expect(SALES_CHANNELS).toEqual(['on_hand', 'group_buy', 'kahati']);
  });

  it('labels every channel in the words the client uses', () => {
    expect(CHANNEL_LABELS).toEqual({
      on_hand: 'On-Hand', group_buy: 'Group Buy', kahati: 'Kahati',
    });
  });
});

describe('isChannelEnabled', () => {
  it('allows a product through every channel it is flagged for', () => {
    for (const channel of SALES_CHANNELS) {
      expect(isChannelEnabled(product(), channel)).toBe(true);
    }
  });

  it('refuses a channel the admin switched off, leaving the others alone', () => {
    // The requirement's headline example: a Korean product stays on Group Buy
    // and On-Hand while leaving Kahati, decided entirely by the checkbox.
    const korean = product({ isKahati: false });

    expect(isChannelEnabled(korean, 'kahati')).toBe(false);
    expect(isChannelEnabled(korean, 'group_buy')).toBe(true);
    expect(isChannelEnabled(korean, 'on_hand')).toBe(true);
  });

  it('treats the three switches as independent, not as a hierarchy', () => {
    // Group Buy off with Kahati on is a legitimate combination (the client's
    // Example 3). The old schema could not express it: one flag drove both
    // boards, so switching off Group Buy silently took Kahati with it.
    const kahatiOnly = product({ isGroupBuy: false });

    expect(isChannelEnabled(kahatiOnly, 'kahati')).toBe(true);
    expect(isChannelEnabled(kahatiOnly, 'group_buy')).toBe(false);
  });

  it('refuses every channel for a delisted product', () => {
    // The shop does not sell it at all, so no board may offer it — whatever
    // the channel switches still say.
    const delisted = product({ isActive: false });

    for (const channel of SALES_CHANNELS) {
      expect(isChannelEnabled(delisted, channel)).toBe(false);
    }
  });

  it('refuses a channel whose flag is missing rather than assuming permission', () => {
    // Fails closed. This rule decides whether money may be taken, so a row read
    // through a narrower column list must not read as "allowed everywhere" —
    // the one direction where being wrong sells something we cannot supply.
    expect(isChannelEnabled({ isActive: true }, 'kahati')).toBe(false);
    expect(isChannelEnabled({ isActive: true }, 'group_buy')).toBe(false);
    expect(isChannelEnabled({ isActive: true }, 'on_hand')).toBe(false);
  });

  it('reads a null flag the same as an absent one', () => {
    // Drizzle hands back null for a nullable column; the caller should not have
    // to normalise before asking.
    expect(isChannelEnabled(product({ isKahati: null }), 'kahati')).toBe(false);
  });

  it('treats a missing isActive as listed, so a narrow select keeps selling', () => {
    // The inverse of the flags above, and deliberately so: isActive absent
    // means the caller did not ask about listing, not that the product is gone.
    expect(isChannelEnabled({ isKahati: true }, 'kahati')).toBe(true);
  });
});

describe('channelRefusal', () => {
  it('names the product and the channel that refused it', () => {
    // This string reaches the customer at checkout. "Not available" alone
    // leaves them retrying the same thing.
    const message = channelRefusal('Rejuran i', 'kahati');

    expect(message).toContain('Rejuran i');
    expect(message).toContain('Kahati');
  });

  it('carries no hardcoded product category', () => {
    // The rule is general now. A message that still says "Korean" would be the
    // hardcoded rule surviving in the copy after leaving the code.
    for (const channel of SALES_CHANNELS) {
      expect(channelRefusal('Anything', channel)).not.toMatch(/korean/i);
    }
  });

  it('uses the client-facing label for every channel', () => {
    expect(channelRefusal('X', 'group_buy')).toContain('Group Buy');
    expect(channelRefusal('X', 'on_hand')).toContain('On-Hand');
  });
});
