// A rejected group-buy save (e.g. the 400 when claimed vials exceed the cap)
// must show its reason inside the form. Found via live QA: the server refused
// an over-cap edit, but the admin saw nothing — the promise rejection went
// uncaught and the modal just sat there as if Save did nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import type { HatianCommitment } from '@/lib/types';

// Destructive actions route through the shared ConfirmProvider, so the page
// must render inside it.
const render = (ui: ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);

const saveMutate = vi.fn();
// Participants of the open hatian. Deferring the packing fee to a final checkout
// means a committed customer is not necessarily a paid-up one, so each of the
// three payments is tracked apart.
//
// Typed as HatianCommitment so this fixture cannot drift from the feed it stands
// in for. It once did: the feed renamed balancePhp to orderBalancePhp and this
// mock kept the old name, so the panel read undefined, php() threw on it and
// clicking "Participants & payments" blanked the admin with a client-side
// exception — while every test here stayed green.
const commitments: { current: HatianCommitment[] } = {
  current: [
    {
      orderId: 'o1', orderNo: 'BBG-2418', orderStatus: 'payment_confirmed',
      customerName: 'Ana Cruz', customerEmail: 'ana@example.com', customerPhone: '09171234567',
      vials: 3, committedAt: new Date('2026-07-01T14:30:00Z').toISOString(),
      orderBalancePhp: 2550, spansOtherHatians: false, downpaymentPhp: 150,
      downpayment: 'paid', finalPayment: 'unpaid', packingFee: 'unpaid', settledAt: null,
    },
    {
      orderId: 'o2', orderNo: 'BBG-2419', orderStatus: 'batch_filling',
      customerName: 'Ben Reyes', customerEmail: 'ben@example.com', customerPhone: null,
      vials: 2, committedAt: new Date('2026-07-02T09:00:00Z').toISOString(),
      orderBalancePhp: 1650, spansOtherHatians: true, downpaymentPhp: 150,
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

  // An admin opening this panel is looking at one counter among several that
  // share a name, price and cap. Which one they are chasing payments for has to
  // be on the screen — the participant list alone does not say.
  it('heads the panel with the group buy details', async () => {
    await openPanel();
    const details = screen.getByTestId('group-buy-details');
    expect(details).toHaveTextContent(/campaign name/i);
    expect(details).toHaveTextContent('Bioglutide');
    expect(details).toHaveTextContent(/status/i);
    expect(details).toHaveTextContent('open');
    expect(details).toHaveTextContent(/current progress/i);
    expect(details).toHaveTextContent('5/10 vials');
  });

  // The details are a property of the hatian, not of its participant list — an
  // empty counter is exactly when an admin needs to confirm they opened the
  // right one.
  it('shows the details for a hatian nobody has joined yet', async () => {
    const joined = commitments.current;
    commitments.current = [];
    try {
      render(<Page />);
      fireEvent.click(screen.getByRole('button', { name: /participants/i }));
      const details = await screen.findByTestId('group-buy-details');
      expect(details).toHaveTextContent('Bioglutide');
      expect(screen.getByText(/walang sumali pa/i)).toBeInTheDocument();
    } finally {
      commitments.current = joined;
    }
  });

  // The panel used to read a field the feed no longer sends. php(undefined)
  // throws rather than degrading, so the whole admin tree unmounted into Next's
  // "client-side exception" screen the moment a hatian had one participant.
  it('shows what each participant still owes', async () => {
    await openPanel();
    expect(screen.getByTestId('balance-o1')).toHaveTextContent('₱2,550');
    expect(screen.getByTestId('balance-o2')).toHaveTextContent('₱1,650');
  });

  // An overflow commitment holds lines against two counters, but the balance is
  // a property of the whole ORDER — the same figure appears under both hatians.
  // Unflagged, an admin adding the column up chases money that does not exist.
  it('flags a balance that is shared with another hatian', async () => {
    await openPanel();
    expect(screen.getByTestId('balance-o2')).toHaveTextContent(/also in another hatian/i);
    expect(screen.getByTestId('balance-o1')).not.toHaveTextContent(/also in another hatian/i);
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
