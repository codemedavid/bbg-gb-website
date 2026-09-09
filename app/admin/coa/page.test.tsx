// The admin COA screen — the upload the whole page exists for.
//
// What only this test can prove is the FIELD-NAME contract with the route. The
// certificate is read from the multipart field `file` (app/api/admin/coa/route.ts);
// a form that sends the same bytes under any other name gets back "An image file
// is required.", which an admin would read as their PNG being rejected as a PNG.
// The API test cannot catch that — it builds its own FormData — so it is pinned
// here, the way the MOQ form contract is.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog';

// Deleting routes through the shared ConfirmProvider, so the page must render
// inside it.
const render = (ui: ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);

const saveMutate = vi.fn();
const deleteMutate = vi.fn();
const files = { current: [] as unknown[] };

vi.mock('@/lib/admin-api', () => ({
  useAdminCoaFiles: () => ({ data: files.current, isLoading: false }),
  useAdminProducts: () => ({ data: [{ id: 'p1', name: 'Retatrutide 10mg' }], isLoading: false }),
  useMutate: () => ({
    saveCoaFile: { mutateAsync: saveMutate, isPending: false },
    deleteCoaFile: { mutate: deleteMutate },
  }),
}));

const Page = (await import('./page')).default;

const coa = (over: Record<string, unknown> = {}) => ({
  id: 'c1', label: 'Retatrutide 10mg — Sept batch', batch: 'A24',
  productId: 'p1', productName: 'Retatrutide 10mg',
  fileUrl: '/api/files/coa-files/reta-a24.png', isImage: true,
  uploadedAt: '2026-09-01T12:00:00.000Z', ...over,
});

// Puts a real File on the hidden input, the same way the payment-method QR test
// does — jsdom will not let a test type into a file picker.
const pickFile = (name = 'reta-a24.png', type = 'image/png') => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([Buffer.from('fake-png-bytes')], name, { type });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  return file;
};

const openForm = async () => {
  fireEvent.click(screen.getByRole('button', { name: /upload coa/i }));
  await screen.findByText('Upload COA');
};

beforeEach(() => {
  saveMutate.mockReset();
  deleteMutate.mockReset();
  files.current = [];
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
});

describe('AdminCoaPage', () => {
  it('sends the certificate under the field the route reads, with its label and batch', async () => {
    render(<Page />);
    await openForm();

    const file = pickFile('reta-a24.png');
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: 'Retatrutide 10mg — Sept batch' } });
    fireEvent.change(screen.getByLabelText(/^Batch/), { target: { value: 'A24' } });
    fireEvent.change(screen.getByLabelText(/^Product/), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    expect(saveMutate).toHaveBeenCalledTimes(1);
    const body = saveMutate.mock.calls[0][0] as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('label')).toBe('Retatrutide 10mg — Sept batch');
    expect(body.get('batch')).toBe('A24');
    expect(body.get('productId')).toBe('p1');
  });

  it('refuses to upload a COA row with no document', async () => {
    render(<Page />);
    await openForm();

    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: 'Retatrutide 10mg' } });
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/choose the COA image/i);
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it('shows the failure reason in the form when the upload is rejected', async () => {
    // The real 503 from a deploy whose STORAGE_DRIVER is unset — the failure this
    // project has actually shipped, and one an admin can act on if they read it.
    saveMutate.mockRejectedValue(new Error('File uploads are not configured: STORAGE_DRIVER is unset.'));
    render(<Page />);
    await openForm();
    pickFile();

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/uploads are not configured/i);
  });

  it('asks before pulling a certificate off the public page, then pulls it', async () => {
    files.current = [coa({ id: 'c9', label: 'Wrong file' })];
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: /delete wrong file/i }));
    const confirmBox = await screen.findByRole('alertdialog');
    expect(confirmBox).toHaveTextContent(/cannot be undone/i);
    expect(deleteMutate).not.toHaveBeenCalled();

    fireEvent.click(within(confirmBox).getByRole('button', { name: /delete coa/i }));

    // The confirm resolves a promise, so the delete lands a tick after the click.
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('c9'));
  });

  it('links each certificate to this site rather than to a storage host', async () => {
    files.current = [coa({ fileUrl: '/api/files/coa-files/reta-a24.png' })];
    render(<Page />);

    expect(screen.getByRole('link', { name: /^Open Retatrutide/ }))
      .toHaveAttribute('href', '/api/files/coa-files/reta-a24.png');
  });
});
