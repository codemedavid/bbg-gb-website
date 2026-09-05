// What step 1 of the order calculator promises.
//
// This is the only way a product gets into a quote, so the guarantees that
// matter are: the customer can find a row by the code printed on the pricelist,
// an empty result set says so rather than showing a blank panel, and tapping a
// row adds exactly that product.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CalcProduct } from '@/lib/order-calc';
import { OrderCalcSearch } from './OrderCalcSearch';

// pricePhp is a per-KIT figure, so ₱6,955 a kit is the ₱695.50 vial a row quotes.
const product = (o: Partial<CalcProduct> = {}): CalcProduct => ({
  id: 'p1', code: 'TR15', name: 'Tirzepatide', spec: '15 mg/vial',
  pricePhp: '6955', gbPricePerKitPhp: null, gbPricePerPiecePhp: null, gbVialsPerKit: null, ...o,
});

const catalogue = [
  product({ id: 'a', code: 'TR15', name: 'Tirzepatide', spec: '15 mg/vial', pricePhp: '6955' }),
  product({ id: 'b', code: 'BC10', name: 'BPC-157', spec: '10 mg/vial', pricePhp: '5655' }),
  product({ id: 'c', code: 'CU50', name: 'GHK-CU', spec: '50 mg/vial', pricePhp: '3575' }),
];

const onAdd = vi.fn();
const onQuery = vi.fn();

beforeEach(() => {
  onAdd.mockClear();
  onQuery.mockClear();
});

const setup = (query = '') =>
  render(<OrderCalcSearch products={catalogue} query={query} onQuery={onQuery} onAdd={onAdd} />);

describe('OrderCalcSearch', () => {
  it('shows how many products the pricelist holds', () => {
    setup();
    expect(screen.getByText('3 products')).toBeInTheDocument();
  });

  it('reports what the customer typed', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Search products'), 'b');
    expect(onQuery).toHaveBeenCalledWith('b');
  });

  it('narrows the list to the product whose code was typed', () => {
    setup('BC10');
    expect(screen.getByText('BPC-157')).toBeInTheDocument();
    expect(screen.queryByText('Tirzepatide')).not.toBeInTheDocument();
  });

  it('adds the product whose row was tapped', async () => {
    setup('BC10');
    await userEvent.click(screen.getByRole('button', { name: /add bpc-157/i }));
    expect(onAdd).toHaveBeenCalledWith('b');
  });

  it('quotes the per-vial price on each row', () => {
    setup('TR15');
    expect(screen.getByText('₱695.50')).toBeInTheDocument();
  });

  // A blank panel reads as a broken search. Saying so, and quoting the query
  // back, tells the customer the search ran and found nothing.
  it('says so when nothing matches, quoting the query back', () => {
    setup('zzzz');
    expect(screen.getByText(/no products match/i)).toBeInTheDocument();
    expect(screen.getByText(/zzzz/)).toBeInTheDocument();
  });

  // Stock is a ready-shelf idea. Nothing on the two scheduled boards is on a
  // shelf yet — a hatian and a campaign are both orders placed before the vials
  // exist — so a stock band here could only ever describe the wrong board.
  it('shows no stock band, which the boards it quotes have no stock to fill', () => {
    setup();
    for (const band of [/in stock/i, /low stock/i, /out of stock/i]) {
      expect(screen.queryByText(band)).not.toBeInTheDocument();
    }
  });
});
