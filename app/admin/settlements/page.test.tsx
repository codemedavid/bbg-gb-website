// Admin → Settlements.
//
// Without this page the settlement API has no caller: a customer pays, uploads
// proof, and the row sits at proof_review forever — the packing fee never reads
// Paid, the confirmation email never fires, and the only remedy is hand-editing
// the database.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const confirmMutate = vi.fn();
// A factory, not a shared literal: one test narrows the list to a single row,
// and without a fresh copy per test every later test inherits that narrowing —
// which is exactly how the proof tests below first "failed".
const makeRows = () => [
    {
      id: 's1', status: 'proof_review', packingFeePhp: '150', balancePhp: '4200',
      totalPhp: '4350', paymentMethod: 'GCash', paymentProofKey: 'proofs/a.png',
      proofs: [
        { id: 'sp1', url: 'https://files.example/s1-1.png', sortOrder: 0, amountPhp: null, reference: null },
        { id: 'sp2', url: 'https://files.example/s1-2.png', sortOrder: 1, amountPhp: null, reference: null },
      ],
      createdAt: new Date('2026-07-20T10:00:00Z').toISOString(), paidAt: null,
      customerName: 'Ana Cruz', customerEmail: 'ana@example.com', orderCount: 3,
    },
    {
      id: 's2', status: 'paid', packingFeePhp: '150', balancePhp: '2550',
      totalPhp: '2700', paymentMethod: 'GCash', paymentProofKey: null, proofs: [],
      createdAt: new Date('2026-07-18T10:00:00Z').toISOString(),
      paidAt: new Date('2026-07-19T10:00:00Z').toISOString(),
      customerName: 'Ben Reyes', customerEmail: 'ben@example.com', orderCount: 1,
    },
] as unknown[];

const rows = { current: makeRows() };

vi.mock('@/lib/admin-api', () => ({
  useAdminSettlements: () => ({ data: rows.current, isLoading: false }),
  useMutate: () => ({
    setSettlementStatus: { mutateAsync: confirmMutate, mutate: confirmMutate, isPending: false },
  }),
}));

const Page = (await import('./page')).default;

beforeEach(() => {
  confirmMutate.mockReset();
  confirmMutate.mockResolvedValue({});
  rows.current = makeRows();
});

describe('AdminSettlementsPage', () => {
  it('lists each final checkout with the customer and what it covers', () => {
    render(<Page />);
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument();
    expect(screen.getByText('Ben Reyes')).toBeInTheDocument();
    // The order count is what shows one fee covered several hatian orders.
    expect(screen.getByTestId('order-count-s1')).toHaveTextContent('3');
  });

  it('offers to confirm a settlement that is awaiting verification', async () => {
    render(<Page />);
    const confirm = screen.getByRole('button', { name: /confirm/i });
    confirm.click();
    await waitFor(() => expect(confirmMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', status: 'paid' }),
    ));
  });

  it('does not offer to confirm one that is already paid', () => {
    rows.current = [rows.current[1]];
    render(<Page />);
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
  });
});

// A settlement is the biggest single payment a customer makes, so it is the one
// most often split across transfers — and the admin verifying it needs all of
// them, not the first.
describe('AdminSettlementsPage — payment proofs', () => {
  it('links every proof a settlement carries', () => {
    render(<Page />);

    expect(screen.getByRole('link', { name: /proof #1/i })).toHaveAttribute('href', 'https://files.example/s1-1.png');
    expect(screen.getByRole('link', { name: /proof #2/i })).toHaveAttribute('href', 'https://files.example/s1-2.png');
  });

  it('opens them in a new tab rather than navigating out of the queue', () => {
    render(<Page />);

    expect(screen.getByRole('link', { name: /proof #1/i })).toHaveAttribute('target', '_blank');
  });

  it('says so for a settlement with no proof rather than leaving the cell blank', () => {
    render(<Page />);

    expect(screen.getByText(/no proof/i)).toBeInTheDocument();
  });
});
