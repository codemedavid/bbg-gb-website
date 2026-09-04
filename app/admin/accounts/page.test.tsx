// Admin → Accounts.
//
// The shop had no way to see who had signed up: the only view of a customer was
// through an order they had already placed, so anyone who registered and never
// bought was invisible. This screen is that list, and the "last signed in"
// column is what separates a live account from a dormant one — auth is a
// stateless JWT, so a stamp at sign-in is the only activity signal that exists.
//
// It is also where a locked-out customer gets recovered. Email delivery has
// failed twice in three weeks, and each time the customer's only way back in was
// to register a new address; the reset link on each row is the way back that
// does not depend on their inbox.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const makeRows = () => [
  {
    id: 'u1', name: 'Ana Cruz', email: 'ana@example.com', phone: '09171234567',
    role: 'customer', orderCount: 3,
    createdAt: new Date('2026-05-02T00:00:00Z').toISOString(),
    lastLoginAt: new Date('2026-08-16T00:00:00Z').toISOString(),
  },
  {
    id: 'u2', name: 'Ben Reyes', email: 'ben@example.com', phone: null,
    role: 'admin', orderCount: 0,
    createdAt: new Date('2026-04-01T00:00:00Z').toISOString(),
    lastLoginAt: null,
  },
] as unknown[];

const rows = { current: makeRows() };
const lastArgs = { current: null as unknown };

const issueResetLink = vi.fn(async (_id: string) => ({
  email: 'ana@example.com',
  resetUrl: 'https://www.bbgph.org/reset-password?token=abc123',
  expiresInMinutes: 60,
}));

vi.mock('@/lib/admin-api', () => ({
  useAdminAccounts: (search?: string, role?: string) => {
    lastArgs.current = { search, role };
    return { data: rows.current, isLoading: false, error: null };
  },
  useIssueResetLink: () => ({ mutateAsync: issueResetLink, isPending: false }),
}));

const Page = (await import('./page')).default;

const resetLinkButton = (name = 'Ana Cruz') =>
  screen.getByRole('button', { name: new RegExp(`reset link for ${name}`, 'i') });

beforeEach(() => {
  rows.current = makeRows();
  lastArgs.current = null;
  issueResetLink.mockReset();
  issueResetLink.mockResolvedValue({
    email: 'ana@example.com',
    resetUrl: 'https://www.bbgph.org/reset-password?token=abc123',
    expiresInMinutes: 60,
  });
});

describe('AdminAccountsPage', () => {
  it('lists every account with its name and email', () => {
    render(<Page />);

    expect(screen.getByText('Ana Cruz')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Ben Reyes')).toBeInTheDocument();
  });

  it('shows how many orders each account has placed', () => {
    render(<Page />);

    expect(screen.getByTestId('order-count-u1')).toHaveTextContent('3');
    expect(screen.getByTestId('order-count-u2')).toHaveTextContent('0');
  });

  it('shows when an account last signed in', () => {
    render(<Page />);

    expect(screen.getByTestId('last-login-u1')).toHaveTextContent('Aug 16, 2026');
  });

  // Blank would read as a rendering bug, and a date would be a lie.
  it('says Never for an account that has not signed in', () => {
    render(<Page />);

    expect(screen.getByTestId('last-login-u2')).toHaveTextContent(/never/i);
  });

  it('marks which accounts hold admin access', () => {
    render(<Page />);

    expect(screen.getByTestId('role-u2')).toHaveTextContent(/admin/i);
    expect(screen.getByTestId('role-u1')).toHaveTextContent(/customer/i);
  });

  it('asks the API for the typed search term', async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.type(screen.getByRole('searchbox', { name: /search/i }), 'ana');

    await waitFor(() => expect(lastArgs.current).toMatchObject({ search: 'ana' }));
  });

  it('asks the API for a single role when a filter is chosen', async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.click(screen.getByRole('button', { name: /admins/i }));

    await waitFor(() => expect(lastArgs.current).toMatchObject({ role: 'admin' }));
  });

  it('says so when there are no accounts rather than showing a blank table', () => {
    rows.current = [];
    render(<Page />);

    expect(screen.getByText(/no accounts/i)).toBeInTheDocument();
  });

  describe('issuing a reset link', () => {
    // Named per row: an admin working a list of locked-out customers must never
    // have to guess which "Issue reset link" belongs to whom.
    it('offers a reset link on a customer row', () => {
      render(<Page />);

      expect(resetLinkButton('Ana Cruz')).toBeInTheDocument();
    });

    // The server refuses this for an admin account (privilege escalation), so
    // the button must not be there to invite the error.
    it('does not offer one on an admin row', () => {
      render(<Page />);

      expect(screen.queryByRole('button', { name: /reset link for Ben Reyes/i })).toBeNull();
    });

    it('asks the server for a link for that account', async () => {
      const user = userEvent.setup();
      render(<Page />);

      await user.click(resetLinkButton());

      await waitFor(() => expect(issueResetLink).toHaveBeenCalledWith('u1'));
    });

    it('shows the link so the admin can hand it over', async () => {
      const user = userEvent.setup();
      render(<Page />);

      await user.click(resetLinkButton());

      await waitFor(() => expect(screen.getByTestId('reset-link-u1'))
        .toHaveTextContent('https://www.bbgph.org/reset-password?token=abc123'));
    });

    // A link with no stated lifetime gets pasted into a chat and used tomorrow,
    // by which point it is dead and reads as the feature being broken.
    it('says how long the link lasts and that it works once', async () => {
      const user = userEvent.setup();
      render(<Page />);

      await user.click(resetLinkButton());

      await waitFor(() => expect(screen.getByTestId('reset-link-note-u1'))
        .toHaveTextContent(/60 minutes.*once|once.*60 minutes/i));
    });

    it('shows the link only on the row it was issued for', async () => {
      const user = userEvent.setup();
      render(<Page />);

      await user.click(resetLinkButton());

      await waitFor(() => expect(screen.getByTestId('reset-link-u1')).toBeInTheDocument());
      expect(screen.queryByTestId('reset-link-u2')).toBeNull();
    });

    // The admin pastes this into WhatsApp, so getting it out of the page in one
    // click is the difference between a workflow and a transcription error.
    it('copies the link to the clipboard', async () => {
      // userEvent installs its own clipboard stub, so read it back rather than
      // stubbing over the top of it.
      const user = userEvent.setup();
      render(<Page />);

      await user.click(resetLinkButton());
      await waitFor(() => expect(screen.getByTestId('reset-link-u1')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /copy/i }));

      await waitFor(async () => expect(await navigator.clipboard.readText())
        .toBe('https://www.bbgph.org/reset-password?token=abc123'));
    });

    // Silence here would leave the admin telling a customer a link is coming
    // that never got minted.
    it('says so when the link could not be issued', async () => {
      issueResetLink.mockRejectedValue(new Error('Admin access required.'));
      const user = userEvent.setup();
      render(<Page />);

      await user.click(resetLinkButton());

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not/i));
    });
  });
});
