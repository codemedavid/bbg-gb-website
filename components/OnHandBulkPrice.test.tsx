// The shelf's 10+ vial rate, as the customer meets it.
//
// The rate was admin-editable and stored months before anything showed it, so a
// customer stepping to ten vials watched the total go from ₱7,000 to ₱7,000. The
// discount has to be visible twice over: promised while they are short of it,
// and confirmed the moment they reach it.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnHandBulkPrice } from './OnHandBulkPrice';
import { onHandQuote } from '@/lib/pricing';

type Shelf = {
  onHandPiecePhp: string | null;
  onHandKitPhp: string | null;
  onHandTenVialPhp: string | null;
};
const shelf: Shelf = { onHandPiecePhp: '700', onHandKitPhp: '6500', onHandTenVialPhp: '6500' };
const quoteFor = (qty: number, p: Shelf = shelf) => onHandQuote(p, 'piece', qty)!;

describe('OnHandBulkPrice', () => {
  it('nudges a customer who is short of the threshold', () => {
    render(<OnHandBulkPrice quote={quoteFor(4)} />);
    expect(screen.getByText(/6 more/i)).toBeInTheDocument();
    expect(screen.getByText(/₱650/)).toBeInTheDocument();
  });

  it('names the single vial left in the singular', () => {
    render(<OnHandBulkPrice quote={quoteFor(9)} />);
    expect(screen.getByText(/1 more vial\b/i)).toBeInTheDocument();
    expect(screen.queryByText(/1 more vials/i)).not.toBeInTheDocument();
  });

  it('congratulates a customer who has reached it', () => {
    render(<OnHandBulkPrice quote={quoteFor(10)} />);
    expect(screen.getByText(/congrats/i)).toBeInTheDocument();
  });

  it('shows the discounted price with the original struck through', () => {
    render(<OnHandBulkPrice quote={quoteFor(10)} />);
    const struck = screen.getByText('₱700');
    expect(struck).toHaveClass('line-through');
    // The struck figure is decoration for sighted readers; a screen reader is
    // told what it means rather than reading two prices with no relationship.
    expect(struck).toHaveAttribute('aria-label', expect.stringMatching(/was/i));
    expect(screen.getByText('₱650')).toBeInTheDocument();
  });

  it('states what the discount saved on this line', () => {
    render(<OnHandBulkPrice quote={quoteFor(10)} />);
    expect(screen.getByText(/₱500/)).toBeInTheDocument();
  });

  it('renders nothing for a product with no bulk rate', () => {
    const { container } = render(
      <OnHandBulkPrice quote={quoteFor(12, { ...shelf, onHandTenVialPhp: null })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a kit line', () => {
    const { container } = render(<OnHandBulkPrice quote={onHandQuote(shelf, 'kit', 2)!} />);
    expect(container).toBeEmptyDOMElement();
  });
});
