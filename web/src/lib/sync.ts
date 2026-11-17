import { api, ApiError, NetworkError } from './api';
import { idb, type OutboxOp } from './idb';

/**
 * Coda di sincronizzazione (outbox) persistente in IndexedDB.
 * - Ogni scrittura della seduta è un'operazione idempotente (PUT con id generato dal client).
 * - Le operazioni partono in ordine; un errore di rete ferma la coda e la riprova più tardi.
 * - Un 4xx definitivo scarta solo quell'operazione (segnalandolo), senza bloccare le successive.
 */

export interface SyncState {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastError: string | null;
  lastSyncAt: number | null;
}

let state: SyncState = { online: typeof navigator === 'undefined' ? true : navigator.onLine, pending: 0, syncing: false, lastError: null, lastSyncAt: null };
const listeners = new Set<(s: SyncState) => void>();
let currentUser: string | null = null;
let flushing: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 2000;
const opListeners = new Set<(op: OutboxOp, result: 'ok' | 'rejected', err?: ApiError) => void>();

function set(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function onOpSettled(fn: (op: OutboxOp, result: 'ok' | 'rejected', err?: ApiError) => void): () => void {
  opListeners.add(fn);
  return () => opListeners.delete(fn);
}

async function countPending(): Promise<number> {
  if (!currentUser) return 0;
  return (await idb()).countFromIndex('outbox', 'byUser', currentUser);
}

export async function pendingOps(workoutId?: string): Promise<OutboxOp[]> {
  if (!currentUser) return [];
  const all = await (await idb()).getAllFromIndex('outbox', 'byUser', currentUser);
  return workoutId ? all.filter((o) => o.workoutId === workoutId) : all;
}

export async function startSync(userId: string): Promise<void> {
  currentUser = userId;
  set({ pending: await countPending() });
  void flush();
}

export function stopSync(): void {
  currentUser = null;
  set({ pending: 0, lastError: null });
}

/** Da chiamare dopo una scrittura atomica che ha già inserito l'operazione nella coda. */
export async function notifyEnqueued(): Promise<void> {
  set({ pending: await countPending() });
  void flush();
}

export function newOp(op: Omit<OutboxOp, 'createdAt' | 'attempts' | 'userId'>): Omit<OutboxOp, 'seq'> {
  if (!currentUser) throw new Error('Sync non avviata');
  return { ...op, userId: currentUser, createdAt: Date.now(), attempts: 0 };
}

export async function enqueue(op: Omit<OutboxOp, 'createdAt' | 'attempts' | 'userId'>): Promise<void> {
  if (!currentUser) throw new Error('Sync non avviata');
  await (await idb()).add('outbox', { ...op, userId: currentUser, createdAt: Date.now(), attempts: 0 });
  set({ pending: await countPending() });
  void flush();
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, backoff);
  backoff = Math.min(backoff * 2, 60_000);
}

export function flush(): Promise<void> {
  flushing ??= doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush(): Promise<void> {
  const user = currentUser;
  if (!user) return;
  set({ syncing: true });
  try {
    const db = await idb();
    for (;;) {
      const ops = await db.getAllFromIndex('outbox', 'byUser', user);
      const op = ops.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))[0];
      if (!op || op.seq === undefined) break;
      try {
        await api(op.method, op.path, op.body, { timeoutMs: 20_000 });
        await db.delete('outbox', op.seq);
        for (const l of opListeners) l(op, 'ok');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          set({ online: true, lastError: 'Sessione scaduta: accedi di nuovo per sincronizzare' });
          return;
        }
        if (err instanceof ApiError) {
          // Rifiuto definitivo (es. seduta già chiusa altrove): l'operazione non verrà mai accettata.
          await db.delete('outbox', op.seq);
          for (const l of opListeners) l(op, 'rejected', err);
          set({ lastError: err.code === 'workout_closed' ? null : err.message });
          continue;
        }
        if (err instanceof NetworkError) {
          await db.put('outbox', { ...op, attempts: op.attempts + 1 });
          set({ online: navigator.onLine ? state.online : false });
          scheduleRetry();
          return;
        }
        throw err;
      }
      backoff = 2000;
      set({ online: true, pending: await countPending() });
    }
    set({ lastSyncAt: Date.now(), lastError: state.lastError });
  } finally {
    set({ syncing: false, pending: await countPending() });
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    set({ online: true });
    backoff = 2000;
    void flush();
  });
  window.addEventListener('offline', () => set({ online: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush();
  });
  setInterval(() => {
    if (state.pending > 0) void flush();
  }, 30_000);
}
