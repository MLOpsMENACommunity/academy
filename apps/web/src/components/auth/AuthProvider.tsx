'use client';

import type { MeResponse } from '@academy/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, hasSessionCookie } from '@/lib/api';

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
    // api() refreshes an expired session itself, once and deduplicated. Never refresh again
    // here: after a network error or a request cut off by navigation, a second refresh can
    // rotate the token without the browser storing the new one, and the next page's old
    // token then looks like theft to the API, which signs the user out everywhere.
    const me = () => api<MeResponse>('/auth/me');
    try {
      let current: MeResponse;
      try {
        current = await me();
      } catch (err) {
        // Signed out for real, or a blip (deploy, flaky network): try once more for the latter.
        if (err instanceof ApiError && err.status === 401) throw err;
        await new Promise((r) => setTimeout(r, 1500));
        current = await me();
      }
      setUser(current);
      return current;
    } catch {
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
