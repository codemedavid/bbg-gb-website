// The home page's WhatsApp community card.
//
// The card carries the same invite twice on purpose, and both halves are
// asserted here: the QR is only usable from a SECOND device, so the phone
// actually holding the screen needs a tappable link or the card does nothing
// for the majority of BBG's traffic.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WHATSAPP_COMMUNITY_URL } from '@/lib/contact';

const { CommunityCard } = await import('./CommunityCard');

describe('CommunityCard', () => {
  it('links to the BBG WhatsApp community invite', () => {
    render(<CommunityCard />);

    expect(screen.getByRole('link', { name: /community/i })).toHaveAttribute('href', WHATSAPP_COMMUNITY_URL);
  });

  it('hands the invite to WhatsApp in a new tab without leaking the opener', () => {
    render(<CommunityCard />);

    const link = screen.getByRole('link', { name: /community/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows the QR so the invite can be scanned from another device', () => {
    render(<CommunityCard />);

    const qr = screen.getByAltText(/qr code/i);
    expect(qr).toHaveAttribute('src', expect.stringContaining('whatsapp-community-qr'));
  });

  it('gives the QR explicit dimensions so the card does not shift as it loads', () => {
    render(<CommunityCard />);

    const qr = screen.getByAltText(/qr code/i);
    expect(qr).toHaveAttribute('width');
    expect(qr).toHaveAttribute('height');
  });
});
