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
      contactPhone: '09171234567', shippingAddress: '123 Mabini St, Manila',
      vials: 3, committedAt: new Date('2026-07-01T14:30:00Z').toISOString(),
      orderBalancePhp: 2550, spansOtherHatians: false, downpaymentPhp: 150, amountPaidPhp: 150,
      downpayment: 'paid', finalPayment: 'unpaid', packingFee: 'unpaid',
      paymentMethod: 'GoTyme', proofUrl: '/api/files/proofs/ana.png', settledAt: null,
    },
    {
      orderId: 'o2', orderNo: 'BBG-2419', orderStatus: 'batch_filling',
      customerName: 'Ben Reyes', customerEmail: 'ben@example.com', customerPhone: null,
      contactPhone: '09990001111', shippingAddress: '7 Rizal Ave, Cebu City',
      vials: 2, committedAt: new Date('2026-07-02T09:00:00Z').toISOString(),
      orderBalancePhp: 1650, spansOtherHatians: true, downpaymentPhp: 150, amountPaidPhp: 1800,
      downpayment: 'paid', finalPayment: 'paid', packingFee: 'paid',
      paymentMethod: 'BDO', proofUrl: null,
      settledAt: new Date('2026-07-10').toISOString(),
    },
  ],
};

// The board the page renders. Mutable so a test can ask what the page does with
// a board that has nothing running on it.
const OPEN_HATIAN = {
  id: 'gb1', name: 'Bioglutide', pricePerKitPhp: '10400', totalSlots: 10,
  claimedSlots: 5, minVials: 1, repackFeePhp: '150', status: 'open', arrivalGroup: 'white_powder',
};
const board: { current: Record<string, unknown>[] } = { current: [OPEN_HATIAN] };
const startCycleMutate = vi.fn();

vi.mock('@/lib/admin-api', () => ({
  useAdminGroupBuys: () => ({ data: board.current, isLoading: false }),
  useAdminGroupBuyCommitments: () => ({ data: commitments.current, isLoading: false }),
  useMutate: () => ({
    saveGroupBuy: { mutateAsync: saveMutate, mutate: vi.fn(), isPending: false },
    deleteGroupBuy: { mutate: vi.fn() },
    startKahatiCycle: { mutate: startCycleMutate, isPending: false },
  }),
}));

const Page = (await import('./page')).default;

beforeEach(() => {
  saveMutate.mockReset();
  startCycleMutate.mockReset();
  board.current = [OPEN_HATIAN];
});

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

  // Everything the admin needs to pack and ship the parcel, without leaving the
  // panel for the orders screen and losing their place in the batch.
  it('shows how to reach each participant and where the parcel goes', async () => {
    await openPanel();
    expect(screen.getByTestId('contact-o1')).toHaveTextContent('09171234567');
    expect(screen.getByTestId('address-o1')).toHaveTextContent('123 Mabini St, Manila');
    expect(screen.getByTestId('address-o2')).toHaveTextContent('7 Rizal Ave, Cebu City');
  });

  // Paid and still-owed are two different questions. Showing only the balance
  // makes a customer who has paid their downpayment look like one who has paid
  // nothing.
  it('separates what a participant has paid from what they still owe', async () => {
    await openPanel();
    expect(screen.getByTestId('amount-paid-o1')).toHaveTextContent('₱150');
    expect(screen.getByTestId('balance-o1')).toHaveTextContent('₱2,550');
  });

  it('shows how each participant paid and the state of their order', async () => {
    await openPanel();
    expect(screen.getByTestId('payment-method-o1')).toHaveTextContent('GoTyme');
    expect(screen.getByTestId('payment-method-o2')).toHaveTextContent('BDO');
    expect(screen.getByTestId('order-status-o1')).toHaveTextContent(/payment confirmed/i);
  });

  describe('proof of payment', () => {
    // Verifying a proof is the admin's most repeated action in this panel. A
    // thumbnail they can scan down the column beats a link they must open.
    it('renders each uploaded proof as a thumbnail', async () => {
      await openPanel();
      const thumb = screen.getByTestId('proof-o1');
      expect(thumb).toHaveAttribute('src', '/api/files/proofs/ana.png');
      // Explicit dimensions — a column of proofs loading at their natural size
      // reflows the whole table.
      expect(thumb).toHaveAttribute('width');
      expect(thumb).toHaveAttribute('height');
    });

    it('says so plainly when a participant uploaded no proof', async () => {
      await openPanel();
      expect(screen.queryByTestId('proof-o2')).not.toBeInTheDocument();
      expect(screen.getByTestId('proof-cell-o2')).toHaveTextContent(/no proof/i);
    });

    // A thumbnail is too small to read a reference number off. Opening it large
    // is the whole point of showing it.
    it('opens the proof full size when clicked', async () => {
      await openPanel();
      fireEvent.click(screen.getByRole('button', { name: /view proof of payment from ana cruz/i }));

      const lightbox = await screen.findByTestId('proof-lightbox');
      expect(lightbox).toBeInTheDocument();
      expect(screen.getByTestId('proof-lightbox-image')).toHaveAttribute('src', '/api/files/proofs/ana.png');
    });

    it('closes the enlarged proof and leaves the panel open behind it', async () => {
      await openPanel();
      fireEvent.click(screen.getByRole('button', { name: /view proof of payment from ana cruz/i }));
      await screen.findByTestId('proof-lightbox');

      fireEvent.click(screen.getByRole('button', { name: /close proof/i }));

      expect(screen.queryByTestId('proof-lightbox')).not.toBeInTheDocument();
      expect(screen.getByTestId('group-buy-details')).toBeInTheDocument();
    });
  });

  describe('batch summary', () => {
    it('totals the batch under the participants table', async () => {
      await openPanel();
      const summary = screen.getByTestId('batch-summary');
      expect(summary).toHaveTextContent(/total participants/i);
      expect(screen.getByTestId('summary-participants')).toHaveTextContent('2');
      expect(screen.getByTestId('summary-vials-reserved')).toHaveTextContent('5');
      expect(screen.getByTestId('summary-vials-remaining')).toHaveTextContent('5');
    });

    // 5 vials at ₱10,400 a kit of ten — the counter's own price, not the sum of
    // the balance column, which double-counts an order spanning two hatians.
    it('values the batch at this counter s per-vial price', async () => {
      await openPanel();
      expect(screen.getByTestId('summary-gross-income')).toHaveTextContent('₱5,200');
    });

    it('splits the participants into confirmed, pending and cancelled', async () => {
      await openPanel();
      expect(screen.getByTestId('summary-confirmed')).toHaveTextContent('1');
      expect(screen.getByTestId('summary-pending')).toHaveTextContent('1');
      expect(screen.getByTestId('summary-cancelled')).toHaveTextContent('0');
    });

    // The client's rule: a cancelled order's money is not coming and its vials
    // must not be ordered from the supplier.
    it('keeps a cancelled order out of the vials reserved and the gross income', async () => {
      const joined = commitments.current;
      commitments.current = [
        ...joined,
        {
          ...joined[0], orderId: 'o3', orderNo: 'BBG-2420', orderStatus: 'cancelled',
          customerName: 'Cara Lim', vials: 4,
          downpayment: 'cancelled', finalPayment: 'cancelled', packingFee: 'cancelled',
        },
      ];
      try {
        await openPanel();
        expect(screen.getByTestId('summary-participants')).toHaveTextContent('3');
        expect(screen.getByTestId('summary-cancelled')).toHaveTextContent('1');
        // Still 5 vials and ₱5,200 — the cancelled 4 vials count for neither.
        expect(screen.getByTestId('summary-vials-reserved')).toHaveTextContent('5');
        expect(screen.getByTestId('summary-gross-income')).toHaveTextContent('₱5,200');
      } finally {
        commitments.current = joined;
      }
    });
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

  // Was a "1 of 2 fully settled" banner above the table. The batch summary now
  // answers the same question in the same place as every other total, and does
  // it without conflating a cancelled order with an unpaid one — so the banner
  // went rather than being kept alongside a second count of the same thing.
  it('counts the participants who have not settled yet', async () => {
    await openPanel();
    expect(screen.getByTestId('summary-confirmed')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-pending')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-participants')).toHaveTextContent('2');
  });
});

// Ending a whole trading cycle from the board.
//
// The Group Buy campaigns board has had this control for a while; the hatian
// board had not, so an admin closing out a cycle pressed Close on every card in
// turn — and Close opens no successor, so each counter left the board instead of
// reopening empty for the next cycle.
describe('start new cycle', () => {
  // Confirmed, not immediate: this ends every counter on the board at once, and
  // a stray click on the header must not be able to do that.
  it('ends the cycle once the admin confirms', async () => {
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: /start new cycle/i }));
    await screen.findByText(/end all/i);
    fireEvent.click(screen.getByRole('button', { name: /end all/i }));

    await vi.waitFor(() => expect(startCycleMutate).toHaveBeenCalledTimes(1));
  });

  it('leaves the board alone when the admin backs out', async () => {
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: /start new cycle/i }));
    fireEvent.click(await screen.findByRole('button', { name: /keep the board/i }));

    await vi.waitFor(() => expect(screen.queryByText(/end all/i)).not.toBeInTheDocument());
    expect(startCycleMutate).not.toHaveBeenCalled();
  });

  // Nothing running means nothing to end, so the control stays off the board
  // rather than sitting there as a no-op.
  it('hides the control when no counter is open', () => {
    board.current = [{ ...OPEN_HATIAN, status: 'closed' }];

    render(<Page />);

    expect(screen.queryByRole('button', { name: /start new cycle/i })).not.toBeInTheDocument();
  });

  it('says how many counters are about to end', async () => {
    board.current = [OPEN_HATIAN, { ...OPEN_HATIAN, id: 'gb2', name: 'KLOW 80mg' }];

    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /start new cycle/i }));

    expect(await screen.findByText(/2 counters/i)).toBeInTheDocument();
  });
});

// Finding one counter on a board that grows a sibling per cycle.
//
// Every cycle seals each counter and opens a fresh one beside it, so a board
// that started at five rows is eleven after one cycle and keeps climbing — all
// of them carrying the same handful of names.
describe('board search', () => {
  const setBoard = (...names: string[]) => {
    board.current = names.map((name, i) => ({ ...OPEN_HATIAN, id: `gb${i + 1}`, name }));
  };

  it('shows only the counters whose name matches', () => {
    setBoard('Bioglutide', 'KLOW 80mg', 'Retatrutide 20mg');

    render(<Page />);
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'KLOW' } });

    expect(screen.getByText('KLOW 80mg')).toBeInTheDocument();
    expect(screen.queryByText('Bioglutide')).not.toBeInTheDocument();
    expect(screen.queryByText('Retatrutide 20mg')).not.toBeInTheDocument();
  });

  // An admin types what they remember, not what the row is titled.
  it('matches case-insensitively and on part of the name', () => {
    setBoard('Bioglutide', 'KLOW 80mg');

    render(<Page />);
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'glut' } });

    expect(screen.getByText('Bioglutide')).toBeInTheDocument();
    expect(screen.queryByText('KLOW 80mg')).not.toBeInTheDocument();
  });

  // A blank board and a board with no matches look identical otherwise, and the
  // admin has no way to tell a typo from an empty cycle.
  it('says so when nothing matches, naming what was searched for', () => {
    setBoard('Bioglutide', 'KLOW 80mg');

    render(<Page />);
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'zzz' } });

    expect(screen.getByText(/no counter matches/i)).toHaveTextContent('zzz');
  });

  it('brings the whole board back when the search is cleared', () => {
    setBoard('Bioglutide', 'KLOW 80mg');

    render(<Page />);
    const box = screen.getByLabelText(/search/i);
    fireEvent.change(box, { target: { value: 'KLOW' } });
    fireEvent.change(box, { target: { value: '' } });

    expect(screen.getByText('Bioglutide')).toBeInTheDocument();
    expect(screen.getByText('KLOW 80mg')).toBeInTheDocument();
  });

  // The cycle control acts on the BOARD, not on the view. If a search narrowed
  // the count it reports, an admin who searched one name would be told they are
  // ending one counter and would in fact end every open counter there is.
  it('keeps the cycle control counting the whole board, not the filtered view', async () => {
    setBoard('Bioglutide', 'KLOW 80mg', 'Retatrutide 20mg');

    render(<Page />);
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'KLOW' } });
    fireEvent.click(screen.getByRole('button', { name: /start new cycle/i }));

    // Scoped to the dialog's heading: the filtered board also reports a count
    // ("1 of 3 counters"), and a bare text match would pass on that instead.
    expect(await screen.findByRole('heading', { name: /3 counters/i })).toBeInTheDocument();
  });

  // Nothing to search means nothing to search through.
  it('hides the search box when the board is empty', () => {
    board.current = [];

    render(<Page />);

    expect(screen.queryByLabelText(/search/i)).not.toBeInTheDocument();
  });
});
