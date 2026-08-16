// The MOQ shelf card.
//
// This card deliberately shares no component with GroupBuyCard or CampaignCard,
// even though all three now show progress: those two count kits towards a batch
// that seals at ten, this one counts units towards an arbitrary target that is
// welcome to be overshot. What it must show is image, name, price and
// description, plus the fact that makes this page different: how far the buy
// has got, and how much is left before it goes ahead.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MoqProduct } from '@/lib/types';
import { MoqProductCard } from './MoqProductCard';

const product = (o: Partial<MoqProduct> = {}): MoqProduct => ({
  id: 'm1', name: 'FUAN GTT1500', spec: '1500mg', description: 'Bulk research peptide.',
  imageUrl: null, imageEmoji: '📦', pricePhp: '4500.00', priceUsd: null,
  minOrderQty: 1, packingFeePhp: null, arrivalGroup: 'white_powder',
  isActive: true, sortOrder: 0,
  moq: 500, committed: 120, cycleNo: 1, remaining: 380, progress: 0.24, reached: false,
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

  it('shows the target — the point of the page', () => {
    render(<MoqProductCard p={product({ moq: 500 })} onAdd={vi.fn()} />);
    expect(screen.getByText(/moq 500/i)).toBeInTheDocument();
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

  it('shows how far the buy has got against its target', () => {
    render(<MoqProductCard p={product({ committed: 120, moq: 500 })} onAdd={vi.fn()} />);
    expect(screen.getByText('120 / 500')).toBeInTheDocument();
  });

  it('tells the customer how many units are still needed', () => {
    render(<MoqProductCard p={product({ remaining: 380 })} onAdd={vi.fn()} />);
    expect(screen.getByText(/380 more to go/i)).toBeInTheDocument();
  });

  it('reports the progress to assistive tech, not just as a coloured bar', () => {
    render(<MoqProductCard p={product({ committed: 120, moq: 500 })} onAdd={vi.fn()} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '120');
    expect(bar).toHaveAttribute('aria-valuemax', '500');
  });

  it('celebrates a target that has been reached', () => {
    render(<MoqProductCard p={product({ committed: 500, remaining: 0, progress: 1, reached: true })} onAdd={vi.fn()} />);
    expect(screen.getByText(/target reached/i)).toBeInTheDocument();
  });

  // The shelf holds nothing, so nothing can be out of it. A listed item is
  // always buyable — a short target is the REASON to order, not a blocker.
  it('stays buyable while the target is unreached', async () => {
    const onAdd = vi.fn();
    render(<MoqProductCard p={product({ committed: 0, remaining: 500 })} onAdd={onAdd} />);

    const btn = screen.getByRole('button', { name: /add/i });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('stays buyable after the target is reached — more is welcome', async () => {
    const onAdd = vi.fn();
    render(<MoqProductCard p={product({ committed: 620, remaining: 0, progress: 1, reached: true })} onAdd={onAdd} />);

    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('says nothing about stock anywhere', () => {
    render(<MoqProductCard p={product()} onAdd={vi.fn()} />);
    expect(screen.queryByText(/stock/i)).not.toBeInTheDocument();
  });
});
