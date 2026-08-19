// What step 2 of the order calculator promises.
//
// The stepper is the whole interaction: it is how a quantity is set and, at
// zero, how a line is removed. Each row also has to show its own line total —
// a customer checking a quote checks the lines, not just the grand total.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildLines, type CalcProduct } from '@/lib/order-calc';
import { OrderCalcLines } from './OrderCalcLines';

const product = (o: Partial<CalcProduct> = {}): CalcProduct => ({
  id: 'p1', code: 'TR15', name: 'Tirzepatide', spec: '15 mg/vial',
  pricePhp: '695.5', onHandPiecePhp: '695.5', onHandKitPhp: null, stock: 40, ...o,
});

const catalogue = [
  product({ id: 'a', code: 'TR15', name: 'Tirzepatide', onHandPiecePhp: '695.5' }),
  product({ id: 'b', code: 'BC10', name: 'BPC-157', onHandPiecePhp: '500' }),
];

const onQty = vi.fn();
beforeEach(() => onQty.mockClear());

const setup = (entries: { id: string; qty: number }[]) =>
  render(<OrderCalcLines lines={buildLines(catalogue, entries)} onQty={onQty} />);

describe('OrderCalcLines — empty', () => {
  it('invites the customer to search instead of showing a bare panel', () => {
    setup([]);
    expect(screen.getByText(/no products yet/i)).toBeInTheDocument();
  });

  it('shows no vial count when there is nothing to count', () => {
    setup([]);
    expect(screen.queryByText(/vials?$/)).not.toBeInTheDocument();
  });
});

describe('OrderCalcLines — with lines', () => {
  it('names each product in the quote', () => {
    setup([{ id: 'a', qty: 2 }, { id: 'b', qty: 1 }]);
    expect(screen.getByText('Tirzepatide')).toBeInTheDocument();
    expect(screen.getByText('BPC-157')).toBeInTheDocument();
  });

  it('shows the running vial count across every line', () => {
    setup([{ id: 'a', qty: 2 }, { id: 'b', qty: 3 }]);
    expect(screen.getByText('5 vials')).toBeInTheDocument();
  });

  it('says "vial" rather than "vials" for a single one', () => {
    setup([{ id: 'a', qty: 1 }]);
    expect(screen.getByText('1 vial')).toBeInTheDocument();
  });

  it('shows the per-vial price beside the code', () => {
    setup([{ id: 'b', qty: 2 }]);
    expect(screen.getByText(/BC10/)).toBeInTheDocument();
    expect(screen.getByText(/₱500 \/ vial/)).toBeInTheDocument();
  });

  it('shows each line total', () => {
    setup([{ id: 'b', qty: 3 }]);
    expect(screen.getByText('₱1,500')).toBeInTheDocument();
  });

  it('steps the quantity up', async () => {
    setup([{ id: 'a', qty: 2 }]);
    await userEvent.click(screen.getByRole('button', { name: /increase tirzepatide/i }));
    expect(onQty).toHaveBeenCalledWith('a', 3);
  });

  it('steps the quantity down', async () => {
    setup([{ id: 'a', qty: 2 }]);
    await userEvent.click(screen.getByRole('button', { name: /decrease tirzepatide/i }));
    expect(onQty).toHaveBeenCalledWith('a', 1);
  });

  // Stepping below one is the design's delete gesture, so it must ask for zero
  // and let the caller drop the line — not clamp at one and trap the row.
  it('asks for zero when stepping down from one, which removes the line', async () => {
    setup([{ id: 'a', qty: 1 }]);
    await userEvent.click(screen.getByRole('button', { name: /decrease tirzepatide/i }));
    expect(onQty).toHaveBeenCalledWith('a', 0);
  });

  it('removes a line outright from its remove button', async () => {
    setup([{ id: 'a', qty: 7 }]);
    await userEvent.click(screen.getByRole('button', { name: /remove tirzepatide/i }));
    expect(onQty).toHaveBeenCalledWith('a', 0);
  });

  // Two rows of identical controls need distinguishable names, or the customer
  // using a screen reader cannot tell which product they are about to change.
  it('names the stepper per product so two rows are distinguishable', () => {
    setup([{ id: 'a', qty: 1 }, { id: 'b', qty: 1 }]);
    expect(screen.getByRole('button', { name: /increase tirzepatide/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /increase bpc-157/i })).toBeInTheDocument();
  });
});
