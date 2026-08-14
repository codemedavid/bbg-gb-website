// The fulfilment trail on an order.
//
// It was previously inlined in My Orders and only rendered once the card was
// expanded, so an order's progress was a thing you had to go looking for. It is
// now its own component because the order details page shows the same trail,
// and two copies of "which step am I on" is how the two screens get to disagree.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { OrderStatusTrail } from './OrderStatusTrail';

describe('OrderStatusTrail', () => {
  it('lists every step of the fulfilment flow', () => {
    render(<OrderStatusTrail status="proof_review" />);

    // Each step also carries an sr-only note ("— not started"), so this asserts
    // the label is present rather than that it is the whole of the text.
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    ['Payment Pending', 'Payment Confirmed', 'Processing', 'Shipped', 'Delivered']
      .forEach((label, i) => expect(steps[i]).toHaveTextContent(label));
  });

  it('marks the step the order is actually on', () => {
    render(<OrderStatusTrail status="shipped" />);

    const current = screen.getByRole('listitem', { current: 'step' });
    expect(current).toHaveTextContent('Shipped');
  });

  // A screen-reader user gets no benefit from the coloured dot that tells a
  // sighted customer a step is behind them, so each step says which it is.
  it('says in words which steps are done and which are still to come', () => {
    render(<OrderStatusTrail status="batch_filling" />);

    const steps = screen.getAllByRole('listitem');
    expect(within(steps[0]).getByText(/completed/i)).toBeInTheDocument();
    expect(within(steps[4]).getByText(/not started/i)).toBeInTheDocument();
  });
});

// Cancellation used to render as a trail with nothing marked — visually
// identical to an order placed one second ago. The customer was shown "nothing
// has happened yet" for an order that had been called off.
describe('a cancelled order', () => {
  it('says the order was cancelled', () => {
    render(<OrderStatusTrail status="cancelled" />);
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
  });

  it('never presents a step of the flow as in progress', () => {
    render(<OrderStatusTrail status="cancelled" />);
    expect(screen.queryByRole('listitem', { current: 'step' })).toBeNull();
  });
});
