// Who the app thinks you are when it cannot reach the server.
//
// The session lives in an httpOnly cookie, so the browser learns whether it is
// signed in by asking GET /api/auth/me. The provider used to treat EVERY failure
// of that request as "not signed in" — `.catch(() => setUser(null))`. A dropped
// request on a mobile connection, a cold start that timed out, a 500 from the
// database: all of them read as a logout, and the checkout screen redirects a
// signed-in customer to /login on the strength of it.
//
// The cookie is still there the whole time. Only the answer went missing. So the
// provider has to distinguish the server SAYING you are signed out (401) from
// not having heard back, and report the difference rather than collapsing both
// into `user === null`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './useAuth';

const USER = {
  id: 'u1', name: 'Ana Cruz', email: 'ana@example.com',
  phone: '09171234567', address: '123 Mabini St', role: 'customer',
};

// Renders the three facts a caller decides on: the status, whether we are still
// resolving, and who we landed on.
function Probe() {
  const { user, loading, status } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.name ?? 'none'}</span>
    </div>
  );
}

const renderAuth = () => render(<AuthProvider><Probe /></AuthProvider>);

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const signedIn = () => jsonResponse(200, { success: true, data: { user: USER }, error: null });
const signedOut = () => jsonResponse(401, { success: false, data: null, error: 'Unauthorized.' });
const serverError = () => jsonResponse(500, { success: false, data: null, error: 'Something went wrong.' });

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('AuthProvider', () => {
  it('reports an authenticated session when /auth/me answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => signedIn()));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('Ana Cruz');
  });

  it('reports a signed-out session when the server says 401', async () => {
    // The one answer that genuinely means "no session". This is what may bounce
    // someone to the login screen.
    vi.stubGlobal('fetch', vi.fn(async () => signedOut()));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('retries a dropped request instead of logging the customer out', async () => {
    // One blip on a phone. The cookie is untouched, so asking again resolves it —
    // and the customer never learns anything went wrong.
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(signedIn());
    vi.stubGlobal('fetch', fetchMock);

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'), { timeout: 10_000 });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('retries a 500 as well, since a failing server is not a logout either', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverError())
      .mockResolvedValue(signedIn());
    vi.stubGlobal('fetch', fetchMock);

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'), { timeout: 10_000 });
  });

  it('settles on "unknown" — not "unauthenticated" — when every attempt fails', async () => {
    // The state the old provider could not express. We do not know whether this
    // customer is signed in, and saying "signed out" sends them to a login form
    // they do not need and drops them out of a checkout they were halfway
    // through. Callers redirect on `unauthenticated` only.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unknown'), { timeout: 10_000 });
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('does not retry a 401, which is a settled answer', async () => {
    // Retrying a definite "no" only delays the login screen.
    const fetchMock = vi.fn(async () => signedOut());
    vi.stubGlobal('fetch', fetchMock);

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
