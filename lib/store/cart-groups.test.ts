// Grouping the cart by purchase mode, and the customer's order note.
//
// Group Buy and Kahati are separate systems with separate lifecycles, separate
// packing fees and — since the order-number change — separate references. A cart
// that lists them as one undifferentiated pile invites the customer to read
// them as one order, which is the thing checkout then contradicts.
import { describe, it, expect, beforeEach } from 'vitest';
import { useCart, groupCartByMode, type CartItem } from './cart';

const onHand = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
  spec: '10mg', unitPricePhp: 550, qty: 1, minQty: 1, unit: 'piece', stock: 100, ...o,
});
const kahati = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'gb:g1', kind: 'group_buy', refId: 'g1', name: 'Reta 20mg — kahati',
  spec: 'Kahati · min 1 vials', unitPricePhp: 900, qty: 1, minQty: 1, ...o,
});
const campaign = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'gbuy:c1', kind: 'moq_campaign', refId: 'c1', name: 'Reta 20mg — group buy',
  spec: 'Group buy · batch #1', unitPricePhp: 10000, qty: 1, minQty: 1, ...o,
});
const moq = (o: Partial<CartItem> = {}): CartItem => ({
  key: 'moq:m1', kind: 'moq_product', refId: 'm1', name: 'Bulk BAC',
  spec: '10ml', unitPricePhp: 300, qty: 5, minQty: 5, stock: 50, ...o,
});

describe('groupCartByMode', () => {
  it('keeps Group Buy and Kahati in separate, named groups', () => {
    // Arrange — the exact mix the requirement describes: browse Group Buy, add;
    // browse Kahati, add; open the cart.
    const items = [campaign(), kahati()];

    // Act
    const groups = groupCartByMode(items);

    // Assert
    expect(groups.map((g) => [g.mode, g.label])).toEqual([
      ['kahati', 'Kahati'],
      ['group_buy', 'Group Buy'],
    ]);
    expect(groups[0].items).toEqual([kahati()]);
    expect(groups[1].items).toEqual([campaign()]);
  });

  it('omits a mode the cart holds nothing for', () => {
    expect(groupCartByMode([kahati()]).map((g) => g.mode)).toEqual(['kahati']);
  });

  it('emits groups in a fixed order so the cart does not reshuffle between visits', () => {
    const groups = groupCartByMode([moq(), campaign(), kahati(), onHand()]);

    expect(groups.map((g) => g.mode)).toEqual(['solo', 'kahati', 'group_buy', 'moq']);
  });

  it('collects every line of a mode into its group', () => {
    const groups = groupCartByMode([
      kahati({ key: 'gb:a', refId: 'a' }),
      campaign(),
      kahati({ key: 'gb:b', refId: 'b' }),
    ]);

    expect(groups[0].items.map((i) => i.key)).toEqual(['gb:a', 'gb:b']);
  });

  it('totals each group separately, since each becomes its own order', () => {
    const groups = groupCartByMode([
      kahati({ qty: 2, unitPricePhp: 900 }),
      campaign({ qty: 1, unitPricePhp: 10000 }),
    ]);

    expect(groups.find((g) => g.mode === 'kahati')!.subtotal).toBe(1800);
    expect(groups.find((g) => g.mode === 'group_buy')!.subtotal).toBe(10000);
  });

  it('counts the units in each group, not the number of lines', () => {
    const groups = groupCartByMode([kahati({ qty: 3 })]);

    expect(groups[0].count).toBe(3);
  });

  it('returns nothing for an empty cart', () => {
    expect(groupCartByMode([])).toEqual([]);
  });
});

describe('cart order note', () => {
  beforeEach(() => {
    useCart.getState().clear();
  });

  it('starts empty', () => {
    expect(useCart.getState().note).toBe('');
  });

  it('holds what the customer typed', () => {
    useCart.getState().setNote('Please pack the salt forms separately.');

    expect(useCart.getState().note).toBe('Please pack the salt forms separately.');
  });

  it('is cleared along with the items once the order is placed', () => {
    // A note left behind would ride along on the customer's NEXT checkout,
    // silently attaching last week's instructions to an unrelated order.
    useCart.getState().add(kahati());
    useCart.getState().setNote('Leave with the guard.');

    useCart.getState().clear();

    expect(useCart.getState().items).toEqual([]);
    expect(useCart.getState().note).toBe('');
  });

  it('survives adding and removing items, so it is not lost mid-shop', () => {
    useCart.getState().setNote('Rush please.');

    useCart.getState().add(kahati());
    useCart.getState().remove('gb:g1');

    expect(useCart.getState().note).toBe('Rush please.');
  });
});
