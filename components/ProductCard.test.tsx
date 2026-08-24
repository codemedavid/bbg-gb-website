// The shop card, once a peptide's strengths share one card.
//
// Tirzepatide was five cards on the shelf — 15mg, 30mg, 40mg, 60mg, 100mg —
// so a customer read the same name five times and compared prices across
// cards. One card with a dose dropdown is the same catalogue, read once.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductCard } from './ProductCard';
import { useCart } from '@/lib/store/cart';
import { groupVariants } from '@/lib/product-variants';
import type { Product } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const product = (spec: string, piece: number, over: Partial<Product> = {}): Product => ({
  id: `p-${spec}`, code: null, supplierCode: null, name: 'Tirzepatide', spec,
  pricePhp: String(piece), priceUsd: null, categoryId: 'c1',
  categorySlug: 'glp-1', categoryName: 'GLP-1',
  isOnHand: true, onHandKitPhp: String(piece * 8), onHandPiecePhp: String(piece),
  stock: 50, kitSize: 10, arrivalGroup: 'white_powder',
  description: null, imageEmoji: '💧', soldCount: 0,
  ...over,
});

const VARIANTS = [product('15mg vial', 550), product('30mg vial', 700), product('60mg vial', 1200)];

const groupOf = (rows: Product[]) => groupVariants(rows, {
  key: (r) => r.name,
  name: (r) => r.name,
  variantLabel: (r) => r.spec,
})[0];

beforeEach(() => useCart.setState({ items: [] }));

describe('a peptide with several strengths', () => {
  it('is one card, not one per strength', () => {
    render(<ProductCard group={groupOf(VARIANTS)} />);

    expect(screen.getAllByText('Tirzepatide')).toHaveLength(1);
  });

  it('offers every strength in a dropdown', () => {
    render(<ProductCard group={groupOf(VARIANTS)} />);

    const select = screen.getByRole('combobox', { name: /tirzepatide/i });
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent))
      .toEqual(['15mg vial', '30mg vial', '60mg vial']);
  });

  it('starts on the lowest strength and says which one that is', () => {
    render(<ProductCard group={groupOf(VARIANTS)} />);

    expect(screen.getByRole('combobox', { name: /tirzepatide/i })).toHaveValue('p-15mg vial');
    expect(screen.getByText('₱550')).toBeInTheDocument();
  });

  // The whole point of the control: the price shown has to be the price of the
  // strength currently selected, or the customer is quoted one and charged
  // another.
  it('shows the selected strength\'s price after switching', async () => {
    const user = userEvent.setup();
    render(<ProductCard group={groupOf(VARIANTS)} />);

    await user.selectOptions(screen.getByRole('combobox', { name: /tirzepatide/i }), 'p-60mg vial');

    expect(screen.getByText('₱1,200')).toBeInTheDocument();
    expect(screen.queryByText('₱550')).toBeNull();
  });

  it('adds the selected strength to the cart, not the first one', async () => {
    const user = userEvent.setup();
    render(<ProductCard group={groupOf(VARIANTS)} />);

    await user.selectOptions(screen.getByRole('combobox', { name: /tirzepatide/i }), 'p-30mg vial');
    await user.click(screen.getByRole('button', { name: /add .*30mg/i }));

    const [line] = useCart.getState().items;
    expect(line.refId).toBe('p-30mg vial');
    expect(line.name).toBe('Tirzepatide 30mg vial');
    expect(line.unitPricePhp).toBe(700);
  });
});

describe('a peptide with only one strength', () => {
  it('states the spec rather than offering a choice of one', () => {
    render(<ProductCard group={groupOf([product('80mg vial', 900)])} />);

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('80mg vial')).toBeInTheDocument();
  });
});

describe('stock', () => {
  it('marks a sold-out strength in the dropdown rather than hiding it', () => {
    const rows = [product('15mg vial', 550), product('30mg vial', 700, { stock: 0 })];
    render(<ProductCard group={groupOf(rows)} />);

    const soldOut = screen.getByRole('option', { name: /30mg vial/i });
    expect(soldOut).toBeDisabled();
    expect(soldOut).toHaveTextContent(/sold out/i);
  });

  it('will not add a strength that is out of stock', async () => {
    const user = userEvent.setup();
    render(<ProductCard group={groupOf([product('15mg vial', 550, { stock: 0 })])} />);

    const add = screen.getByRole('button', { name: /add .*15mg/i });
    expect(add).toBeDisabled();
    await user.click(add).catch(() => {});
    expect(useCart.getState().items).toHaveLength(0);
  });
});
