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
  id: 'c1', name: 'Retatrutide 20mg', pricePerKitPhp: '9000.00', moq: 10, committed: 4,
  perCustomerMin: 1, shippingPhp: '300.00', status: 'open', deadline: '2026-08-01T00:00:00Z',
  includedProducts: [], arrivalGroup: 'white_powder', description: null,
  createdAt: '2026-07-01T00:00:00Z',
  progress: 0.4, remaining: 6, reached: false, outcome: 'awaiting_moq',
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

  it('tells an under-target campaign how many kits are still needed', () => {
    render(<CampaignCard c={campaign({ committed: 4, moq: 10, remaining: 6 })} onCommit={vi.fn()} />);

    expect(screen.getByText(/6 more/i)).toBeInTheDocument();
  });

  it('exposes progress to assistive tech as a labelled progressbar', () => {
    render(<CampaignCard c={campaign({ committed: 4, moq: 10 })} onCommit={vi.fn()} />);

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '4');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
  });

  it('shows a campaign that cleared its MOQ as good to go', () => {
    render(<CampaignCard c={campaign({ committed: 12, moq: 10, remaining: 0, reached: true, progress: 1, outcome: 'processing' })} onCommit={vi.fn()} />);

    expect(screen.getByText(/MOQ reached/i)).toBeInTheDocument();
  });

  it('does not clamp a campaign that overshot its MOQ back to the target', () => {
    // Unlike a hatian, which locks at 10 vials, a campaign may exceed its MOQ.
    render(<CampaignCard c={campaign({ committed: 14, moq: 10, remaining: 0, reached: true, progress: 1 })} onCommit={vi.fn()} />);

    expect(screen.getByText(/14 \/ 10 kits/)).toBeInTheDocument();
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
    const onCommit = vi.fn();
    render(<CampaignCard c={campaign({ status: 'open' })} onCommit={onCommit} />);

    await userEvent.click(screen.getByRole('button', { name: /commit/i }));

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

  it('states the per-customer minimum so the commit sheet is not a surprise', () => {
    render(<CampaignCard c={campaign({ perCustomerMin: 2 })} onCommit={vi.fn()} />);

    expect(screen.getByText(/min 2 kit/i)).toBeInTheDocument();
  });
});
