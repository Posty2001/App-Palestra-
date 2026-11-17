import { useCallback, useEffect, useRef, useState } from 'react';
import type { TodayBundleDto } from '@palestra/shared';
import { errorMessage, get } from './api';
import { kvGet, kvSet } from './idb';
import { todayLocal } from './format';
import { bundleKey, reconcileActive } from './workoutStore';
import { flush, pendingOps } from './sync';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null; loading: boolean; reload: () => void; setData: (d: T) => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef.current()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: unknown) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** Pacchetto Oggi: prima la copia locale (immediata e offline), poi il server. */
export function useBundle(userId: string): { bundle: TodayBundleDto | null; offline: boolean; reload: () => void } {
  const [bundle, setBundle] = useState<TodayBundleDto | null>(null);
  const [offline, setOffline] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const cached = await kvGet<TodayBundleDto>(bundleKey(userId));
      if (cached && alive) setBundle(cached);
      try {
        await flush(); // prima si inviano le modifiche locali, poi si legge lo stato aggiornato
        const fresh = await get<TodayBundleDto>(`/bundle?today=${todayLocal()}`);
        if ((await pendingOps()).length === 0) await reconcileActive(fresh.activeWorkout);
        await kvSet(bundleKey(userId), fresh);
        if (alive) {
          setBundle(fresh);
          setOffline(false);
        }
      } catch {
        if (alive) setOffline(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId, tick]);
  return { bundle, offline, reload: () => setTick((t) => t + 1) };
}
