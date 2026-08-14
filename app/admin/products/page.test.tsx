// A rejected product save must show its reason inside the form — same silent
// failure as the group-buy form: the submit awaited mutateAsync with no catch,
// so a server rejection left the modal open with no explanation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog';

const render = (ui: ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);

const saveMutate = vi.fn();
const catalog: { rows: unknown[] } = { rows: [] };
vi.mock('@/lib/admin-api', () => ({
  useAdminProducts: () => ({ data: catalog.rows, isLoading: false }),
  useAdminCategories: () => ({ data: [], isLoading: false }),
  useMutate: () => ({
    saveProduct: { mutateAsync: saveMutate, isPending: false },
    archiveProduct: { mutate: vi.fn() },
  }),
}));

const Page = (await import('./page')).default;

beforeEach(() => { saveMutate.mockReset(); catalog.rows = []; });

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

// Item 2/6 — the Group Buy Configuration section.
//
// The five settings belong to the product so an admin types a peptide's group
// buy terms once. Until now there was nowhere to type them: the columns existed
// and lib/pricing.ts read them, but the only form that writes a product stopped
// at the on-hand prices, so every seeded listing fell back to the global
// defaults and the seeding rules were dead code in practice.
describe('AdminProductsPage — group buy configuration', () => {
  const openNewProduct = async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /new product/i }));
    await screen.findByText('New product');
  };

  // The Sales Channels section: three independent switches, one per channel.
  const enableGroupBuy = () => fireEvent.click(screen.getByLabelText('Group Buy'));

  const type = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  // Awaited rather than read straight after the click: submit closes the modal
  // once the mutation resolves, and asserting before that leaves a React state
  // update running outside the test's act() scope.
  const savedPayload = async () => {
    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    return saveMutate.mock.calls[0][0];
  };

  const product = (overrides: Record<string, unknown> = {}) => ({
    id: 'p1', code: 'RETA', name: 'Retatrutide', spec: '10mg', pricePhp: '3200', priceUsd: null,
    categoryId: null, categorySlug: null, categoryName: null,
    isOnHand: false, onHandKitPhp: null, onHandPiecePhp: null,
    stock: 5, arrivalGroup: 'white_powder', description: null, imageEmoji: '💧',
    soldCount: 0, isActive: true,
    isGroupBuy: false, gbPricePerKitPhp: null, gbPricePerPiecePhp: null,
    gbVialsPerKit: null, gbMinVials: null, gbMaxVialsPerBatch: null,
    ...overrides,
  });

  it('keeps the group buy settings out of the way until the product is offered that way', async () => {
    await openNewProduct();

    // Most of the catalog is ordinary stock. Showing five empty group buy
    // fields on every product would read as five fields somebody forgot.
    expect(screen.queryByLabelText(/group buy price \/ kit/i)).not.toBeInTheDocument();

    enableGroupBuy();

    expect(screen.getByLabelText(/group buy price \/ kit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/group buy price \/ piece/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/vials per kit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/minimum order/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/maximum vials per batch/i)).toBeInTheDocument();
  });

  it('sends every group buy setting under the name the database uses', async () => {
    saveMutate.mockResolvedValue({});
    await openNewProduct();
    type(/^name$/i, 'Retatrutide');
    enableGroupBuy();

    type(/group buy price \/ kit/i, '4500');
    type(/group buy price \/ piece/i, '480');
    type(/vials per kit/i, '10');
    type(/minimum order/i, '2');
    type(/maximum vials per batch/i, '10');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Same vocabulary as lib/db/schema.ts and GroupBuyConfig: one rename away
    // from a column nobody fills is exactly how this section stayed empty.
    expect(await savedPayload()).toMatchObject({
      isGroupBuy: true,
      gbPricePerKitPhp: 4500,
      gbPricePerPiecePhp: 480,
      gbVialsPerKit: 10,
      gbMinVials: 2,
      gbMaxVialsPerBatch: 10,
    });
  });

  it('starts a new product at a batch of ten vials', async () => {
    await openNewProduct();
    enableGroupBuy();

    // The client's stated default. One kit is ten vials, so ten is also the
    // figure a hatian can actually hold.
    expect(screen.getByLabelText(/maximum vials per batch/i)).toHaveValue(10);
  });

  it('loads a product that already has group buy terms', async () => {
    catalog.rows = [product({
      isGroupBuy: true, gbPricePerKitPhp: '4500', gbPricePerPiecePhp: '480',
      gbVialsPerKit: 10, gbMinVials: 2, gbMaxVialsPerBatch: 8,
    })];
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await screen.findByText('Edit product');

    expect(screen.getByLabelText(/group buy price \/ kit/i)).toHaveValue(4500);
    expect(screen.getByLabelText(/minimum order/i)).toHaveValue(2);
    expect(screen.getByLabelText(/maximum vials per batch/i)).toHaveValue(8);
  });

  it('clears a blanked setting rather than sending it as zero', async () => {
    saveMutate.mockResolvedValue({});
    catalog.rows = [product({ isGroupBuy: true, gbPricePerKitPhp: '4500', gbMinVials: 4 })];
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await screen.findByText('Edit product');

    type(/minimum order/i, '');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Null means "no minimum of its own" and seeds the global floor. A zero is
    // an invalid minimum the API would reject, and a zero PRICE would read as a
    // free kit — the same distinction onHandKitPhp already makes.
    expect((await savedPayload()).gbMinVials).toBeNull();
  });

  it('refuses a minimum larger than the batch it has to fit in', async () => {
    saveMutate.mockResolvedValue({});
    await openNewProduct();
    type(/^name$/i, 'Retatrutide');
    enableGroupBuy();
    type(/minimum order/i, '20');
    type(/maximum vials per batch/i, '10');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Caught here because the form is the only place both figures are on screen
    // together. Downstream, kahatiDefaultsFor silently clamps the minimum to
    // the cap — correct for a legacy row, but it would leave an admin believing
    // they had set a minimum of 20.
    expect(await screen.findByRole('alert')).toHaveTextContent(/minimum/i);
    expect(saveMutate).not.toHaveBeenCalled();
  });
});

// §4 of the requirement: one labelled section holding all three switches, saved
// to the database and loaded back when the product is edited again.
describe('AdminProductsPage — Sales Channels', () => {
  const openNewProduct = async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /new product/i }));
    await screen.findByText('New product');
  };

  beforeEach(() => {
    saveMutate.mockReset();
    saveMutate.mockResolvedValue({});
  });

  it('offers all three channels as independent checkboxes', async () => {
    await openNewProduct();

    for (const label of ['On-Hand', 'Group Buy', 'Kahati']) {
      expect(screen.getByLabelText(label)).toHaveProperty('type', 'checkbox');
    }
  });

  it('explains what the section is for', async () => {
    await openNewProduct();

    expect(screen.getByText(/select which sales channels this product can be offered through/i))
      .toBeInTheDocument();
  });

  it('starts a new product with every channel off', async () => {
    await openNewProduct();

    for (const label of ['On-Hand', 'Group Buy', 'Kahati']) {
      expect(screen.getByLabelText(label)).not.toBeChecked();
    }
  });

  it('saves the requirement\'s Example 1 — On-Hand and Group Buy, not Kahati', async () => {
    await openNewProduct();
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Rejuran i' } });
    fireEvent.click(screen.getByLabelText('On-Hand'));
    fireEvent.click(screen.getByLabelText('Group Buy'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(saveMutate.mock.calls[0][0]).toMatchObject({
      isOnHand: true, isGroupBuy: true, isKahati: false,
    });
  });

  it('saves Example 3 — Kahati without Group Buy', async () => {
    // The combination the old single flag could not express. If the two ever
    // re-couple, this is the test that says so.
    await openNewProduct();
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Kahati Only' } });
    fireEvent.click(screen.getByLabelText('On-Hand'));
    fireEvent.click(screen.getByLabelText('Kahati'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(saveMutate).toHaveBeenCalled());
    expect(saveMutate.mock.calls[0][0]).toMatchObject({
      isOnHand: true, isGroupBuy: false, isKahati: true,
    });
  });

  it('loads the saved selections when an existing product is edited', async () => {
    // §4: "When editing an existing product, the saved selections must load
    // correctly." A form that silently reset them would un-list the product on
    // the next save the admin made for an unrelated reason.
    catalog.rows = [{
      id: 'p1', name: 'Rejuran i', spec: '1ml', pricePhp: '12000', stock: 0,
      isActive: true, isOnHand: true, isGroupBuy: true, isKahati: false,
    }];
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }));
    await screen.findByText('Edit product');

    expect(screen.getByLabelText('On-Hand')).toBeChecked();
    expect(screen.getByLabelText('Group Buy')).toBeChecked();
    expect(screen.getByLabelText('Kahati')).not.toBeChecked();
  });
});
