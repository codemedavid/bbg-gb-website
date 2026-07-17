import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, unwrap } from '../lib/api';
import type { User } from '../lib/types';

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; phone?: string; password: string; address?: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    unwrap<{ user: User }>(api.get('/auth/me'))
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const d = await unwrap<{ user: User }>(api.post('/auth/login', { email, password }));
    setUser(d.user);
  };
  const register = async (input: { name: string; email: string; phone?: string; password: string; address?: string }) => {
    const d = await unwrap<{ user: User }>(api.post('/auth/register', input));
    setUser(d.user);
  };
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
