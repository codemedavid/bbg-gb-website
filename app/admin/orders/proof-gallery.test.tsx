// §12 — the admin sees every proof an order carries.
//
// A ₱4,500 order paid as ₱2,000 + ₱1,500 + ₱1,000 has three screenshots. One
// of them alone reads as underpaid, so showing only the first is how an admin
// chases a customer who already paid in full.
//
// Thumbnails rather than three identical "View proof" links: the admin is
// matching these against a bank statement, and a link tells them nothing about
// which transfer it is.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

type Proof = { id: string; url: string; sortOrder: number; amountPhp: string | null; reference: string | null };

const detail: { proofUrl: string | null; proofs: Proof[]; downpaymentPhp: string; buyType: string } = {
  proofUrl: null, proofs: [], downpaymentPhp: '0', buyType: 'solo',
};

const setAmountMutate = vi.fn();
vi.mock('./WeeklyReportButton', () => ({ WeeklyReportButton: () => null }));
vi.mock('@/lib/admin-api', () => ({
  useAdminOrders: () => ({
    data: [{
      id: 'o1', orderNo: 'BBG-2451', shipName: 'Ana Reyes', customerEmail: 'ana@example.com',
      buyType: 'solo', totalPhp: '4500.00', status: 'proof_review', createdAt: '2026-07-22T10:00:00Z',
    }],
    isLoading: false,
  }),
  // The item editor offers a catalog product picker, so the sheet reads the
  // product list even when the test is about something else.
  useAdminProducts: () => ({ data: [] }),
  useAdminOrder: () => ({
    data: {
      order: {
        id: 'o1', orderNo: 'BBG-2451', status: 'proof_review', createdAt: '2026-07-22T10:00:00Z',
        buyType: detail.buyType, shipAddress: '22 Maginhawa St, Quezon City',
        subtotalPhp: '4300.00', packingFeePhp: '200.00', totalPhp: '4500.00',
        downpaymentPhp: detail.downpaymentPhp,
        paymentMethod: 'GCash', courier: 'J&T', packedBy: null, trackingNo: null,
      },
      items: [{ id: 'i1', nameSnapshot: 'Tirzepatide 15mg vial', qty: 1, lineTotalPhp: '4300.00' }],
      history: [],
      customer: { name: 'Ana Reyes', email: 'ana@example.com', phone: '0917 555 2210' },
      proofUrl: detail.proofUrl,
      proofs: detail.proofs,
    },
    isLoading: false,
  }),
  useMutate: () => ({
    setOrderStatus: { mutateAsync: vi.fn(), isPending: false },
    setProofAmount: { mutateAsync: setAmountMutate, isPending: false },
  }),

}));

const Page = (await import('./page')).default;

const proof = (i: number, amountPhp: string | null = null): Proof => ({
  id: `p${i}`, url: `https://files.example/proof-${i}.png`, sortOrder: i - 1, amountPhp, reference: null,
});

const openOrder = async () => {
  render(<Page />);
  fireEvent.click(await screen.findByText('BBG-2451'));
  await screen.findByText(/payment proof/i);
};

beforeEach(() => {
  setAmountMutate.mockReset();
  setAmountMutate.mockResolvedValue({});
  detail.proofUrl = null;
  detail.proofs = [];
  detail.downpaymentPhp = '0';
  detail.buyType = 'solo';
});

describe('admin order sheet — payment proofs', () => {
  it('shows a thumbnail for each of three proofs', async () => {
    detail.proofs = [proof(1), proof(2), proof(3)];

    await openOrder();

    expect(screen.getByAltText('Payment proof 1')).toBeInTheDocument();
    expect(screen.getByAltText('Payment proof 2')).toBeInTheDocument();
    expect(screen.getByAltText('Payment proof 3')).toBeInTheDocument();
  });

  it('numbers them so the admin can refer to one', async () => {
    detail.proofs = [proof(1), proof(2)];

    await openOrder();

    expect(screen.getByText('Proof #1')).toBeInTheDocument();
    expect(screen.getByText('Proof #2')).toBeInTheDocument();
  });

  it('says how many transfers the order was paid in', async () => {
    detail.proofs = [proof(1), proof(2), proof(3)];

    await openOrder();

    expect(screen.getByText(/3 transfers/i)).toBeInTheDocument();
  });

  it('opens each proof full size in its own tab', async () => {
    detail.proofs = [proof(1), proof(2)];

    await openOrder();

    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.includes('proof-'));
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://files.example/proof-1.png');
    expect(links[0]).toHaveAttribute('target', '_blank');
  });

  it('shows the amount once an admin has recorded it against a proof', async () => {
    // §13: the admin reconciles ₱2,000 + ₱1,500 + ₱1,000 against one ₱4,500
    // total, and needs to see what they already attributed. Editable rather
    // than static, so the figure appears in its own field.
    detail.proofs = [proof(1, '2000.00'), proof(2, '1500.00')];

    await openOrder();

    expect(screen.getByLabelText(/amount for proof 1/i)).toHaveValue(2000);
    expect(screen.getByLabelText(/amount for proof 2/i)).toHaveValue(1500);
  });

  it('does not label a single proof as several transfers', async () => {
    detail.proofs = [proof(1)];

    await openOrder();

    expect(screen.queryByText(/transfers/i)).not.toBeInTheDocument();
    expect(screen.getByText('Proof #1')).toBeInTheDocument();
  });

  it('falls back to the legacy single proof for an order placed before the change', async () => {
    // Orders written before order_payment_proofs existed carry only the old
    // column. Showing nothing would read as an unpaid order.
    detail.proofs = [];
    detail.proofUrl = 'https://files.example/legacy-proof.png';

    await openOrder();

    expect(screen.getByAltText('Payment proof 1')).toHaveAttribute('src', 'https://files.example/legacy-proof.png');
  });

  it('says no proof is attached when there is genuinely none', async () => {
    await openOrder();

    expect(screen.getByText(/no proof attached/i)).toBeInTheDocument();
  });

  it('explains a waived kahati downpayment rather than calling it a missing proof', async () => {
    // Pre-existing behaviour that the gallery must not swallow: this order
    // collected nothing, so no screenshot was ever supposed to exist.
    detail.buyType = 'kahati';
    detail.downpaymentPhp = '0';

    await openOrder();

    expect(screen.getByText(/no payment was due/i)).toBeInTheDocument();
  });
});

// §13 — the admin attributes each transfer and sees whether the order is paid.
describe('admin order sheet — reconciling the amounts', () => {
  it('offers an amount field against each proof', async () => {
    detail.proofs = [proof(1), proof(2)];

    await openOrder();

    expect(screen.getByLabelText(/amount for proof 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount for proof 2/i)).toBeInTheDocument();
  });

  it('sends what the admin typed against the right proof', async () => {
    detail.proofs = [proof(1), proof(2)];
    await openOrder();

    const field = screen.getByLabelText(/amount for proof 2/i);
    fireEvent.change(field, { target: { value: '1500' } });
    fireEvent.blur(field);

    await waitFor(() => expect(setAmountMutate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1', proofId: 'p2', amountPhp: 1500 }),
    ));
  });

  it('does not resend an amount that was not changed', async () => {
    // Every blur firing a write would put a request behind every stray click.
    detail.proofs = [proof(1, '2000.00')];
    await openOrder();

    fireEvent.blur(screen.getByLabelText(/amount for proof 1/i));

    expect(setAmountMutate).not.toHaveBeenCalled();
  });

  it('shows what has been recorded against the order total', async () => {
    detail.proofs = [proof(1, '2000.00'), proof(2, '1500.00')];

    await openOrder();

    expect(screen.getByText(/₱3,500 of ₱4,500/)).toBeInTheDocument();
  });

  it('names the shortfall so the admin knows what to chase', async () => {
    detail.proofs = [proof(1, '2000.00'), proof(2, '1500.00')];

    await openOrder();

    expect(screen.getByText(/₱1,000 short/i)).toBeInTheDocument();
  });

  it('says an order is fully paid once the amounts meet the total', async () => {
    detail.proofs = [proof(1, '2000.00'), proof(2, '2500.00')];

    await openOrder();

    expect(screen.getByText(/fully paid/i)).toBeInTheDocument();
  });

  it('flags an overpayment rather than calling it paid', async () => {
    detail.proofs = [proof(1, '3000.00'), proof(2, '2000.00')];

    await openOrder();

    expect(screen.getByText(/overpaid by ₱500/i)).toBeInTheDocument();
  });

  it('says nothing has been checked yet when no amount is recorded', async () => {
    // Not "₱0 of ₱4,500 — ₱4,500 short". Nobody has looked yet, and lumping
    // every fresh order in with the genuinely underpaid ones makes the whole
    // line worth ignoring.
    detail.proofs = [proof(1), proof(2)];

    await openOrder();

    expect(screen.getByText(/no amounts recorded yet/i)).toBeInTheDocument();
  });
});
