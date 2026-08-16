// The login screen used to print the seed accounts and their shared password
// right under the form. That is a live credential hint on a public page — the
// admin address in particular tells an attacker exactly which account to target.
//
// It also used to send everyone to '/' after logging in, which quietly broke the
// order emails: those link at /orders/<id>, that page needs a session, and a
// customer who logged in to reach it landed on the home page with the order they
// came for nowhere in sight.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replace = vi.fn();
const params = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => params,
}));

const login = vi.fn();
vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ login, user: null, loading: false }),
}));

const LoginPage = (await import('./page')).default;

/** Fill the form and submit it, the way a customer would. */
async function logIn() {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('Email'), 'ana@example.com');
  await user.type(screen.getByPlaceholderText('Password'), 'hunter2');
  await user.click(screen.getByRole('button', { name: /log in/i }));
}

describe('Login page', () => {
  beforeEach(() => {
    replace.mockClear();
    login.mockReset().mockResolvedValue(undefined);
    params.delete('next');
  });

  it('renders the login form and the register link', () => {
    render(<LoginPage />);

    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mag-register' })).toHaveAttribute('href', '/register');
  });

  // A customer who cannot remember their password has to have a way forward from
  // the screen that is asking for it.
  it('offers the forgotten-password route', () => {
    render(<LoginPage />);

    expect(screen.getByRole('link', { name: /nakalimutan ang password/i }))
      .toHaveAttribute('href', '/forgot-password');
  });

  it('does not expose demo or admin credentials', () => {
    const { container } = render(<LoginPage />);

    expect(container.textContent).not.toMatch(/ana@example\.com|password123|admin@bbgpeptides\.ph/i);
    expect(container.textContent).not.toMatch(/demo:/i);
  });

  // The whole point of the change: an emailed order link survives the login.
  it('returns to the page named in ?next after logging in', async () => {
    params.set('next', '/orders/8f1c2d3e');
    render(<LoginPage />);

    await logIn();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/orders/8f1c2d3e'));
  });

  it('lands on the home page when there is no ?next', async () => {
    render(<LoginPage />);

    await logIn();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  // Delegated to safeReturnPath; asserted here too because this is the screen
  // where an open redirect would actually be exploited.
  it('ignores a ?next pointing at another site', async () => {
    params.set('next', 'https://evil.example/phish');
    render(<LoginPage />);

    await logIn();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('does not navigate when the credentials are rejected', async () => {
    login.mockRejectedValue(new Error('Invalid email or password.'));
    params.set('next', '/orders/8f1c2d3e');
    render(<LoginPage />);

    await logIn();

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
