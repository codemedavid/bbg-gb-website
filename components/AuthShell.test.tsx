// The auth screens are where being unreachable costs the most: a customer
// locked out of their account cannot use the storefront headers to ask for
// help, because every one of them is behind the login they cannot get past.
// Password resets at BBG are handed over on chat anyway — an admin mints the
// link and sends it — so the two marks belong on this shell as well.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthShell } from './AuthShell';

const renderShell = () =>
  render(
    <AuthShell title="Kumusta! 👋" sub="Log in to track orders and join kahati.">
      <button type="submit">Log in</button>
    </AuthShell>,
  );

describe('AuthShell', () => {
  it('offers WhatsApp and Viber to the BBG number', () => {
    renderShell();

    expect(screen.getByRole('link', { name: /whatsapp/i })).toHaveAttribute(
      'href',
      'https://wa.me/639914462762',
    );
    expect(screen.getByRole('link', { name: /viber/i })).toHaveAttribute(
      'href',
      'viber://chat?number=%2B639914462762',
    );
  });

  it('puts them beside the wordmark, above the form', () => {
    renderShell();

    const wordmark = screen.getByText(/Peptides/);
    const whatsapp = screen.getByRole('link', { name: /whatsapp/i });
    const submit = screen.getByRole('button', { name: 'Log in' });
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(wordmark, whatsapp)).toBe(true);
    expect(follows(whatsapp, submit)).toBe(true);
  });

  it('still renders the title, blurb and form the screen passed in', () => {
    renderShell();

    expect(screen.getByRole('heading', { name: 'Kumusta! 👋' })).toBeInTheDocument();
    expect(screen.getByText('Log in to track orders and join kahati.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });
});
