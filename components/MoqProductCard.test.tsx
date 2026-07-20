// The MOQ shelf card.
//
// This card deliberately shares no component with GroupBuyCard or CampaignCard:
// the MOQ page is its own surface, and a progress bar or slot counter would be
// meaningless here. What it must show is what the client asked for — image,
// name, price, availability and description — plus the one thing that makes
// this page different: the minimum order quantity.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MoqProduct } from '@/lib/types';
import { MoqProductCard } from './MoqProductCard';

const product = (o: Partial<MoqProduct> = {}): MoqProduct => ({
  id: 'm1', name: 'FUAN GTT1500', spec: '1500mg', description: 'Bulk research peptide.',
  imageUrl: null, imageEmoji: '📦', pricePhp: '4500.00', priceUsd: null,
  stock: 50, minOrderQty: 5, packingFeePhp: null, arrivalGroup: 'white_powder',
  isActive: true, sortOrder: 0, inStock: true,
  ...o,
});

beforeEach(() => vi.clearAllMocks());

describe('MoqProductCard', () => {
  it('shows the product name and spec', () => {
    render(<MoqProductCard p={product()} onAdd={vi.fn()} />);
    expect(screen.getByText(/FUAN GTT1500/)).toBeInTheDocument();
    expect(screen.getByText(/1500mg/)).toBeInTheDocument();
  });

  it('shows the price', () => {
    render(<MoqProductCard p={product({ pricePhp: '4500.00' })} onAdd={vi.fn()} />);
    expect(screen.getByText(/4,500/)).toBeInTheDocument();
  });

  it('shows the minimum order quantity — the point of the page', () => {
    render(<MoqProductCard p={product({ minOrderQty: 5 })} onAdd={vi.fn()} />);
    expect(screen.getByText(/min 5/i)).toBeInTheDocument();
  });

  it('shows the description when there is one', () => {
    render(<MoqProductCard p={product({ description: 'Bulk research peptide.' })} onAdd={vi.fn()} />);
    expect(screen.getByText('Bulk research peptide.')).toBeInTheDocument();
  });

  it('renders the uploaded image when present', () => {
    render(<MoqProductCard p={product({ imageUrl: 'https://cdn.test/x.png' })} onAdd={vi.fn()} />);
    expect(screen.getByRole('img', { name: /FUAN GTT1500/i })).toHaveAttribute('src', 'https://cdn.test/x.png');
  });

  it('falls back to the emoji when no image has been uploaded', () => {
    render(<MoqProductCard p={product({ imageUrl: null, imageEmoji: '🧪' })} onAdd={vi.fn()} />);
    expect(screen.getByText('🧪')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('reports availability while in stock', () => {
    render(<MoqProductCard p={product({ stock: 50, inStock: true })} onAdd={vi.fn()} />);
    expect(screen.getByText(/50 in stock/i)).toBeInTheDocument();
  });

  it('adds the minimum order quantity to the cart, not a single unit', async () => {
    const onAdd = vi.fn();
    render(<MoqProductCard p={product({ minOrderQty: 5 })} onAdd={onAdd} />);

    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({ id: 'm1', minOrderQty: 5 });
  });

  it('marks an out-of-stock product and refuses to add it', async () => {
    const onAdd = vi.fn();
    render(<MoqProductCard p={product({ stock: 0, inStock: false })} onAdd={onAdd} />);

    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /add|unavailable/i });
    expect(btn).toBeDisabled();

    await userEvent.click(btn);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('refuses to add when stock cannot cover one whole minimum order', async () => {
    const onAdd = vi.fn();
    // 3 units left but the minimum order is 5 — nobody can legally buy this.
    render(<MoqProductCard p={product({ stock: 3, minOrderQty: 5, inStock: false })} onAdd={onAdd} />);

    await userEvent.click(screen.getByRole('button', { name: /add|unavailable/i }));
    expect(onAdd).not.toHaveBeenCalled();
  });
});
