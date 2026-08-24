// Checkout while a Kahati kit is still filling.
//
// The requirement this file protects is a negative one: the regular
// full-payment QR must NOT be reachable while the kit is incomplete. A customer
// who sends the whole order price for a kit that never fills has to be refunded
// in full, which is exactly what the downpayment QR exists to prevent — so the
// assertions below are as much about what is absent from the screen as about
// what is on it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCart } from '@/lib/store/cart';
import type { KahatiDownpaymentPolicy } from '@/lib/kahati-downpayment';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Ana Cruz', email: 'ana@example.com', phone: '09171234567', address: '123 Mabini St' },
    loading: false,
  }),
}));

const FULL_METHOD = {
  id: 'pm-full', label: 'GCash Full', accountName: 'BBG', accountNumber: '0917-000',
  qrUrl: 'https://example.test/full-qr.png', purpose: 'full', instructions: null,
};
const DOWNPAYMENT_METHOD = {
  id: 'pm-dp', label: 'GCash Downpayment', accountName: 'BBG Deposits', accountNumber: '0917-999',
  qrUrl: 'https://example.test/dp-qr.png', purpose: 'kahati_downpayment',
  instructions: 'This QR is locked to the downpayment amount.',
};

const policy: { current: KahatiDownpaymentPolicy | undefined } = { current: undefined };
const commitments: { current: unknown } = { current: undefined };
const policyLoaded = { current: true };
const methods: { current: unknown[] } = { current: [] };

vi.mock('@/lib/queries', () => ({
  useKahatiDownpaymentPolicy: () => ({ data: policy.current, isSuccess: policyLoaded.current }),
  usePaymentMethods: () => ({ data: methods.current }),
  usePackingFees: () => ({ data: { solo: 200, kahati: 150, group_buy: 300 } }),
  useKahatiCommitments: () => ({ data: commitments.current }),
  useCyclePackingFeePaid: () => ({ data: false }),
}));

const CheckoutPage = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

/** One hatian line: 2 vials at ₱900, ₱150 packing fee -> ₱1,950 order total. */
const seedKahatiCart = () => useCart.setState({
  items: [{
    key: 'gb:k1', kind: 'group_buy', refId: 'k1', name: 'Reta 10mg — kahati',
    spec: 'Kahati · min 1 vial', unitPricePhp: 900, qty: 2, minQty: 1, packingFeePhp: 150,
  }],
});

const addOnHandLine = () => useCart.setState((s) => ({
  items: [...s.items, {
    key: 'product:p1:piece', kind: 'product', refId: 'p1', name: 'Test Peptide',
    spec: '10mg', unitPricePhp: 550, qty: 2, minQty: 1, unit: 'piece', stock: 100,
  }],
}));

const fixedPolicy = (amountPhp: number): KahatiDownpaymentPolicy =>
  ({ mode: 'fixed', amountPhp, percent: 0, refundable: true, policyNote: null });

beforeEach(() => {
  useCart.getState().clear();
  policy.current = undefined;
  policyLoaded.current = true;
  commitments.current = undefined;
  methods.current = [FULL_METHOD, DOWNPAYMENT_METHOD];
});

describe('a kahati checkout with a configured downpayment', () => {
  it('shows the downpayment-only notice with the exact amount', () => {
    // Arrange
    policy.current = fixedPolicy(500);
    seedKahatiCart();
    // Act
    render(<CheckoutPage />, { wrapper });
    // Assert
    expect(screen.getByRole('heading', { name: /downpayment only/i })).toBeInTheDocument();
    expect(screen.getByText(/only the required downpayment of ₱500/i)).toBeInTheDocument();
  });

  it('shows ONLY the downpayment QR — the full-payment QR is not on the page', () => {
    policy.current = fixedPolicy(500);
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    expect(screen.getByAltText('GCash Downpayment QR code')).toBeInTheDocument();
    expect(screen.queryByAltText('GCash Full QR code')).not.toBeInTheDocument();
    // Not even as an unselected option to tap.
    expect(screen.queryByRole('button', { name: 'GCash Full' })).not.toBeInTheDocument();
  });

  it('explains that the balance is only requested once the kit completes', () => {
    policy.current = fixedPolicy(500);
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    expect(screen.getByText(/remaining balance once the kit is complete/i)).toBeInTheDocument();
  });

  it('states the refund terms the admin configured', () => {
    policy.current = { ...fixedPolicy(500), policyNote: 'Deposits roll over to your next hatian.' };
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    expect(screen.getByText('Deposits roll over to your next hatian.')).toBeInTheDocument();
  });

  it('shows the per-method instructions under the QR', () => {
    policy.current = fixedPolicy(500);
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    expect(screen.getByText(/locked to the downpayment amount/i)).toBeInTheDocument();
  });

  it('quotes the downpayment as due now and the rest as the balance', () => {
    policy.current = fixedPolicy(500);
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    expect(screen.getByText('Downpayment due now')).toBeInTheDocument();
    // ₱1,950 order total less the ₱500 deposit.
    expect(screen.getAllByText('₱1,450').length).toBeGreaterThan(0);
  });

  it('refuses to take a payment at all when no downpayment QR is configured', () => {
    // Falling back to the full-payment QR here is the failure mode the feature
    // exists to remove, so the screen blocks instead.
    policy.current = fixedPolicy(500);
    methods.current = [FULL_METHOD];
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    expect(screen.getByRole('alert')).toHaveTextContent(/downpayment QR is not set up/i);
    expect(screen.queryByAltText('GCash Full QR code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /place order|upload proof/i })).toBeDisabled();
  });
});

describe('a second kahati kit in the same cycle', () => {
  it('still asks for the deposit, and still shows a way to pay and prove it', () => {
    // The packing fee is waived once per cycle — one cycle is one parcel. A
    // deposit is not a parcel charge, so the server keeps charging it, and a
    // screen that went confirm-only here would hide the payment card and the
    // proof uploader from a checkout the server then rejects for having no
    // proof. That is a dead end the customer cannot get out of.
    policy.current = fixedPolicy(500);
    commitments.current = { paidThisCycle: true, commitments: [], summary: { groups: [], vials: 0, totalPhp: 0, orderCount: 0 } };
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    expect(screen.getByRole('heading', { name: /downpayment only/i })).toBeInTheDocument();
    expect(screen.getByAltText('GCash Downpayment QR code')).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('still goes confirm-only under the packing-fee rule, which the cycle does waive', () => {
    commitments.current = { paidThisCycle: true, commitments: [], summary: { groups: [], vials: 0, totalPhp: 0, orderCount: 0 } };
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    expect(screen.getByRole('button', { name: /confirm order/i })).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('a mixed cart', () => {
  it('keeps the two obligations apart — a deposit on the hatian, full price on the rest', () => {
    policy.current = fixedPolicy(500);
    seedKahatiCart();
    addOnHandLine();

    render(<CheckoutPage />, { wrapper });

    // Both cards are present, each with its own QR.
    expect(screen.getByAltText('GCash Downpayment QR code')).toBeInTheDocument();
    expect(screen.getByAltText('GCash Full QR code')).toBeInTheDocument();
    // The on-hand half: 2 x ₱550 + ₱200 solo packing fee.
    expect(screen.getByText('₱1,300')).toBeInTheDocument();
  });
});

// A slow or failed /settings request leaves the same fallback policy in hand as
// "no deposit configured", and the two mean opposite things: one owes nothing,
// the other owes a deposit. The screen cannot tell them apart, so it must not
// act on either reading — going confirm-only would hide a payment the server
// still charges for, and demanding a proof quotes the customer no amount, no
// account and no QR to make one against. It waits instead.
describe('while the downpayment policy is still unknown', () => {
  const unknownPolicyOnASettledCycle = () => {
    policyLoaded.current = false;
    commitments.current = { paidThisCycle: true, commitments: [], summary: { groups: [], vials: 0, totalPhp: 0, orderCount: 0 } };
    seedKahatiCart();
  };

  it('does not assume there is nothing left to pay', () => {
    unknownPolicyOnASettledCycle();

    render(<CheckoutPage />, { wrapper });

    expect(screen.queryByRole('button', { name: /confirm order/i })).not.toBeInTheDocument();
  });

  it('does not demand a proof of a payment it cannot quote', () => {
    // The dead end this replaces: an "upload proof of payment" box with no
    // amount, no account and no QR anywhere on the screen, and a Place button
    // that will not unlock until the customer attaches an unrelated file.
    unknownPolicyOnASettledCycle();

    render(<CheckoutPage />, { wrapper });

    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('says so, and holds the order until it knows', () => {
    unknownPolicyOnASettledCycle();

    render(<CheckoutPage />, { wrapper });

    expect(screen.getByRole('status')).toHaveTextContent(/payment details/i);
    expect(screen.getByRole('button', { name: /place order|upload proof|confirm order/i })).toBeDisabled();
  });

  it('shows no payment QR at all, so nothing can be sent to the wrong account', () => {
    // Including the mixed-cart case: the on-hand half has a known price, but
    // the hatian half does not, so the total on any QR would be wrong.
    unknownPolicyOnASettledCycle();
    addOnHandLine();

    render(<CheckoutPage />, { wrapper });

    expect(screen.queryByAltText('GCash Full QR code')).not.toBeInTheDocument();
    expect(screen.queryByAltText('GCash Downpayment QR code')).not.toBeInTheDocument();
  });
});

describe('a kahati checkout under the default packing-fee rule', () => {
  it('pays through the ordinary methods, exactly as before', () => {
    // No policy configured. Nothing about this screen should have changed.
    seedKahatiCart();

    render(<CheckoutPage />, { wrapper });

    expect(screen.queryByRole('heading', { name: /downpayment only/i })).not.toBeInTheDocument();
    expect(screen.getByAltText('GCash Full QR code')).toBeInTheDocument();
    // Twice: once in the order summary, once beside the QR the customer scans.
    expect(screen.getAllByText('Packing fee due now').length).toBeGreaterThan(0);
  });
});
