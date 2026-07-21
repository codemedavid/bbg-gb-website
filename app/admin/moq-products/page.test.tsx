// Admin management for the MOQ shelf.
//
// The client asked to verify that admins can add, edit and delete MOQ products.
// The API routes already prove the server contract; this covers the screen that
// drives them — chiefly that the multipart body it builds actually carries what
// the admin typed, since a field dropped here fails silently rather than
// erroring.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import type { ReactElement } from 'react';
import type { MoqProduct } from '@/lib/types';

// Destructive actions now route through the shared ConfirmProvider, so the page
// must render inside it for the warn-before-delete dialog to work.
const render = (ui: ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);

let shelf: { data: MoqProduct[]; isLoading: boolean } = { data: [], isLoading: false };
const saveMutate = vi.fn();
const deleteMutate = vi.fn();
let savePending = false;

vi.mock('@/lib/admin-api', () => ({
  useAdminMoqProducts: () => shelf,
  useMutate: () => ({
    saveMoqProduct: { mutateAsync: saveMutate, isPending: savePending },
    deleteMoqProduct: { mutateAsync: deleteMutate },
  }),
}));

const AdminMoqProductsPage = (await import('./page')).default;

const product = (o: Partial<MoqProduct> = {}): MoqProduct => ({
  id: 'm1', name: 'FUAN GTT1500', spec: '1500mg', description: 'Bulk peptide.',
  imageUrl: null, imageEmoji: '🧪', pricePhp: '4500.00', priceUsd: null,
  stock: 40, minOrderQty: 5, packingFeePhp: null, arrivalGroup: 'white_powder',
  isActive: true, sortOrder: 1, inStock: true,
  ...o,
});

// The FormData the page handed to the save mutation on its Nth call.
const savedBody = (call = 0): FormData => saveMutate.mock.calls[call][0].body as FormData;
const savedId = (call = 0): string | undefined => saveMutate.mock.calls[call][0].id;

const openAddForm = async () => userEvent.click(screen.getByRole('button', { name: /add product/i }));
const submitForm = async () => userEvent.click(screen.getByRole('button', { name: /save product/i }));

beforeEach(() => {
  shelf = { data: [], isLoading: false };
  saveMutate.mockReset().mockResolvedValue(undefined);
  deleteMutate.mockReset().mockResolvedValue(undefined);
  savePending = false;
});

describe('shelf listing', () => {
  it('shows a loading state while the shelf is fetching', () => {
    shelf = { data: [], isLoading: true };
    render(<AdminMoqProductsPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('invites the admin to add the first product when the shelf is empty', () => {
    render(<AdminMoqProductsPage />);
    expect(screen.getByText(/no moq products yet/i)).toBeInTheDocument();
  });

  it('lists each product with its price, stock and minimum order quantity', () => {
    shelf = { data: [product({ pricePhp: '4500.00', stock: 40, minOrderQty: 5 })], isLoading: false };
    render(<AdminMoqProductsPage />);

    expect(screen.getByText('FUAN GTT1500')).toBeInTheDocument();
    expect(screen.getByText(/4,500/)).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('marks an archived product so the admin can tell it is off the shelf', () => {
    shelf = { data: [product({ isActive: false })], isLoading: false };
    render(<AdminMoqProductsPage />);
    expect(screen.getByText(/archived/i)).toBeInTheDocument();
  });

  it('renders the uploaded image when there is one, and the emoji otherwise', () => {
    shelf = {
      data: [product({ id: 'a', name: 'With image', imageUrl: 'https://cdn.test/x.png' }),
             product({ id: 'b', name: 'No image', imageUrl: null, imageEmoji: '🧪' })],
      isLoading: false,
    };
    render(<AdminMoqProductsPage />);

    expect(screen.getByRole('img', { name: 'With image' })).toHaveAttribute('src', 'https://cdn.test/x.png');
    expect(screen.getByText('🧪')).toBeInTheDocument();
  });
});

describe('adding a product', () => {
  it('submits everything the admin typed', async () => {
    render(<AdminMoqProductsPage />);
    await openAddForm();

    await userEvent.type(screen.getByLabelText(/^name$/i), 'TR30 + CGL5 Blends');
    await userEvent.type(screen.getByLabelText(/^spec$/i), 'TR30 + CGL5');
    await userEvent.type(screen.getByLabelText(/description/i), 'Salt blend.');
    await userEvent.clear(screen.getByLabelText(/price/i));
    await userEvent.type(screen.getByLabelText(/price/i), '5200');
    await userEvent.clear(screen.getByLabelText(/^stock$/i));
    await userEvent.type(screen.getByLabelText(/^stock$/i), '25');
    await userEvent.clear(screen.getByLabelText(/min order qty/i));
    await userEvent.type(screen.getByLabelText(/min order qty/i), '5');

    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    const body = savedBody();
    expect(body.get('name')).toBe('TR30 + CGL5 Blends');
    expect(body.get('spec')).toBe('TR30 + CGL5');
    expect(body.get('description')).toBe('Salt blend.');
    expect(body.get('pricePhp')).toBe('5200');
    expect(body.get('stock')).toBe('25');
    expect(body.get('minOrderQty')).toBe('5');
  });

  it('creates rather than updates — no id is sent', async () => {
    render(<AdminMoqProductsPage />);
    await openAddForm();
    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Product');
    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(savedId()).toBeUndefined();
  });

  it('omits a blank packing fee so the global MOQ default applies', async () => {
    render(<AdminMoqProductsPage />);
    await openAddForm();
    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Product');
    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    // Absent, not '0' — zero would mean a genuinely free packing fee.
    expect(savedBody().has('packingFeePhp')).toBe(false);
  });

  it('sends a packing fee when the admin sets one', async () => {
    render(<AdminMoqProductsPage />);
    await openAddForm();
    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Product');
    await userEvent.type(screen.getByLabelText(/packing fee/i), '450');
    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(savedBody().get('packingFeePhp')).toBe('450');
  });

  it('defaults a new product to visible with a minimum order quantity of 1', async () => {
    render(<AdminMoqProductsPage />);
    await openAddForm();
    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Product');
    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(savedBody().get('isActive')).toBe('true');
    expect(savedBody().get('minOrderQty')).toBe('1');
  });

  it('attaches a chosen image to the upload', async () => {
    render(<AdminMoqProductsPage />);
    await openAddForm();
    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Product');

    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/image/i), file);
    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(savedBody().get('image')).toBeInstanceOf(File);
  });

  it('sends no image part when the admin picks none', async () => {
    render(<AdminMoqProductsPage />);
    await openAddForm();
    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Product');
    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(savedBody().has('image')).toBe(false);
  });

  it('closes the form once the save succeeds', async () => {
    render(<AdminMoqProductsPage />);
    await openAddForm();
    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Product');
    await submitForm();

    await waitFor(() => expect(screen.queryByRole('button', { name: /save product/i })).not.toBeInTheDocument());
  });

  it('keeps the form open and shows the error when the save fails', async () => {
    saveMutate.mockRejectedValue(new Error('Name is too short.'));
    render(<AdminMoqProductsPage />);
    await openAddForm();
    await userEvent.type(screen.getByLabelText(/^name$/i), 'X');
    await submitForm();

    expect(await screen.findByRole('alert')).toHaveTextContent(/name is too short/i);
    // The admin's typing must survive the failure.
    expect(screen.getByRole('button', { name: /save product/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('X');
  });

  it('abandons the draft when the admin cancels', async () => {
    render(<AdminMoqProductsPage />);
    await openAddForm();
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Discard me');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('button', { name: /save product/i })).not.toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });
});

describe('editing a product', () => {
  it('prefills the form from the product being edited', async () => {
    shelf = { data: [product({ name: 'FUAN GTT1500', pricePhp: '4500.00', stock: 40, minOrderQty: 5 })], isLoading: false };
    render(<AdminMoqProductsPage />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.getByRole('heading', { name: /edit moq product/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('FUAN GTT1500');
    expect(screen.getByLabelText(/^stock$/i)).toHaveValue(40);
    expect(screen.getByLabelText(/min order qty/i)).toHaveValue(5);
  });

  it('updates the existing product rather than creating a new one', async () => {
    shelf = { data: [product({ id: 'm1' })], isLoading: false };
    render(<AdminMoqProductsPage />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.clear(screen.getByLabelText(/^name$/i));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Renamed');
    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(savedId()).toBe('m1');
    expect(savedBody().get('name')).toBe('Renamed');
  });

  it('carries an existing packing fee through an edit', async () => {
    shelf = { data: [product({ packingFeePhp: '450.00' })], isLoading: false };
    render(<AdminMoqProductsPage />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(savedBody().get('packingFeePhp')).toBe('450.00');
  });

  it('archives a product by unticking visibility', async () => {
    shelf = { data: [product({ isActive: true })], isLoading: false };
    render(<AdminMoqProductsPage />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /visible on the moq page/i }));
    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(savedBody().get('isActive')).toBe('false');
  });

  it('sends no image part on an edit that does not replace the image', async () => {
    shelf = { data: [product({ imageUrl: 'https://cdn.test/x.png' })], isLoading: false };
    render(<AdminMoqProductsPage />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await submitForm();

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    // Omitting the part is what tells the server to keep the current image.
    expect(savedBody().has('image')).toBe(false);
  });
});

describe('deleting a product', () => {
  it('deletes once the admin confirms in the dialog', async () => {
    shelf = { data: [product({ id: 'm1' })], isLoading: false };
    render(<AdminMoqProductsPage />);

    // The card button only opens the warning; the mutation waits for confirm.
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteMutate).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete product' }));

    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('m1'));
  });

  it('names the product in the confirmation dialog', async () => {
    shelf = { data: [product({ name: 'FUAN GTT1500' })], isLoading: false };
    render(<AdminMoqProductsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('FUAN GTT1500');
  });

  it('does not delete when the admin backs out', async () => {
    shelf = { data: [product()], isLoading: false };
    render(<AdminMoqProductsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it('deletes the product the admin actually clicked', async () => {
    shelf = {
      data: [product({ id: 'a', name: 'First' }), product({ id: 'b', name: 'Second' })],
      isLoading: false,
    };
    render(<AdminMoqProductsPage />);

    const secondCard = screen.getByText('Second').closest('div.rounded-2xl') as HTMLElement;
    await userEvent.click(within(secondCard).getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete product' }));

    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('b'));
  });
});

describe('save in flight', () => {
  it('disables the submit button while the save is pending', async () => {
    savePending = true;
    render(<AdminMoqProductsPage />);
    await openAddForm();

    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });
});
