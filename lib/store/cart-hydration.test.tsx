import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCart, type CartItem } from '@/lib/store/cart';
import { useHydrateCart } from '@/lib/store/useHydrateCart';

// A cart saved from a previous visit, as it would sit in localStorage.
const savedItem: CartItem = {
  key: 'product:p9:piece', kind: 'product', refId: 'p9', name: 'Saved Peptide',
  spec: '5mg', unitPricePhp: 100, qty: 3, minQty: 1, unit: 'piece', stock: 50,
};

beforeEach(() => {
  localStorage.clear();
  useCart.setState({ items: [] });
});

describe('cart persistence is SSR-safe (fixes React #418 on checkout)', () => {
  it('defers persisted-cart hydration so the first client render matches the empty server render', () => {
    // Without skipHydration, zustand reads localStorage synchronously at import
    // time, so the client renders a filled cart while the server rendered an
    // empty one — the text mismatch React reports as #418.
    expect(useCart.persist.getOptions().skipHydration).toBe(true);
  });

  it('leaves the store empty until the mount-time hook rehydrates it', async () => {
    // A saved cart on disk, empty in memory: exactly the post-SSR state.
    localStorage.setItem('bbg-cart', JSON.stringify({ state: { items: [savedItem] }, version: 0 }));
    expect(useCart.getState().count()).toBe(0);

    // The hook lives in <Providers/>; mounting it restores the saved cart.
    renderHook(() => useHydrateCart());

    await waitFor(() => expect(useCart.getState().count()).toBe(3));
  });
});
