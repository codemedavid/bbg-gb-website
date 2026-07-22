// A rejected status update must show its reason inside the order sheet. The
// save awaited mutateAsync with no catch, so a server rejection (bad status
// transition, cancelled-release failure, …) left the sheet open with no
// explanation and the admin none the wiser.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setStatusMutate = vi.fn();
vi.mock('./WeeklyReportButton', () => ({ WeeklyReportButton: () => null }));
vi.mock('@/lib/admin-api', () => ({
  useAdminOrders: () => ({
    data: [{
      id: 'o1', orderNo: 'BBG-2451', shipName: 'Ana Reyes', customerEmail: 'ana@example.com',
      buyType: 'solo', totalPhp: '750.00', status: 'proof_review', createdAt: '2026-07-22T10:00:00Z',
    }],
    isLoading: false,
  }),
  useAdminOrder: () => ({
    data: {
      order: {
        id: 'o1', orderNo: 'BBG-2451', status: 'proof_review', createdAt: '2026-07-22T10:00:00Z',
        buyType: 'solo', shipAddress: 'Unit 4B, 22 Maginhawa St, Quezon City',
        subtotalPhp: '550.00', packingFeePhp: '200.00', totalPhp: '750.00', downpaymentPhp: '0',
        paymentMethod: 'GCash', courier: 'J&T', packedBy: null, trackingNo: null,
      },
      items: [{ id: 'i1', nameSnapshot: 'Tirzepatide 15mg vial', qty: 1, lineTotalPhp: '550.00' }],
      history: [],
      customer: { name: 'Ana Reyes', email: 'ana@example.com', phone: '0917 555 2210' },
      proofUrl: null,
    },
    isLoading: false,
  }),
  useMutate: () => ({
    setOrderStatus: { mutateAsync: setStatusMutate, isPending: false },
  }),
}));

const Page = (await import('./page')).default;

beforeEach(() => { setStatusMutate.mockReset(); });

describe('AdminOrdersPage', () => {
  it('shows the failure reason in the sheet when a status update is rejected', async () => {
    setStatusMutate.mockRejectedValue(new Error('Order is already cancelled.'));
    render(<Page />);

    fireEvent.click(screen.getByText('BBG-2451'));
    await screen.findByText('Update status');

    fireEvent.click(screen.getByRole('button', { name: /save update/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already cancelled/i);
    // The sheet stays open so the admin can see what happened.
    expect(screen.getByText('Update status')).toBeInTheDocument();
  });

  it('closes the sheet when the update succeeds', async () => {
    setStatusMutate.mockResolvedValue({});
    render(<Page />);

    fireEvent.click(screen.getByText('BBG-2451'));
    await screen.findByText('Update status');

    fireEvent.click(screen.getByRole('button', { name: /save update/i }));

    await vi.waitFor(() => expect(screen.queryByText('Update status')).not.toBeInTheDocument());
  });
});
