import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ProductTotals } from '@/lib/report/product-totals';
import { ProductTotalsReport } from './ProductTotalsReport';

const productTotals: ProductTotals = {
  rows: [
    { index: 1, name: 'Liquid Bacteriostatic Water', code: 'BA5', spec: '5ml', usd: 270, qty: 270, kits: 27 },
    { index: 2, name: 'Lemon Bottle', code: 'LB50', spec: '50ml', usd: 594, qty: 33, kits: 33 },
    { index: 3, name: 'Tirzepatide', code: 'TR15', spec: '15mg', usd: 476, qty: 7, kits: 0.7 },
  ],
  totals: { usd: 1340, qty: 310 },
};

describe('ProductTotalsReport', () => {
  it('renders one row per product with its code, specs, quantity and kits', () => {
    render(<ProductTotalsReport productTotals={productTotals} />);

    const row = screen.getByText('Liquid Bacteriostatic Water').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('BA5')).toBeInTheDocument();
    expect(within(row!).getByText('5ml')).toBeInTheDocument();
    expect(within(row!).getByText('270')).toBeInTheDocument();
    expect(within(row!).getByText('27')).toBeInTheDocument();
  });

  it('lists products in the ranked order the rollup produced', () => {
    render(<ProductTotalsReport productTotals={productTotals} />);

    const codes = screen.getAllByTestId('product-total-code').map((el) => el.textContent);
    expect(codes).toEqual(['BA5', 'LB50', 'TR15']);
  });

  it('shows how many distinct products and total units the week moved', () => {
    render(<ProductTotalsReport productTotals={productTotals} />);

    // Scoped to the tiles: a bare getByText('3') would also match the rank cell
    // of the third row.
    expect(within(screen.getByTestId('tile-products')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-units')).getByText('310')).toBeInTheDocument();
  });

  it('closes with a total row carrying the summed USD', () => {
    render(<ProductTotalsReport productTotals={productTotals} />);

    const footer = screen.getByText(/total \(3 products\)/i).closest('tr');
    expect(within(footer!).getByText('$1,340.00')).toBeInTheDocument();
  });

  it('renders a partial kit as a fraction rather than rounding it away', () => {
    render(<ProductTotalsReport productTotals={productTotals} />);

    const row = screen.getByText('Tirzepatide').closest('tr');
    expect(within(row!).getByText('0.7')).toBeInTheDocument();
  });

  it('shows an empty state when no products sold that week', () => {
    render(<ProductTotalsReport productTotals={{ rows: [], totals: { usd: 0, qty: 0 } }} />);

    expect(screen.getByText(/no products sold in this period/i)).toBeInTheDocument();
  });
});
