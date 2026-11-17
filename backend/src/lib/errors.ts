export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code || ({ 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 423: 'locked', 429: 'rate_limited' } as Record<number, string>)[status] || 'error';
    this.details = details;
  }
}
export const bad = (m: string, details?: unknown) => new HttpError(400, m, 'bad_request', details);
export const unauthorized = (m = 'Please sign in again') => new HttpError(401, m);
export const forbidden = (m = 'You do not have access to this') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);
