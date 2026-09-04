'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiClientError, apiGet, apiSend } from './api-client';
import type { User } from './types';

/**
 * What we know about the session, as opposed to who we landed on.
 *
 * `unauthenticated` is the server's own answer: it looked at the cookie and
 * there is no session behind it. `unknown` is the absence of an answer — the
 * request never landed, or landed as a 500 — and the two must not be confused.
 * The cookie is still in the browser either way, so a customer in `unknown` is
 * very probably still signed in and the checkout POST will be accepted; sending
 * them to a login form costs a sale to a network blip. Callers redirect on
 * `unauthenticated` alone.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'unknown';

// A dropped request on a phone is common and usually over by the next attempt,
// so /auth/me is asked more than once before we give up on it. Short, widening
// gaps: long enough to outlast a handover between cells, short enough that a
// genuinely offline visitor is not left staring at a blank screen.
const RETRY_DELAYS_MS = [400, 1200];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type AuthCtx = {
  user: User | null;
  loading: boolean;
  /** Whether the session is confirmed, refused, or simply unknown. */
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; phone?: string; password: string; address?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    // Guards against a resolved request writing state after the effect is torn
    // down, which React warns about and which would also let a stale attempt
    // overwrite a newer answer.
    let live = true;

    (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const d = await apiGet<{ user: User }>('/auth/me');
          if (!live) return;
          setUser(d.user);
          setStatus('authenticated');
          return;
        } catch (err) {
          if (!live) return;
          // The server looked and said no. That is settled — asking again only
          // delays the login screen for someone who genuinely has to see it.
          // 404 counts too: the session names a user row that is gone.
          const status = err instanceof ApiClientError ? err.status : 0;
          if (status === 401 || status === 403 || status === 404) {
            setUser(null);
            setStatus('unauthenticated');
            return;
          }
          // Anything else is a non-answer. Try again, then admit we do not know
          // rather than asserting a logout we never actually observed.
          if (attempt >= RETRY_DELAYS_MS.length) {
            setUser(null);
            setStatus('unknown');
            return;
          }
          await sleep(RETRY_DELAYS_MS[attempt]);
          if (!live) return;
        }
      }
    })();

    return () => { live = false; };
  }, []);

  // Kept as a derived value so every existing `const { user, loading } = ...`
  // caller keeps working unchanged.
  const loading = status === 'loading';

  // Every one of these ends with the session settled one way or the other, so
  // each moves the status off whatever the opening probe left behind — a
  // successful login out of `unknown` in particular, which is how a customer
  // whose /auth/me never landed gets a confirmed session again.
  const signedIn = (u: User) => { setUser(u); setStatus('authenticated'); };

  const login = async (email: string, password: string) => {
    const d = await apiSend<{ user: User }>('/auth/login', 'POST', { email, password });
    signedIn(d.user);
  };
  const adminLogin = async (email: string, password: string) => {
    const d = await apiSend<{ user: User }>('/admin/login', 'POST', { email, password });
    signedIn(d.user);
  };
  const register = async (input: { name: string; email: string; phone?: string; password: string; address?: string }) => {
    const d = await apiSend<{ user: User }>('/auth/register', 'POST', input);
    signedIn(d.user);
  };
  const logout = async () => {
    await apiSend('/auth/logout', 'POST').catch(() => {});
    setUser(null);
    setStatus('unauthenticated');
  };

  return (
    <Ctx.Provider value={{ user, loading, status, login, adminLogin, register, logout, setUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
