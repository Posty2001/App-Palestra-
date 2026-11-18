import { useCallback, useEffect, useRef, useState } from 'react';
import type { TodayBundleDto } from '@palestra/shared';
import { errorMessage, get } from './api';
import { todayLocal } from './format';

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

/** Pacchetto Oggi: calcolato dall'archivio del dispositivo (sempre disponibile, anche senza rete). */
export function useBundle(userId: string): { bundle: TodayBundleDto | null; offline: boolean; reload: () => void } {
  const [bundle, setBundle] = useState<TodayBundleDto | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void get<TodayBundleDto>(`/bundle?today=${todayLocal()}`).then((b) => alive && setBundle(b));
    return () => {
      alive = false;
    };
  }, [userId, tick]);
  return { bundle, offline: false, reload: () => setTick((t) => t + 1) };
}
