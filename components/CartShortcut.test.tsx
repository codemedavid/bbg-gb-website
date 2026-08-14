// The cart shortcut every board tab carries.
//
// Before this, only the home header and the shop showed a cart control — the
// Kahati and Group Buy boards had none, so a customer who added a vial there
// had no way to see their basket without going through the bottom nav. The
// count is the point: it is what tells them the add actually landed.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { useCart, type CartItem } from '@/lib/store/cart';
import { CartShortcut } from './CartShortcut';

const line = (o: Partial<CartItem> = {}): Omit<CartItem, 'qty'> & { qty?: number } => ({
  key: 'gb:1', kind: 'group_buy', refId: '1', name: 'Retatrutide 20mg — kahati',
  spec: 'Kahati · min 1 vials', unitPricePhp: 900, minQty: 1, qty: 1, ...o,
});

beforeEach(() => {
  act(() => useCart.getState().clear());
});

describe('CartShortcut', () => {
  it('links to the cart', () => {
    render(<CartShortcut />);

    expect(screen.getByRole('link', { name: /cart/i })).toHaveAttribute('href', '/cart');
  });

  it('shows the number of items in the cart', () => {
    act(() => useCart.getState().add(line({ qty: 3 })));

    render(<CartShortcut />);

    expect(screen.getByRole('link', { name: /cart/i })).toHaveTextContent('Cart (3)');
  });

  it('counts quantities across every line, Group Buy and Kahati alike', () => {
    // The cart is shared: two vials of a hatian plus one group buy kit is three
    // things the customer is holding, not two lines.
    act(() => {
      useCart.getState().add(line({ key: 'gb:1', qty: 2 }));
      useCart.getState().add(line({ key: 'gbuy:9', kind: 'moq_campaign', refId: '9', name: 'Tirzepatide — group buy', qty: 1 }));
    });

    render(<CartShortcut />);

    expect(screen.getByRole('link', { name: /cart/i })).toHaveTextContent('Cart (3)');
  });

  it('updates the moment an item is added', () => {
    render(<CartShortcut />);
    expect(screen.getByRole('link', { name: /cart/i })).toHaveTextContent('Cart (0)');

    act(() => useCart.getState().add(line({ qty: 2 })));

    expect(screen.getByRole('link', { name: /cart/i })).toHaveTextContent('Cart (2)');
  });

  it('updates the moment an item is removed', () => {
    act(() => useCart.getState().add(line({ qty: 2 })));
    render(<CartShortcut />);

    act(() => useCart.getState().remove('gb:1'));

    expect(screen.getByRole('link', { name: /cart/i })).toHaveTextContent('Cart (0)');
  });

  it('names the count for screen readers rather than leaving a bare number', () => {
    act(() => useCart.getState().add(line({ qty: 1 })));

    render(<CartShortcut />);

    expect(screen.getByRole('link', { name: 'Cart, 1 item' })).toBeInTheDocument();
  });

  it('pluralises the accessible label', () => {
    act(() => useCart.getState().add(line({ qty: 2 })));

    render(<CartShortcut />);

    expect(screen.getByRole('link', { name: 'Cart, 2 items' })).toBeInTheDocument();
  });
});
