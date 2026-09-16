// Client feedback #1/#2: Group Buy (MOQ) is its own feature with its own UI, not
// a reskin of the Kahati board.
//
// The two boards answer different questions. Kahati asks "how many of the 10
// vials in this kit are spoken for" — a fill gauge that locks at the cap. Group
// Buy asks "have enough kits been committed to clear the supplier's minimum, and
// what happens if we fall short" — a target that can be exceeded, and a lifecycle
// (approve / extend / cancel) the Kahati board has no concept of.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampaignCard } from './CampaignCard';
import type { MoqCampaign } from '@/lib/types';

const campaign = (o: Partial<MoqCampaign> = {}): MoqCampaign => ({
  id: 'c1', name: 'Retatrutide 20mg', pricePerKitPhp: '9000.00', moq: 10, committed: 4, perCustomerMin: 1,
  shippingPhp: '300.00', status: 'open', opensAt: null, deadline: '2026-08-01T00:00:00Z',
  includedProducts: [], arrivalGroup: 'white_powder', description: null,
  createdAt: '2026-07-01T00:00:00Z',
  seriesId: 'c1', batchNo: 1,
  capacity: 10, progress: 0.4, remaining: 6, reached: false, full: false, outcome: 'awaiting_moq',
  ...o,
});

describe('CampaignCard', () => {
  it('names the campaign and its per-kit price', () => {
    render(<CampaignCard c={campaign()} onCommit={vi.fn()} />);

    expect(screen.getByText('Retatrutide 20mg')).toBeInTheDocument();
    expect(screen.getByText(/₱9,000/)).toBeInTheDocument();
  });

  it('reports progress toward the MOQ in kits, not vials', () => {
    render(<CampaignCard c={campaign({ committed: 4, moq: 10 })} onCommit={vi.fn()} />);

    expect(screen.getByText(/4 \/ 10 kits/)).toBeInTheDocument();
  });

  it('tells an under-filled batch how many kits are still available', () => {
    render(<CampaignCard c={campaign({ committed: 4, moq: 10, remaining: 6 })} onCommit={vi.fn()} />);

    expect(screen.getByText(/6 kits left/i)).toBeInTheDocument();
  });

  // A kit is not always ten vials — the Skin Repair SM range ships 5 pairs — and
  // "PHP 1,975 per kit" alone does not say which. Stated only when it is not the
  // familiar ten, so the exception is what draws the eye.
  it('says how many vials a kit holds when it is not the usual ten', () => {
    render(<CampaignCard c={campaign({ pricePerKitPhp: '1975.00', vialsPerKit: 5 })} onCommit={vi.fn()} />);

    expect(screen.getByText(/5 vials each/i)).toBeInTheDocument();
  });

  it('says nothing about kit size on an ordinary ten-vial kit', () => {
    render(<CampaignCard c={campaign({ vialsPerKit: 10 })} onCommit={vi.fn()} />);

    expect(screen.queryByText(/vials each/i)).not.toBeInTheDocument();
  });

  it('says nothing about kit size when the batch does not know it', () => {
    render(<CampaignCard c={campaign({ vialsPerKit: null })} onCommit={vi.fn()} />);

    expect(screen.queryByText(/vials each/i)).not.toBeInTheDocument();
  });

  it('names the batch it is showing, so a series reads as #1, #2, #3', () => {
    render(<CampaignCard c={campaign({ batchNo: 3 })} onCommit={vi.fn()} />);

    expect(screen.getByText(/Batch #3/)).toBeInTheDocument();
  });

  it('exposes progress to assistive tech as a labelled progressbar', () => {
    render(<CampaignCard c={campaign({ committed: 4, moq: 10 })} onCommit={vi.fn()} />);

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '4');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
  });

  it('shows a filled batch as full and closed to new commitments', () => {
    render(<CampaignCard c={campaign({
      committed: 10, moq: 10, remaining: 0, reached: true, full: true, progress: 1,
      status: 'completed', outcome: 'processing',
    })} onCommit={vi.fn()} />);

    expect(screen.getByText(/Batch full 🎉/)).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /batch full/i })).toBeDisabled();
  });

  // The rule this card exists to make visible: a batch tops out at its capacity.
  // It used to render the raw count, so an oversubscribed campaign read "14 / 10
  // kits" — the number the client called impossible. The overflow is batch #2 now.
  it('never renders more kits than the batch can hold', () => {
    render(<CampaignCard c={campaign({
      committed: 10, capacity: 10, moq: 10, remaining: 0, reached: true, full: true, progress: 1,
    })} onCommit={vi.fn()} />);

    expect(screen.getByText(/10 \/ 10 kits/)).toBeInTheDocument();
    expect(screen.queryByText(/1[1-9] \/ 10/)).not.toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '10');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
  });

  it('marks an admin-approved campaign as proceeding even below MOQ', () => {
    render(<CampaignCard c={campaign({ status: 'approved', committed: 3, moq: 10, outcome: 'processing' })} onCommit={vi.fn()} />);

    expect(screen.getByText(/processing/i)).toBeInTheDocument();
  });

  it('marks a cancelled campaign as refunded', () => {
    render(<CampaignCard c={campaign({ status: 'cancelled', outcome: 'refunded' })} onCommit={vi.fn()} />);

    expect(screen.getByText(/refund/i)).toBeInTheDocument();
  });

  it('invites a commitment while the campaign is open', async () => {
    // The CTA fills the cart rather than opening a payment form — a campaign
    // commitment is paid for at the shared checkout like everything else.
    const onCommit = vi.fn();
    render(<CampaignCard c={campaign({ status: 'open' })} onCommit={onCommit} />);

    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('refuses commitments once the campaign is no longer open', async () => {
    const onCommit = vi.fn();
    render(<CampaignCard c={campaign({ status: 'cancelled', outcome: 'refunded' })} onCommit={onCommit} />);

    const button = screen.queryByRole('button', { name: /commit/i });
    expect(button === null || (button as HTMLButtonElement).disabled).toBe(true);
    if (button) await userEvent.click(button);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
