'use client';

import type { MeResponse } from '@academy/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, hasSessionCookie } from '@/lib/api';

interface AuthState {
  user: MeResponse | null;
  loading: boolean;
  /** Re-fetch /auth/me (after profile edits, verification, login…). */
  reload: () => Promise<MeResponse | null>;
  setUser: (u: MeResponse | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!hasSessionCookie()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const me = await api<MeResponse>('/auth/me');
      setUser(me);
      return me;
    } catch {
      // api() already refreshed an expired session once (deduplicated). Refreshing again here
      // after a network error or a request cut off by navigation would rotate the refresh
      // token without the browser ever storing the new one; the next page then presents the
      // old token, which the API treats as theft and signs the user out everywhere.
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, reload, setUser, logout }), [user, loading, reload, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
