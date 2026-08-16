// Editing the lines of an order that is not yet paid for in full.
//
// The draft is local until Save: an order is a commercial record and a transfer
// may already be in flight against its total, so the customer gets to see the
// new figure before anything is committed.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderItemsEditor } from './OrderItemsEditor';
import type { OrderItem } from '@/lib/types';

const item = (over: Partial<OrderItem> & { id: string }): OrderItem => ({
  orderId: 'o1', kind: 'product', nameSnapshot: 'Tirzepatide', specSnapshot: '30mg',
  qty: 3, unitPricePhp: '500', lineTotalPhp: '1500',
  productId: null, groupBuyId: null, moqCampaignId: null, moqProductId: null,
  unitPriceUsd: null,
  ...over,
} as OrderItem);

const items = [
  item({ id: 'i1', nameSnapshot: 'Tirzepatide', qty: 3, unitPricePhp: '500' }),
  item({ id: 'i2', nameSnapshot: 'BAC Water', qty: 2, unitPricePhp: '100' }),
];

const setup = (over: Partial<Parameters<typeof OrderItemsEditor>[0]> = {}) => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<OrderItemsEditor items={items} isSaving={false} onSave={onSave} onCancel={onCancel} {...over} />);
  return { onSave, onCancel, user: userEvent.setup() };
};

describe('OrderItemsEditor', () => {
  it('opens on the quantities the order already holds', () => {
    setup();
    expect(screen.getByLabelText('Quantity for Tirzepatide')).toHaveValue(3);
    expect(screen.getByLabelText('Quantity for BAC Water')).toHaveValue(2);
  });

  it('shows the subtotal the new quantities come to, before saving', async () => {
    const { user } = setup();
    // 3x500 + 2x100 = 1700
    expect(screen.getByText('₱1,700')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Reduce Tirzepatide'));
    // 2x500 + 2x100 = 1200
    expect(screen.getByText('₱1,200')).toBeInTheDocument();
  });

  it('sends only the kept lines and their new quantities', async () => {
    const { onSave, user } = setup();

    await user.click(screen.getByLabelText('Add one BAC Water'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith([
      { id: 'i1', qty: 3 },
      { id: 'i2', qty: 3 },
    ]);
  });

  it('drops a removed line from what it saves', async () => {
    const { onSave, user } = setup();

    await user.click(screen.getByLabelText('Remove BAC Water'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith([{ id: 'i1', qty: 3 }]);
  });

  // Removal is a decision made a tap at a time; taking it back must not mean
  // cancelling the whole edit and starting again.
  it('can put a removed line back', async () => {
    const { onSave, user } = setup();

    await user.click(screen.getByLabelText('Remove BAC Water'));
    await user.click(screen.getByRole('button', { name: /undo/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith([
      { id: 'i1', qty: 3 },
      { id: 'i2', qty: 2 },
    ]);
  });

  it('will not let a quantity fall below one — removal is the other button', async () => {
    const { user } = setup({ items: [item({ id: 'i1', qty: 1 })] });
    expect(screen.getByLabelText('Reduce Tirzepatide')).toBeDisabled();
    void user;
  });

  it('refuses to save an order emptied of every line, and says why', async () => {
    const { onSave, user } = setup();

    await user.click(screen.getByLabelText('Remove Tirzepatide'));
    await user.click(screen.getByLabelText('Remove BAC Water'));

    expect(screen.getByTestId('order-edit-empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  // The fee buys a parcel, and the parcel still ships. Saying so stops the
  // unchanged fee on the new total reading as a bug.
  it('tells the customer the packing fee is not changing', () => {
    setup();
    expect(screen.getByText(/packing fee/i)).toBeInTheDocument();
  });

  it('cannot be double-submitted while a save is in flight', () => {
    setup({ isSaving: true });
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });

  it('leaves the order alone when the edit is cancelled', async () => {
    const { onCancel, onSave, user } = setup();

    await user.click(screen.getByLabelText('Remove BAC Water'));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
