// Where the emailed link lands. The token rides in the query string, so the page
// has to cope with arriving without one — a mail client that ate the query, or a
// customer who typed the address by hand.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiSend = vi.fn(async () => ({ reset: true }));
vi.mock('@/lib/api-client', () => ({ apiSend }));

let params = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const ResetPasswordPage = (await import('./page')).default;

const fillIn = async (user: ReturnType<typeof userEvent.setup>, pw: string, confirm: string) => {
  await user.type(screen.getByPlaceholderText('New password'), pw);
  await user.type(screen.getByPlaceholderText('Confirm new password'), confirm);
  await user.click(screen.getByRole('button', { name: /set new password/i }));
};

beforeEach(() => {
  params = new URLSearchParams('token=tok123');
  apiSend.mockClear();
  apiSend.mockResolvedValue({ reset: true });
});

describe('Reset password page', () => {
  it('renders the new-password form when the link carried a token', () => {
    render(<ResetPasswordPage />);

    expect(screen.getByPlaceholderText('New password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Confirm new password')).toBeInTheDocument();
  });

  it('sends the token from the link with the new password', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await fillIn(user, 'brand-new-pw', 'brand-new-pw');

    expect(apiSend).toHaveBeenCalledWith('/auth/reset-password', 'POST', {
      token: 'tok123', newPassword: 'brand-new-pw',
    });
  });

  it('points the customer at login once the password is set', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await fillIn(user, 'brand-new-pw', 'brand-new-pw');

    expect(await screen.findByRole('link', { name: /log in/i })).toHaveAttribute('href', '/login');
    expect(screen.queryByPlaceholderText('New password')).not.toBeInTheDocument();
  });

  it('catches a mistyped confirmation before spending the link', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await fillIn(user, 'brand-new-pw', 'brand-new-pX');

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('shows the reason a dead link was refused', async () => {
    apiSend.mockRejectedValueOnce(new Error('This reset link is invalid or has expired. Please request a new one.'));
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await fillIn(user, 'brand-new-pw', 'brand-new-pw');

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
  });

  it('offers a fresh link instead of a form when the token is missing', () => {
    params = new URLSearchParams();

    render(<ResetPasswordPage />);

    expect(screen.queryByPlaceholderText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i }))
      .toHaveAttribute('href', '/forgot-password');
  });
});
