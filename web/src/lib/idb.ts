import { db } from '../local/db';

/**
 * Preferenze e stato di interfaccia (timer di recupero, ultima scheda scelta…) nello store `meta`
 * dello stesso database dei dati: un solo archivio, incluso nel backup completo.
 */
const k = (key: string): string => `kv:${key}`;

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', k(key))) as T | undefined;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, k(key));
}
export async function kvDel(key: string): Promise<void> {
  await (await db()).delete('meta', k(key));
}
