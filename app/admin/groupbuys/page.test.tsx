// A rejected group-buy save (e.g. the 400 when claimed vials exceed the cap)
// must show its reason inside the form. Found via live QA: the server refused
// an over-cap edit, but the admin saw nothing — the promise rejection went
// uncaught and the modal just sat there as if Save did nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog';

// Destructive actions route through the shared ConfirmProvider, so the page
// must render inside it.
const render = (ui: ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);

const saveMutate = vi.fn();
// Participants of the open hatian. Deferring the packing fee to a final checkout
// means a committed customer is not necessarily a paid-up one, so each of the
// three payments is tracked apart.
const commitments = {
  current: [
    {
      orderId: 'o1', orderNo: 'BBG-2418', orderStatus: 'payment_confirmed',
      customerName: 'Ana Cruz', customerEmail: 'ana@example.com', customerPhone: '09171234567',
      vials: 3, committedAt: new Date('2026-07-01T14:30:00Z').toISOString(),
      balancePhp: 2550, downpaymentPhp: 150,
      downpayment: 'paid', finalPayment: 'unpaid', packingFee: 'unpaid', settledAt: null,
    },
    {
      orderId: 'o2', orderNo: 'BBG-2419', orderStatus: 'batch_filling',
      customerName: 'Ben Reyes', customerEmail: 'ben@example.com', customerPhone: null,
      vials: 2, committedAt: new Date('2026-07-02T09:00:00Z').toISOString(),
      balancePhp: 1650, downpaymentPhp: 150,
      downpayment: 'paid', finalPayment: 'paid', packingFee: 'paid',
      settledAt: new Date('2026-07-10').toISOString(),
    },
  ],
};

vi.mock('@/lib/admin-api', () => ({
  useAdminGroupBuys: () => ({
    data: [{
      id: 'gb1', name: 'Bioglutide', pricePerKitPhp: '10400', totalSlots: 10,
      claimedSlots: 5, minVials: 1, repackFeePhp: '150', status: 'open', arrivalGroup: 'white_powder',
    }],
    isLoading: false,
  }),
  useAdminGroupBuyCommitments: () => ({ data: commitments.current, isLoading: false }),
  useMutate: () => ({
    saveGroupBuy: { mutateAsync: saveMutate, mutate: vi.fn(), isPending: false },
    deleteGroupBuy: { mutate: vi.fn() },
  }),
}));

const Page = (await import('./page')).default;

beforeEach(() => { saveMutate.mockReset(); });

describe('AdminGroupBuysPage', () => {
  it('shows the failure reason in the form when a save is rejected', async () => {
    saveMutate.mockRejectedValue(new Error('Claimed vials (15) cannot exceed the vial cap (10).'));
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await screen.findByText('Edit group buy');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot exceed/i);
    // The form stays open so the admin can correct the value.
    expect(screen.getByText('Edit group buy')).toBeInTheDocument();
    expect(saveMutate).toHaveBeenCalledTimes(1);
  });

  it('closes the form when the save succeeds', async () => {
    saveMutate.mockResolvedValue({});
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await screen.findByText('Edit group buy');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await vi.waitFor(() => expect(screen.queryByText('Edit group buy')).not.toBeInTheDocument());
  });

  // Without a deadline field, every new kahati is created with closesAt: null, so
  // the storefront board shows "closes —" and the expiry/auto-cancel lifecycle
  // never runs. The admin must be able to set the closing date on creation.
  it('sends the chosen closing date when a new hatian is created', async () => {
    saveMutate.mockResolvedValue({});
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: /new group buy/i }));
    await screen.findByText('New group buy');

    fireEvent.change(screen.getByLabelText(/closes at/i), { target: { value: '2026-08-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await vi.waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    const payload = saveMutate.mock.calls[0][0];
    expect(payload.closesAt).toEqual(expect.stringContaining('2026-08-01'));
  });
});

// The admin needs to see who is in a hatian and what each of them still owes.
// The packing fee is no longer collected at commit time, so "committed" and
// "paid up" are different things and the panel has to show both.
describe('hatian participants panel', () => {
  const openPanel = async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /participants/i }));
    await screen.findByText('Ana Cruz');
  };

  it('names each customer who committed and how many vials they took', async () => {
    await openPanel();
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument();
    expect(screen.getByText('Ben Reyes')).toBeInTheDocument();
    expect(screen.getByTestId('vials-o1')).toHaveTextContent('3');
    expect(screen.getByTestId('vials-o2')).toHaveTextContent('2');
  });

  it('shows when each commitment was made, to the minute', async () => {
    await openPanel();
    // Date AND time — "who committed first" is settled by the clock, not the day.
    expect(screen.getByTestId('committed-at-o1').textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('shows the three payments separately for each participant', async () => {
    await openPanel();
    expect(screen.getByTestId('downpayment-o1')).toHaveTextContent(/paid/i);
    expect(screen.getByTestId('final-payment-o1')).toHaveTextContent(/unpaid/i);
    expect(screen.getByTestId('packing-fee-o1')).toHaveTextContent(/unpaid/i);
  });

  it('marks a fully settled participant as paid across the board', async () => {
    await openPanel();
    expect(screen.getByTestId('final-payment-o2')).toHaveTextContent(/paid/i);
    expect(screen.getByTestId('packing-fee-o2')).toHaveTextContent(/paid/i);
  });

  it('counts the participants who have not settled yet', async () => {
    await openPanel();
    // The count is split across an emphasis element, so assert on the summary's
    // rendered text rather than on a single text node.
    const summary = screen.getByTestId('settled-count');
    expect(summary.textContent).toMatch(/1 of 2\s+participants fully settled/i);
    expect(summary.textContent).toMatch(/still owe their final payment and packing fee/i);
  });
});
