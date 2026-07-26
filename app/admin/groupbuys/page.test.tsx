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
vi.mock('@/lib/admin-api', () => ({
  useAdminGroupBuys: () => ({
    data: [{
      id: 'gb1', name: 'Bioglutide', pricePerKitPhp: '10400', totalSlots: 10,
      claimedSlots: 5, minVials: 1, repackFeePhp: '150', status: 'open', arrivalGroup: 'white_powder',
    }],
    isLoading: false,
  }),
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
