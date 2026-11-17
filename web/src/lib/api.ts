export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

/** Errore di rete (offline, timeout): l'operazione può essere ritentata. */
export class NetworkError extends Error {}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export async function api<T>(method: Method, path: string, body?: unknown, opts: { timeoutMs?: number; silent401?: boolean } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  let res: Response;
  try {
    const isForm = body instanceof FormData;
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-requested-with': 'app-palestra',
        ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw new NetworkError('Connessione assente');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(res.status, 'error', 'Risposta non valida dal server');
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    if (res.status === 401 && !opts.silent401) onUnauthorized?.();
    if (res.status >= 500 || res.status === 502 || res.status === 503) throw new NetworkError(d.message ?? 'Server non raggiungibile');
    throw new ApiError(res.status, d.error ?? 'error', d.message ?? 'Errore');
  }
  return data as T;
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
