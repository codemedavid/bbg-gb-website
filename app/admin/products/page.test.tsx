// A rejected product save must show its reason inside the form — same silent
// failure as the group-buy form: the submit awaited mutateAsync with no catch,
// so a server rejection left the modal open with no explanation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog';

const render = (ui: ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);

const saveMutate = vi.fn();
vi.mock('@/lib/admin-api', () => ({
  useAdminProducts: () => ({ data: [], isLoading: false }),
  useAdminCategories: () => ({ data: [], isLoading: false }),
  useMutate: () => ({
    saveProduct: { mutateAsync: saveMutate, isPending: false },
    archiveProduct: { mutate: vi.fn() },
  }),
}));

const Page = (await import('./page')).default;

beforeEach(() => saveMutate.mockReset());

describe('AdminProductsPage', () => {
  it('shows the failure reason in the form when a save is rejected', async () => {
    saveMutate.mockRejectedValue(new Error('name: String must contain at least 2 character(s)'));
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: /new product/i }));
    await screen.findByText('New product');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 2 character/i);
    // The form stays open so the admin can correct the fields.
    expect(screen.getByText('New product')).toBeInTheDocument();
  });
});
