import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog';

// Destructive actions route through the shared ConfirmProvider, so the page
// must render inside it.
const render = (ui: ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);

// A failing save (e.g. the prod 503 when uploads aren't configured) must show
// its reason inside the form, not silently close or vanish into a toast.
const saveMutate = vi.fn();
vi.mock('@/lib/admin-api', () => ({
  useAdminPaymentMethods: () => ({ data: [], isLoading: false }),
  useMutate: () => ({
    savePaymentMethod: { mutateAsync: saveMutate, isPending: false },
    deletePaymentMethod: { mutate: vi.fn() },
  }),
}));

const Page = (await import('./page')).default;

beforeEach(() => {
  saveMutate.mockReset();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
});

describe('AdminPaymentMethodsPage', () => {
  it('shows the failure reason in the form when a save is rejected', async () => {
    saveMutate.mockRejectedValue(new Error('File uploads are not configured: STORAGE_DRIVER is unset.'));
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: /new method/i }));
    await screen.findByText('New payment method');

    // By caption rather than by position: the form grew a purpose picker whose
    // radios sit ahead of these fields, and an index-based lookup silently
    // started filling the wrong control.
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: 'GCash' } });
    fireEvent.change(screen.getByLabelText(/^Account name/), { target: { value: 'BBG Peptides' } });
    fireEvent.change(screen.getByLabelText(/^Account \/ number/), { target: { value: '09171234567' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([Buffer.from('qr')], 'qr.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Scoped to the form: the page also carries the downpayment-policy card,
    // which raises its own alert when its settings fetch fails.
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/uploads are not configured/i);
    expect(saveMutate).toHaveBeenCalledTimes(1);
  });
});
