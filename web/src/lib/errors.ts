/** Errore applicativo con la stessa forma delle risposte della 2.0 (status + codice + messaggio in italiano). */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

/** Errore temporaneo (es. archivio del browser non disponibile): l'operazione può essere ritentata. */
export class NetworkError extends Error {}

export const notFound = (msg = 'Non trovato'): ApiError => new ApiError(404, 'not_found', msg);
export const badRequest = (msg: string, code = 'bad_request'): ApiError => new ApiError(400, code, msg);
export const conflict = (msg: string, code = 'conflict'): ApiError => new ApiError(409, code, msg);
export const forbidden = (msg = 'Operazione non consentita'): ApiError => new ApiError(403, 'forbidden', msg);
