import { ApiError, NetworkError } from './errors';
import { handle } from '../local/router';

/**
 * 3.0: nessun server. `api()` mantiene la firma della 2.0 ma ogni richiesta è servita dal router locale
 * (IndexedDB sul dispositivo). Le schermate non sanno che il server non esiste più.
 */
export { ApiError, NetworkError };

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T>(method: Method, path: string, body?: unknown, _opts: { timeoutMs?: number; silent401?: boolean } = {}): Promise<T> {
  // Clonazione: la pagina non può modificare per errore gli oggetti salvati (come avveniva con la serializzazione HTTP).
  const input = body instanceof FormData || body instanceof Blob || body === undefined ? body : structuredClone(body);
  return (await handle(method, path, input)) as T;
}

export const get = <T>(p: string) => api<T>('GET', p);
export const post = <T>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T>(p: string, b: unknown) => api<T>('PUT', p, b);
export const patch = <T>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const del = <T>(p: string) => api<T>('DELETE', p);

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return 'Si è verificato un errore imprevisto';
}

export function uuid(): string {
  return crypto.randomUUID();
}
