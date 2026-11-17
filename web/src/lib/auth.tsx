import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserDto } from '@palestra/shared';
import { api, NetworkError, post, setUnauthorizedHandler } from './api';
import { clearLocal, kvGet, kvSet } from './idb';
import { flush, getSyncState, startSync, stopSync } from './sync';
import { initWorkoutStore, resetWorkoutStore } from './workoutStore';

interface AuthCtx {
  user: UserDto | null;
  loading: boolean;
  signedIn: (u: UserDto) => Promise<void>;
  logout: (force?: boolean) => Promise<{ ok: boolean; pending: number }>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
const LAST_USER = 'lastUser';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

  const activate = useCallback(async (u: UserDto) => {
    await kvSet(LAST_USER, u);
    await initWorkoutStore(u.id);
    await startSync(u.id);
    setUser(u);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const u = await api<UserDto>('GET', '/auth/me', undefined, { silent401: true });
      await activate(u);
    } catch (err) {
      // Offline: si riparte con l'ultimo utente noto per allenarsi senza rete.
      const last = err instanceof NetworkError ? await kvGet<UserDto>(LAST_USER) : undefined;
      if (last) await activate(last);
      else setUser(null);
    } finally {
      setLoading(false);
    }
  }, [activate]);

  useEffect(() => {
    void refresh();
    setUnauthorizedHandler(() => setUser(null));
  }, [refresh]);

  const logout = useCallback(async (force = false) => {
    await flush();
    const pending = getSyncState().pending;
    if (pending > 0 && !force) return { ok: false, pending };
    try {
      await post('/auth/logout');
    } catch {
      /* anche offline si esce localmente */
    }
    stopSync();
    resetWorkoutStore();
    await clearLocal();
    setUser(null);
    return { ok: true, pending: 0 };
  }, []);

  const value = useMemo(() => ({ user, loading, signedIn: activate, logout, refresh }), [user, loading, activate, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider mancante');
  return c;
}

export function useUser(): UserDto {
  const { user } = useAuth();
  if (!user) throw new Error('Utente non autenticato');
  return user;
}
