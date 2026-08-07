// The login screen used to print the seed accounts and their shared password
// right under the form. That is a live credential hint on a public page — the
// admin address in particular tells an attacker exactly which account to target.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ login: vi.fn(), user: null, loading: false }),
}));

const LoginPage = (await import('./page')).default;

describe('Login page', () => {
  it('renders the login form and the register link', () => {
    render(<LoginPage />);

    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mag-register' })).toHaveAttribute('href', '/register');
  });

  it('does not expose demo or admin credentials', () => {
    const { container } = render(<LoginPage />);

    expect(container.textContent).not.toMatch(/ana@example\.com|password123|admin@bbgpeptides\.ph/i);
    expect(container.textContent).not.toMatch(/demo:/i);
  });
});
