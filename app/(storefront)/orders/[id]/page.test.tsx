// The order details page — the whole order on one screen.
//
// The brief's complaint is that a customer had to walk several unrelated
// screens to reconstruct their own order, and for a large order could not
// reconstruct it at all. So these tests assert the six blocks the brief names
// are all present at once, on an order big enough to have been the problem.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, type ReactNode } from 'react';

const push = vi.fn();
const back = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back, replace, prefetch: vi.fn() }),
}));

const state = { detail: undefined as unknown, isLoading: false };
vi.mock('@/lib/queries', () => ({
  useOrderDetail: () => ({ data: state.detail, isLoading: state.isLoading }),
}));

const auth = { user: { id: 'u1' } as unknown, loading: false };
vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading }),
}));

const OrderDetailPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {/* The page reads its route params with use(), which suspends until the
        promise settles. Next supplies the boundary in the real app; the test
        has to supply its own. */}
    <Suspense fallback={<div>Loading…</div>}>{children}</Suspense>
  </QueryClientProvider>
);

/**
 * Render and let the suspended params settle.
 *
 * The act() wrapper is not optional here: use() suspends on the params promise,
 * and React will not commit the resolved tree until the resolution happens
 * inside an awaited act scope. Without it the page stays on the Suspense
 * fallback for the whole test.
 */
async function renderPage() {
  await act(async () => {
    render(<OrderDetailPage params={Promise.resolve({ id: 'o9' })} />, { wrapper });
  });
}

const items = [
  { id: 'a', kind: 'product', nameSnapshot: 'Tirzepatide 15mg vial', specSnapshot: 'On-hand · per piece', unitPricePhp: '3200', qty: 1, lineTotalPhp: '3200' },
  { id: 'b', kind: 'product', nameSnapshot: 'Tirzepatide 30mg vial', specSnapshot: 'On-hand · per piece', unitPricePhp: '4850', qty: 1, lineTotalPhp: '4850' },
  { id: 'c', kind: 'product', nameSnapshot: 'Retatrutide 20mg vial', specSnapshot: 'On-hand · per piece', unitPricePhp: '6875', qty: 2, lineTotalPhp: '13750' },
  { id: 'd', kind: 'product', nameSnapshot: 'Cagrilintide 5mg vial', specSnapshot: 'On-hand · per piece', unitPricePhp: '4050', qty: 3, lineTotalPhp: '12150' },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `x${i}`, kind: 'product', nameSnapshot: `Peptide ${i}`, specSnapshot: 'On-hand · per piece',
    unitPricePhp: '1000', qty: 1, lineTotalPhp: '1000',
  })),
];

const detail = {
  order: {
    id: 'o9', orderNo: 'BBG-2419', status: 'shipped', buyType: 'solo',
    subtotalPhp: '41950', packingFeePhp: '200', totalPhp: '42150', downpaymentPhp: '0',
    shipName: 'Ana Cruz', shipPhone: '09171234567', shipAddress: '123 Mabini St, Manila',
    trackingNo: 'JT-99118822', courier: 'J&T', paymentMethod: 'GCash',
    settlementStatus: null, notes: 'Please text before delivery.',
    createdAt: new Date('2026-07-01T09:00:00Z').toISOString(),
  },
  customer: { name: 'Ana Cruz', email: 'ana@example.com', phone: '09171234567' },
  items,
  history: [],
  proofUrl: 'https://example.test/proof.png',
};

beforeEach(() => {
  push.mockReset();
  back.mockReset();
  replace.mockReset();
  state.detail = detail;
  state.isLoading = false;
  auth.user = { id: 'u1' };
  auth.loading = false;
});

// The order emails link straight here, and this page needs a session. Before
// this, a customer whose session had expired got the loading spinner forever:
// the query 401s, `data` stays undefined, and the only guard on the page could
// not tell "still fetching" from "will never arrive".
describe('signed-out visitor', () => {
  it('sends them to log in and back to this order', async () => {
    auth.user = null;
    state.detail = undefined;
    await renderPage();

    expect(replace).toHaveBeenCalledWith('/login?next=%2Forders%2Fo9');
  });

  it('waits for the session check before redirecting', async () => {
    auth.user = null;
    auth.loading = true;
    state.detail = undefined;
    state.isLoading = true;
    await renderPage();

    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves a signed-in customer alone', async () => {
    await renderPage();

    expect(replace).not.toHaveBeenCalled();
  });
});

describe('order information', () => {
  it('names the order and its status', async () => {
    await renderPage();

    expect(screen.getByText('BBG-2419')).toBeInTheDocument();
    expect(screen.getAllByText('Shipped').length).toBeGreaterThan(0);
  });
});

describe('customer information', () => {
  it('shows the name, contact number and email', async () => {
    await renderPage();

    const block = screen.getByTestId('customer-block');
    expect(block).toHaveTextContent('Ana Cruz');
    expect(block).toHaveTextContent('09171234567');
    expect(block).toHaveTextContent('ana@example.com');
  });
});

describe('shipping information', () => {
  it('shows the full address, the courier and the tracking number', async () => {
    await renderPage();

    const block = screen.getByTestId('shipping-block');
    expect(block).toHaveTextContent('123 Mabini St, Manila');
    expect(block).toHaveTextContent('J&T');
    expect(block).toHaveTextContent('JT-99118822');
  });

  it('says so plainly when there is no tracking number yet', async () => {
    state.detail = { ...detail, order: { ...detail.order, trackingNo: null } };
    await renderPage();

    expect(screen.getByTestId('shipping-block')).toHaveTextContent(/not yet assigned|no tracking/i);
  });
});

describe('ordered items', () => {
  it('lists every line of a twelve-item order', async () => {
    await renderPage();

    // Scoped to the items block: the status trail on this same page is also a
    // list, and counting the whole document conflates the two.
    const rows = within(screen.getByTestId('items-block')).getAllByRole('listitem');
    expect(rows).toHaveLength(12);
  });

  it('shows quantity, unit price and line total per item', async () => {
    await renderPage();

    const row = within(screen.getByTestId('items-block'))
      .getAllByRole('listitem').find((r) => r.textContent?.includes('Retatrutide'))!;
    expect(row).toHaveTextContent('Qty: 2');
    expect(row).toHaveTextContent('₱6,875');
    expect(row).toHaveTextContent('₱13,750');
  });
});

describe('payment', () => {
  it('shows the method, the amount and a link to the proof', async () => {
    await renderPage();

    const block = screen.getByTestId('payment-block');
    expect(block).toHaveTextContent('GCash');
    expect(block).toHaveTextContent('₱42,150');
    expect(within(block).getByRole('link', { name: /proof/i }))
      .toHaveAttribute('href', 'https://example.test/proof.png');
  });

  it('omits the proof link entirely when none was uploaded', async () => {
    state.detail = { ...detail, proofUrl: null };
    await renderPage();

    expect(within(screen.getByTestId('payment-block')).queryByRole('link')).toBeNull();
  });
});

describe('order summary', () => {
  it('breaks the charge down to a grand total', async () => {
    await renderPage();

    const block = screen.getByTestId('summary-block');
    expect(block).toHaveTextContent('₱41,950');  // subtotal
    expect(block).toHaveTextContent('₱200');     // packing fee
    expect(block).toHaveTextContent('₱42,150');  // grand total
  });
});

// A dead-end details page sends the customer to the browser's back button, and
// on a fresh tab that goes nowhere at all.
describe('getting back out', () => {
  it('offers a route back to the order list', async () => {
    await renderPage();

    (await screen.findByRole('button', { name: /go back/i })).click();
    expect(push).toHaveBeenCalledWith('/orders');
  });
});

// Proof of payment on the customer's own order — see what landed, add what
// only got paid later.
describe('order details — proof of payment', () => {
  it('falls back to the legacy single proof for an order placed before the change', async () => {
    // The fixture carries proofUrl and no proofs list, which is exactly what an
    // order written before order_payment_proofs looks like. Showing nothing
    // would read to the customer as though their payment was never received.
    state.detail = detail;
    await renderPage();

    expect(screen.getByText('Proof #1')).toBeInTheDocument();
  });

  it('offers no uploader on a shipped order', async () => {
    // The fixture's order is 'shipped' — the parcel has gone, so there is no
    // further payment to evidence.
    state.detail = detail;
    await renderPage();

    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('lists every proof and offers an uploader while payment is under review', async () => {
    state.detail = {
      ...detail,
      order: { ...detail.order, status: 'proof_review' },
      proofs: [
        { id: 'p1', url: 'https://files.example/1.png', sortOrder: 0, amountPhp: null, reference: null },
        { id: 'p2', url: 'https://files.example/2.png', sortOrder: 1, amountPhp: null, reference: null },
      ],
    };
    await renderPage();

    expect(screen.getByText('Proof #1')).toBeInTheDocument();
    expect(screen.getByText('Proof #2')).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });
});
