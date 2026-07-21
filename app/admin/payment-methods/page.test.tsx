import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
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

    const textInputs = Array.from(document.querySelectorAll('input')).filter((i) => i.type !== 'file' && i.type !== 'checkbox' && i.type !== 'number');
    fireEvent.change(textInputs[0], { target: { value: 'GCash' } });        // Label
    fireEvent.change(textInputs[1], { target: { value: 'BBG Peptides' } }); // Account name
    fireEvent.change(textInputs[2], { target: { value: '09171234567' } });  // Account number

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([Buffer.from('qr')], 'qr.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/uploads are not configured/i);
    expect(saveMutate).toHaveBeenCalledTimes(1);
  });
});
