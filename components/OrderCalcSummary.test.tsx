// What the sticky summary promises.
//
// It is the number the customer walks away with, so the guarantees are about
// honesty rather than layout: the breakdown has to reconcile with the total,
// the fee has to follow the fulfilment mode the customer picked, and an empty
// quote has to owe nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrderTotals } from '@/lib/order-calc';
import { OrderCalcSummary } from './OrderCalcSummary';

const onMode = vi.fn();
beforeEach(() => onMode.mockClear());

const totals = (o: Partial<OrderTotals> = {}): OrderTotals =>
  ({ subtotal: 2000, fee: 200, total: 2200, vials: 6, ...o });

const setup = (t = totals(), mode: 'solo' | 'kahati' | 'group_buy' | 'moq' = 'solo') =>
  render(<OrderCalcSummary totals={t} mode={mode} onMode={onMode} />);

describe('OrderCalcSummary — collapsed', () => {
  it('leads with the estimated total', () => {
    setup();
    expect(screen.getByText('₱2,200')).toBeInTheDocument();
    expect(screen.getByText(/estimated total/i)).toBeInTheDocument();
  });

  // The breakdown is opt-in in the design; showing it unasked would push the
  // total off a small screen.
  it('keeps the breakdown closed until it is asked for', () => {
    setup();
    expect(screen.queryByText('Subtotal')).not.toBeInTheDocument();
  });

  it('tells an empty quote how to start', () => {
    setup(totals({ subtotal: 0, fee: 0, total: 0, vials: 0 }));
    expect(screen.getByText(/add products to start/i)).toBeInTheDocument();
  });

  it('points at the breakdown once there is something to break down', () => {
    setup();
    expect(screen.getByText(/tap total for breakdown/i)).toBeInTheDocument();
  });
});

describe('OrderCalcSummary — expanded', () => {
  const open = async (t = totals(), mode: 'solo' | 'kahati' | 'group_buy' | 'moq' = 'solo') => {
    setup(t, mode);
    await userEvent.click(screen.getByRole('button', { name: /estimated total/i }));
  };

  it('reconciles subtotal plus fee against the total it shows', async () => {
    await open();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('₱2,000')).toBeInTheDocument();
    expect(screen.getByText('₱200')).toBeInTheDocument();
    expect(screen.getByText('₱2,200')).toBeInTheDocument();
  });

  // BBG has no shipping fee — the packing fee already includes local shipping,
  // and labelling it "shipping" would promise a second charge that never comes.
  it('labels the fee as packing, noting local shipping is included', async () => {
    await open();
    expect(screen.getByText(/packing fee/i)).toBeInTheDocument();
    expect(screen.getByText(/incl\. sf/i)).toBeInTheDocument();
  });

  it('keeps the estimate honest about being an estimate', async () => {
    await open();
    expect(screen.getByText(/may change/i)).toBeInTheDocument();
  });

  it('offers every fulfilment mode', async () => {
    await open();
    for (const label of ['On-hand', 'Hatian', 'Pasabay', 'MOQ']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('reports the mode the customer picked', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Hatian' }));
    expect(onMode).toHaveBeenCalledWith('kahati');
  });

  it('marks the active mode as pressed so the fee is attributable', async () => {
    await open(totals(), 'group_buy');
    expect(screen.getByRole('button', { name: 'Pasabay' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'On-hand' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('owes nothing on an empty quote', async () => {
    await open(totals({ subtotal: 0, fee: 0, total: 0, vials: 0 }));
    expect(screen.getAllByText('₱0').length).toBeGreaterThanOrEqual(2);
  });

  it('closes again when the total is tapped a second time', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /estimated total/i }));
    expect(screen.queryByText('Subtotal')).not.toBeInTheDocument();
  });
});
