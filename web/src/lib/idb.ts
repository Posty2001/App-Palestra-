import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface OutboxOp {
  seq?: number;
  userId: string;
  method: 'PUT' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  /** Seduta a cui l'operazione appartiene (per riconciliare lo stato locale). */
  workoutId: string | null;
  createdAt: number;
  attempts: number;
}

interface Schema extends DBSchema {
  kv: { key: string; value: unknown };
  outbox: { key: number; value: OutboxOp; indexes: { byUser: string } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function idb(): Promise<IDBPDatabase<Schema>> {
  dbp ??= openDB<Schema>('app-palestra', 1, {
    upgrade(db) {
      db.createObjectStore('kv');
      const ob = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      ob.createIndex('byUser', 'userId');
    },
  });
  return dbp;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await idb()).get('kv', key)) as T | undefined;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await idb()).put('kv', value, key);
}
export async function kvDel(key: string): Promise<void> {
  await (await idb()).delete('kv', key);
}

/** Al logout si cancella tutto ciò che è locale (dispositivi condivisi). */
export async function clearLocal(): Promise<void> {
  const db = await idb();
  await db.clear('kv');
  await db.clear('outbox');
}

/**
 * Scrive in UNA transazione lo stato locale e (facoltativamente) l'operazione da sincronizzare:
 * o entrambi persistiti o nessuno. Chi chiama aggiorna la UI solo dopo il commit.
 */
export async function atomicWrite(key: string, value: unknown | null, op: Omit<OutboxOp, 'seq'> | null): Promise<void> {
  const db = await idb();
  const tx = db.transaction(['kv', 'outbox'], 'readwrite');
  if (value === null) await tx.objectStore('kv').delete(key);
  else await tx.objectStore('kv').put(value, key);
  if (op) await tx.objectStore('outbox').add(op as OutboxOp);
  await tx.done;
}
