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
      // Access token expired: refresh once, then give up.
      try {
        const ok = await fetch('/api/auth/refresh', { method: 'POST' }).then((r) => r.ok || r.status === 409);
        const me = ok ? await api<MeResponse>('/auth/me') : null;
        setUser(me);
        return me;
      } catch {
        setUser(null);
        return null;
      }
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
