import { api } from './api';

/**
 * 3.0: niente server, niente coda di invio. Questo modulo conserva l'interfaccia dell'indicatore della 2.0
 * e segnala l'unica cosa che conta in locale: se l'ultimo salvataggio sul dispositivo è riuscito.
 */
export interface SyncState {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastError: string | null;
  lastSyncAt: number | null;
}

let state: SyncState = { online: true, pending: 0, syncing: false, lastError: null, lastSyncAt: null };
const listeners = new Set<(s: SyncState) => void>();

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

export function reportSaved(): void {
  set({ lastError: null, lastSyncAt: Date.now() });
}

export function reportSaveError(message: string): void {
  set({ lastError: message });
}

/** Scrittura immediata nell'archivio locale (sostituisce l'accodamento verso il server della 2.0). */
export async function enqueue(op: { method: 'PUT' | 'POST' | 'PATCH' | 'DELETE'; path: string; body: unknown; workoutId: string | null }): Promise<void> {
  try {
    await api(op.method, op.path, op.body);
    reportSaved();
  } catch (err) {
    reportSaveError(err instanceof Error ? err.message : 'Salvataggio non riuscito');
    throw err;
  }
}
