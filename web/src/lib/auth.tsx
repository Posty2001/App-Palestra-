import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserDto } from '@palestra/shared';
import { get } from './api';
import { createProfile, loadProfile, updateProfile, type profileInputSchema } from '../local/profile';
import { initWorkoutStore } from './workoutStore';
import type { z } from 'zod';

/**
 * 3.0: nessun account. Il «profilo» è l'identità locale di questa installazione (nome, ruolo, chiavi).
 * L'interfaccia (useAuth/useUser) resta quella della 2.0 per non toccare le schermate.
 */
interface AuthCtx {
  user: UserDto | null;
  loading: boolean;
  /** Errore bloccante dell'archivio del browser (es. navigazione privata senza IndexedDB). */
  storageError: string | null;
  create: (input: z.infer<typeof profileInputSchema>) => Promise<void>;
  update: (patch: { displayName?: string; role?: 'athlete' | 'coach' }) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const p = await loadProfile();
      if (!p) {
        setUser(null);
        return;
      }
      const u = await get<UserDto>('/auth/me');
      await initWorkoutStore(u.id);
      setUser(u);
    } catch (err) {
      setStorageError(err instanceof Error ? err.message : 'Archivio del dispositivo non disponibile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async (input: z.infer<typeof profileInputSchema>) => {
    await createProfile(input);
    await refresh();
  }, [refresh]);

  const update = useCallback(async (patch: { displayName?: string; role?: 'athlete' | 'coach' }) => {
    await updateProfile(patch);
    await refresh();
  }, [refresh]);

  const value = useMemo(() => ({ user, loading, storageError, create, update, refresh }), [user, loading, storageError, create, update, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider mancante');
  return c;
}

export function useUser(): UserDto {
  const { user } = useAuth();
  if (!user) throw new Error('Profilo non configurato');
  return user;
}
