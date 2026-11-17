export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}
export const badRequest = (msg: string, code = 'bad_request') => new HttpError(400, code, msg);
export const unauthorized = (msg = 'Accesso richiesto') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Operazione non consentita') => new HttpError(403, 'forbidden', msg);
/** Usato anche al posto di 403 per non rivelare l'esistenza di risorse altrui. */
export const notFound = (msg = 'Non trovato') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict') => new HttpError(409, code, msg);
