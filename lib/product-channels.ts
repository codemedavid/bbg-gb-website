// Which sales channels a product may be offered through — pure rule, no I/O.
//
// The shop sells the same catalogue three ways, and not every product suits
// every way. A hatian splits ONE kit, ten vials, between ten people; the Korean
// aesthetics and skin boosters are not packed that way (a Rejuran i is a single
// prefilled syringe, a Nabota is one unit), so a hatian counter over them
// promises a per-vial share of something with no vials to share.
//
// That used to be a hardcoded `is_korean` flag. It is now three independent
// switches — On-Hand, Group Buy, Kahati — that the admin ticks per product.
// Same outcome for a Rejuran, but the rule generalises: next month's filler is
// a checkbox on the product form rather than another migration, and a product
// nobody anticipated can be Kahati-only if that is what it is.
//
// Beware the naming: the client's "Group Buy" is the `moq_campaigns` board, and
// the client's "Kahati" is the table literally named `group_buys`. The channel
// ids below are the client's words, because those are the words on the form.
//
// This lives in one module because it is enforced in many: both board seeders
// (lib/kahati-seed-bulk.ts, lib/campaign-seed-bulk.ts), both board listings,
// the campaign writer, and POST /api/orders. A frontend-only rule would be
// bypassable by anyone posting an id directly, which is the failure the
// requirement calls out by name.

/** The three switches on the product form, in the order it lists them. */
export const SALES_CHANNELS = ['on_hand', 'group_buy', 'kahati'] as const;

export type SalesChannel = (typeof SALES_CHANNELS)[number];

/** What each channel is called on screen and in the messages customers read. */
export const CHANNEL_LABELS: Record<SalesChannel, string> = {
  on_hand: 'On-Hand',
  group_buy: 'Group Buy',
  kahati: 'Kahati',
};

/** The least a product row must carry to be judged. Every field optional-safe. */
export type ProductChannels = {
  isOnHand?: boolean | null;
  isGroupBuy?: boolean | null;
  isKahati?: boolean | null;
  isActive?: boolean | null;
};

/** The column behind each switch, so the mapping is stated once. */
const FLAG_OF: Record<SalesChannel, keyof ProductChannels> = {
  on_hand: 'isOnHand',
  group_buy: 'isGroupBuy',
  kahati: 'isKahati',
};

/**
 * May this product be offered through this channel?
 *
 * A delisted product is refused everywhere: the shop does not sell it at all,
 * so no board may offer it whatever the switches still say.
 *
 * An absent or null channel flag reads as OFF. This rule decides whether money
 * may be taken, so it fails closed — a row read through a narrower column list
 * must never read as "allowed everywhere", which is the one direction where
 * being wrong sells something we cannot supply. An absent `isActive` is the
 * deliberate inverse: it means the caller did not ask about listing, not that
 * the product is gone.
 */
export function isChannelEnabled(p: ProductChannels, channel: SalesChannel): boolean {
  if (p.isActive === false) return false;
  return p[FLAG_OF[channel]] === true;
}

/**
 * The message a refused commitment carries back to the customer.
 *
 * Names the product and the channel rather than saying "not available", which
 * leaves a customer retrying the same thing when the product may be one tab
 * away. Deliberately free of any product category: the rule is general now, and
 * a message that still said "Korean" would be the hardcoded rule surviving in
 * the copy after leaving the code.
 */
export function channelRefusal(productName: string, channel: SalesChannel): string {
  return `${productName} is not available through ${CHANNEL_LABELS[channel]}.`;
}
