// The way back in for a customer who cannot remember their password. The screen
// must never let on whether the address it was given has an account.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiSend = vi.fn(async () => ({ sent: true }));
vi.mock('@/lib/api-client', () => ({ apiSend }));

const ForgotPasswordPage = (await import('./page')).default;

beforeEach(() => {
  apiSend.mockClear();
  apiSend.mockResolvedValue({ sent: true });
});

describe('Forgot password page', () => {
  it('renders the email form and a way back to login', () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to log in/i })).toHaveAttribute('href', '/login');
  });

  it('requests a reset link for the address entered', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByPlaceholderText('Email'), 'ana@bbg.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(apiSend).toHaveBeenCalledWith('/auth/forgot-password', 'POST', { email: 'ana@bbg.test' });
  });

  it('confirms without confirming that the account exists', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByPlaceholderText('Email'), 'ghost@bbg.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    const confirmation = await screen.findByRole('status');
    expect(confirmation.textContent).toMatch(/if .*account/i);
    expect(confirmation.textContent).not.toMatch(/\bno account\b|not registered|doesn't exist/i);
  });

  it('surfaces a failed request instead of claiming the mail was sent', async () => {
    apiSend.mockRejectedValueOnce(new Error('Network down'));
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByPlaceholderText('Email'), 'ana@bbg.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText('Network down')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
