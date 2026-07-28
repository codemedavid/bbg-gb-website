// A kahati order placed by a customer who already had a commitment in progress
// collects nothing, so there is no proof to attach. A bare "No proof attached."
// there reads as a customer who skipped payment — it sends the admin chasing a
// screenshot that was never supposed to exist. The sheet has to say why.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const order = {
  current: {
    id: 'o1', orderNo: 'BBG-2460', status: 'payment_confirmed', createdAt: '2026-07-22T10:00:00Z',
    buyType: 'kahati', shipAddress: 'Unit 4B, 22 Maginhawa St, Quezon City',
    subtotalPhp: '1800.00', packingFeePhp: '0', totalPhp: '1800.00', downpaymentPhp: '0',
    paymentMethod: null, courier: 'J&T', packedBy: null, trackingNo: null,
  },
};

vi.mock('./WeeklyReportButton', () => ({ WeeklyReportButton: () => null }));
vi.mock('@/lib/admin-api', () => ({
  useAdminOrders: () => ({
    data: [{
      id: 'o1', orderNo: 'BBG-2460', shipName: 'Ana Reyes', customerEmail: 'ana@example.com',
      buyType: 'kahati', totalPhp: '1800.00', status: 'payment_confirmed', createdAt: '2026-07-22T10:00:00Z',
    }],
    isLoading: false,
  }),
  useAdminOrder: () => ({
    data: {
      order: order.current,
      items: [{ id: 'i1', nameSnapshot: 'Reta 20mg — kahati', qty: 2, lineTotalPhp: '1800.00' }],
      history: [],
      customer: { name: 'Ana Reyes', email: 'ana@example.com', phone: '0917 555 2210' },
      proofUrl: null,
    },
    isLoading: false,
  }),
  useMutate: () => ({ setOrderStatus: { mutateAsync: vi.fn(), isPending: false } }),
}));

const Page = (await import('./page')).default;

const openSheet = async () => {
  render(<Page />);
  fireEvent.click(screen.getByText('BBG-2460'));
  await screen.findByText('Update status');
};

beforeEach(() => {
  order.current = { ...order.current, buyType: 'kahati', downpaymentPhp: '0' };
});

describe('Admin order sheet — an order with no proof', () => {
  it('explains that a waived kahati commitment owed nothing', async () => {
    await openSheet();

    expect(screen.getByText(/no payment was due/i)).toBeInTheDocument();
    expect(screen.getByText(/kahati commitment/i)).toBeInTheDocument();
  });

  it('still flags a missing proof on an order that did owe money', async () => {
    // A solo order with no proof is a genuine gap, not a waiver.
    order.current = { ...order.current, buyType: 'solo', downpaymentPhp: '0', packingFeePhp: '200.00' };
    await openSheet();

    expect(screen.getByText(/no proof attached/i)).toBeInTheDocument();
    expect(screen.queryByText(/no payment was due/i)).not.toBeInTheDocument();
  });
});
