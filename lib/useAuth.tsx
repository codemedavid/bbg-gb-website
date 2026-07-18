'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiSend } from './api-client';
import type { User } from './types';

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; phone?: string; password: string; address?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ user: User }>('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const d = await apiSend<{ user: User }>('/auth/login', 'POST', { email, password });
    setUser(d.user);
  };
  const adminLogin = async (email: string, password: string) => {
    const d = await apiSend<{ user: User }>('/admin/login', 'POST', { email, password });
    setUser(d.user);
  };
  const register = async (input: { name: string; email: string; phone?: string; password: string; address?: string }) => {
    const d = await apiSend<{ user: User }>('/auth/register', 'POST', input);
    setUser(d.user);
  };
  const logout = async () => {
    await apiSend('/auth/logout', 'POST').catch(() => {});
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, adminLogin, register, logout, setUser }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
