// My Orders — the customer's only route into the hatian final checkout.
//
// Without a prompt here a customer has no way to know their completed hatians
// are waiting to be settled, and the packing fee would never be collected.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push, back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Ana Cruz', email: 'ana@example.com' }, loading: false }),
}));

const state = {
  orders: [] as unknown[],
  preview: { orders: [] as unknown[], totals: { balancePhp: 0, packingFeePhp: 0, totalPhp: 0 } },
};
vi.mock('@/lib/queries', () => ({
  useOrders: () => ({ data: state.orders, isLoading: false }),
  useSettlementPreview: () => ({ data: state.preview, isLoading: false }),
}));

const OrdersPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const kahatiOrder = {
  id: 'o1', orderNo: 'BBG-2418', status: 'batch_filling', buyType: 'kahati',
  subtotalPhp: '2700', packingFeePhp: '0', totalPhp: '2700', downpaymentPhp: '150',
  shipName: 'Ana', shipPhone: '0917', shipAddress: 'x', trackingNo: null,
  createdAt: new Date('2026-07-01').toISOString(),
  items: [{
    id: 'i1', kind: 'group_buy', nameSnapshot: 'Reta — kahati', specSnapshot: '20mg vial',
    unitPricePhp: '900', qty: 3, lineTotalPhp: '2700',
  }],
};

// The shape the brief calls out: many products, several sharing a name and
// differing only by variant. This is the order the old "+N more" summary hid.
const manyItemOrder = {
  ...kahatiOrder,
  id: 'o9', orderNo: 'BBG-2419', buyType: 'solo', status: 'shipped',
  subtotalPhp: '33950', packingFeePhp: '200', totalPhp: '34150', downpaymentPhp: '0',
  items: [
    { id: 'a', kind: 'product', nameSnapshot: 'Tirzepatide', specSnapshot: '15mg vial', unitPricePhp: '3200', qty: 1, lineTotalPhp: '3200' },
    { id: 'b', kind: 'product', nameSnapshot: 'Tirzepatide', specSnapshot: '30mg vial', unitPricePhp: '4850', qty: 1, lineTotalPhp: '4850' },
    { id: 'c', kind: 'product', nameSnapshot: 'Retatrutide', specSnapshot: '20mg vial', unitPricePhp: '6875', qty: 2, lineTotalPhp: '13750' },
    { id: 'd', kind: 'product', nameSnapshot: 'Cagrilintide', specSnapshot: '5mg vial', unitPricePhp: '4050', qty: 3, lineTotalPhp: '12150' },
  ],
};

beforeEach(() => {
  push.mockReset();
  state.orders = [kahatiOrder];
  state.preview = { orders: [], totals: { balancePhp: 0, packingFeePhp: 0, totalPhp: 0 } };
});

describe('settle prompt on My Orders', () => {
  it('prompts the customer once a completed hatian is ready to settle', async () => {
    state.preview = {
      orders: [{ id: 'o1' }, { id: 'o2' }],
      totals: { balancePhp: 4200, packingFeePhp: 150, totalPhp: 4350 },
    };
    render(<OrdersPage />, { wrapper });

    expect(await screen.findByText(/ready to settle/i)).toBeInTheDocument();
    // The single fee is the reassurance the prompt has to carry.
    expect(screen.getByText(/one packing fee|isang packing fee/i)).toBeInTheDocument();
  });

  it('sends the customer to the final checkout', async () => {
    state.preview = {
      orders: [{ id: 'o1' }],
      totals: { balancePhp: 2550, packingFeePhp: 150, totalPhp: 2700 },
    };
    render(<OrdersPage />, { wrapper });

    (await screen.findByRole('button', { name: /settle/i })).click();
    expect(push).toHaveBeenCalledWith('/settle');
  });

  it('stays quiet while no hatian has completed', () => {
    render(<OrdersPage />, { wrapper });
    expect(screen.queryByText(/ready to settle/i)).toBeNull();
  });
});

// The bug the brief opens with: an order card that names one item and counts
// the rest. A customer with four lines could not see three of them, and no
// screen they could reach from here listed them either.
describe('seeing everything in an order', () => {
  beforeEach(() => { state.orders = [manyItemOrder]; });

  it('lists every ordered item, not the first one and a tally', async () => {
    render(<OrdersPage />, { wrapper });
    (await screen.findByText('BBG-2419')).click();

    expect(await screen.findByText('Cagrilintide')).toBeInTheDocument();
    expect(screen.getAllByText('Tirzepatide')).toHaveLength(2);
    expect(screen.getByText('Retatrutide')).toBeInTheDocument();
    // The summary that replaced the real list.
    expect(screen.queryByText(/\+\d+ more/)).toBeNull();
  });

  it('shows the quantity of each line', async () => {
    render(<OrdersPage />, { wrapper });
    (await screen.findByText('BBG-2419')).click();

    const rows = await screen.findAllByRole('listitem');
    expect(rows.find((r) => r.textContent?.includes('Cagrilintide'))).toHaveTextContent('Qty: 3');
    expect(rows.find((r) => r.textContent?.includes('20mg vial'))).toHaveTextContent('Qty: 2');
  });

  // The status was only drawn once the card was open, so the one thing a
  // customer opens this screen to check was the one thing behind a tap.
  it('shows the status without the card being opened', () => {
    render(<OrdersPage />, { wrapper });
    expect(screen.getByText('Shipped')).toBeInTheDocument();
  });

  it('offers a way through to the full order', async () => {
    render(<OrdersPage />, { wrapper });

    (await screen.findByRole('button', { name: /view details/i })).click();
    expect(push).toHaveBeenCalledWith('/orders/o9');
  });
});

// The whole money block was gated on a downpayment being present, so an
// on-hand order — which never has one — showed no subtotal, no packing fee and
// no total at all.
describe('an order with no downpayment', () => {
  it('still breaks down what was charged', async () => {
    state.orders = [manyItemOrder];
    render(<OrdersPage />, { wrapper });
    (await screen.findByText('BBG-2419')).click();

    const summary = await screen.findByTestId('order-summary-BBG-2419');
    expect(summary).toHaveTextContent('₱33,950');  // subtotal
    expect(summary).toHaveTextContent('₱200');     // packing fee
    expect(summary).toHaveTextContent('₱34,150');  // total
    expect(summary).not.toHaveTextContent(/downpayment/i);
  });
});

// The packing fee must not read as settled until someone has actually verified
// the payment. Showing "Settled" the moment a settlement row exists contradicts
// the admin panel, which still says "under review" for the same order.
describe('packing fee status on a hatian order', () => {
  const withSettlement = (settlementStatus: string | null) => ({
    ...kahatiOrder,
    settlementId: settlementStatus ? 's1' : null,
    settlementStatus,
  });

  it('says the fee is charged at the final checkout while nothing is settled', async () => {
    state.orders = [withSettlement(null)];
    render(<OrdersPage />, { wrapper });
    (await screen.findByText('BBG-2418')).click();
    expect(await screen.findByText(/charged once at final checkout/i)).toBeInTheDocument();
  });

  it('says the payment is under review, not settled, while the proof is unverified', async () => {
    state.orders = [withSettlement('proof_review')];
    render(<OrdersPage />, { wrapper });
    (await screen.findByText('BBG-2418')).click();
    // Scoped to the packing-fee row: the order's own status also reads
    // "Proof under review", and the two must not be conflated.
    const fee = await screen.findByTestId('packing-fee-BBG-2418');
    expect(fee).toHaveTextContent(/under review/i);
    expect(fee).not.toHaveTextContent(/^Settled$/i);
  });

  it('says settled only once the admin has confirmed the payment', async () => {
    state.orders = [withSettlement('paid')];
    render(<OrdersPage />, { wrapper });
    (await screen.findByText('BBG-2418')).click();
    expect(await screen.findByTestId('packing-fee-BBG-2418')).toHaveTextContent(/settled/i);
  });

  it('goes back to owing when the settlement was cancelled', async () => {
    state.orders = [{ ...withSettlement('proof_review'), settlementStatus: 'cancelled' }];
    render(<OrdersPage />, { wrapper });
    (await screen.findByText('BBG-2418')).click();
    expect(await screen.findByTestId('packing-fee-BBG-2418')).toHaveTextContent(/charged once at final checkout/i);
  });
});
