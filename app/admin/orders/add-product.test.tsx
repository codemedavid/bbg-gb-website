// The admin order editor adding a real catalog product.
//
// The editor could already add a line, but only a free-text one: a typed name
// and a typed price with no product behind it, which drew no stock and reached
// the weekly batch order as an uncoded row with a kit size of 1. Picking a
// product instead is what makes an admin-added line behave like one checkout
// wrote — and the browser must not be the thing that decides its price.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const editOrderItems = { mutateAsync: vi.fn(async () => ({})), isPending: false };

const order = {
  id: 'o1', orderNo: 'BBG-2418', status: 'proof_review', buyType: 'solo',
  subtotalPhp: '550', packingFeePhp: '150', totalPhp: '700', shippingPhp: '0', repackFeePhp: '0',
  downpaymentPhp: '0', shipName: 'Ana', shipPhone: '0917', shipAddress: 'QC',
  courier: null, packedBy: null, paymentMethod: 'GCash', trackingNo: null, notes: null,
  createdAt: new Date('2026-08-01').toISOString(), paymentProofKey: null,
};

const items = [{
  id: 'i1', orderId: 'o1', kind: 'product', nameSnapshot: 'Tirzepatide 10mg',
  specSnapshot: 'On-hand · per piece', qty: 1, unitPricePhp: '550', lineTotalPhp: '550',
  productId: 'p1', groupBuyId: null, moqCampaignId: null, moqProductId: null, unitPriceUsd: null,
}];

const catalog = [
  { id: 'p1', name: 'Tirzepatide', spec: '10mg', stock: 40 },
  { id: 'p2', name: 'Retatrutide', spec: '20mg', stock: 12 },
];

vi.mock('@/lib/admin-api', () => ({
  useAdminOrders: () => ({
    data: [{
      id: 'o1', orderNo: 'BBG-2418', shipName: 'Ana', customerEmail: 'a@x.com',
      buyType: 'solo', totalPhp: '700.00', status: 'proof_review', createdAt: '2026-08-01T10:00:00Z',
    }],
    isLoading: false,
  }),
  useAdminProducts: () => ({ data: catalog }),
  useAdminOrder: () => ({
    data: { order, items, customer: { name: 'Ana', email: 'a@x.com', phone: '0917' }, history: [], proofUrl: null, proofs: [] },
    isLoading: false,
  }),
  useMutate: () => ({ editOrderItems, setOrderStatus: { mutateAsync: vi.fn(), isPending: false } }),
}));

const Page = (await import('./page')).default;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

/** Open the order sheet and put the item editor into edit mode. */
async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  render(<Page />, { wrapper });
  await user.click(await screen.findByText('BBG-2418'));
  await user.click(await screen.findByRole('button', { name: /edit, add, or delete items/i }));
}

beforeEach(() => {
  editOrderItems.mutateAsync.mockClear();
});

describe('admin order editor — adding a catalog product', () => {
  it('offers the catalog as a picker, not a free-text box', async () => {
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole('button', { name: /add product/i }));

    const picker = screen.getByLabelText('Item 2 product');
    expect(picker).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /Retatrutide 20mg/ })).toBeInTheDocument();
  });

  it('shows how much stock is left beside each product', async () => {
    const user = userEvent.setup();
    await openEditor(user);
    await user.click(screen.getByRole('button', { name: /add product/i }));

    expect(screen.getByRole('option', { name: /Retatrutide 20mg · 12 in stock/ })).toBeInTheDocument();
  });

  it('posts the product id and unit rather than a name and a price', async () => {
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole('button', { name: /add product/i }));
    await user.selectOptions(screen.getByLabelText('Item 2 product'), 'p2');
    await user.selectOptions(screen.getByLabelText('Item 2 unit'), 'kit');
    await user.clear(screen.getByLabelText('Item 2 quantity'));
    await user.type(screen.getByLabelText('Item 2 quantity'), '3');
    await user.click(screen.getByRole('button', { name: /save items/i }));

    expect(editOrderItems.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: 'o1',
      items: expect.arrayContaining([
        expect.objectContaining({ productId: 'p2', unit: 'kit', qty: 3 }),
      ]),
    }));
  });

  // An unpicked row would post as a nameless manual line — a blank row with a
  // price on the customer's receipt.
  it('refuses to save a product row with no product picked', async () => {
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole('button', { name: /add product/i }));
    await user.click(screen.getByRole('button', { name: /save items/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/pick a product/i);
    expect(editOrderItems.mutateAsync).not.toHaveBeenCalled();
  });

  // Not every correction has a catalog row behind it, so the free-text path has
  // to survive alongside the picker.
  it('still offers a free-text manual line', async () => {
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole('button', { name: /add manual line/i }));
    await user.type(screen.getByLabelText('Item 2 name'), 'Courier surcharge');
    await user.clear(screen.getByLabelText('Item 2 unit price'));
    await user.type(screen.getByLabelText('Item 2 unit price'), '120');
    await user.click(screen.getByRole('button', { name: /save items/i }));

    expect(editOrderItems.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({ nameSnapshot: 'Courier surcharge', unitPricePhp: 120 }),
      ]),
    }));
  });

  it('deletes a line the admin removes', async () => {
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(screen.getByRole('button', { name: /add manual line/i }));
    await user.click(screen.getByLabelText('Delete item 2'));

    expect(screen.queryByLabelText('Item 2 name')).not.toBeInTheDocument();
  });
});
