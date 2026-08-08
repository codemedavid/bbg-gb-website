// Every item on an order, always.
//
// My Orders used to name the first item and append "+3 more". A customer with a
// twelve-line order could not see what they had bought from the order screen at
// all — not the variants, not the quantities, not the prices. Truncation is the
// specific failure this component exists to make impossible, so the first test
// is a realistic many-item order and the assertion is a count.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { OrderItemList } from './OrderItemList';
import type { OrderItem } from '@/lib/types';

const item = (n: number, over: Partial<OrderItem> = {}): OrderItem => ({
  id: `i${n}`, kind: 'product',
  nameSnapshot: `Peptide ${n}`, specSnapshot: '10mg vial',
  unitPricePhp: '1000', qty: 1, lineTotalPhp: '1000',
  ...over,
});

// The order from the brief, plus enough siblings to be past any plausible cap.
const bigOrder: OrderItem[] = [
  item(1, { nameSnapshot: 'Tirzepatide', specSnapshot: '15mg vial', qty: 1, unitPricePhp: '3200', lineTotalPhp: '3200' }),
  item(2, { nameSnapshot: 'Tirzepatide', specSnapshot: '30mg vial', qty: 1, unitPricePhp: '4850', lineTotalPhp: '4850' }),
  item(3, { nameSnapshot: 'Retatrutide', specSnapshot: '20mg vial', qty: 2, unitPricePhp: '6875', lineTotalPhp: '13750' }),
  item(4, { nameSnapshot: 'Cagrilintide', specSnapshot: '5mg vial', qty: 3, unitPricePhp: '4050', lineTotalPhp: '12150' }),
  ...Array.from({ length: 8 }, (_, i) => item(i + 5)),
];

describe('OrderItemList', () => {
  it('renders every line of a twelve-item order', () => {
    render(<OrderItemList items={bigOrder} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    // Named explicitly: a count alone would pass if the component rendered
    // twelve copies of the first item.
    expect(screen.getByText('Cagrilintide')).toBeInTheDocument();
    expect(screen.getAllByText('Tirzepatide')).toHaveLength(2);
  });

  it('distinguishes two variants of the same peptide', () => {
    render(<OrderItemList items={bigOrder} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('15mg vial');
    expect(rows[1]).toHaveTextContent('30mg vial');
  });

  it('shows the quantity on every line without a second screen', () => {
    render(<OrderItemList items={bigOrder} />);

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[2]).getByText(/qty/i)).toHaveTextContent('2');
    expect(within(rows[3]).getByText(/qty/i)).toHaveTextContent('3');
  });

  it('shows both the unit price and the line total', () => {
    render(<OrderItemList items={[bigOrder[2]]} />);

    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('₱6,875');   // unit
    expect(row).toHaveTextContent('₱13,750');  // 2 x unit
  });

  it('renders nothing rather than an empty frame when the order has no items', () => {
    render(<OrderItemList items={[]} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

// A long list is capped in HEIGHT, never in CONTENT. The cap has to stay
// reachable by keyboard: a scroll box that only responds to a mouse wheel hides
// the tail of the order from anyone not using one.
describe('a long item list', () => {
  it('becomes a labelled region a keyboard can scroll', () => {
    render(<OrderItemList items={bigOrder} />);

    const region = screen.getByRole('region', { name: /ordered items/i });
    expect(region).toHaveAttribute('tabindex', '0');
    // Still all twelve — scrolling is the affordance, not a limit.
    expect(within(region).getAllByRole('listitem')).toHaveLength(12);
  });

  it('leaves a short list unscrolled', () => {
    render(<OrderItemList items={bigOrder.slice(0, 3)} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
});
