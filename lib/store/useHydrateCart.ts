import { useEffect } from 'react';
import { useCart } from '@/lib/store/cart';

// The cart store persists to localStorage with skipHydration, so it starts empty
// on both the server render and the client's first render — matching HTML, no
// React #418. This hook, mounted once near the app root, reads the saved cart
// back in after mount. Rehydrating in an effect (never during render) keeps the
// first client paint identical to the server's.
export function useHydrateCart(): void {
  useEffect(() => {
    void useCart.persist.rehydrate();
  }, []);
}
