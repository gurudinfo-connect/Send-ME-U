import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '../lib/db';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';

export const notFoundHandler: RequestHandler = (req, res) => { res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` }, message: 'Not found' }); };

// One error shape everywhere: { error: { code, message, details? }, message } (top-level `message` is what the web app reads).
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500; let code = 'internal_error'; let message = 'Something went wrong'; let details: unknown;
  if (err instanceof HttpError) { status = err.status; code = err.code; message = err.message; details = err.details; }
  else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') { status = 409; code = 'conflict'; message = 'That already exists'; }
    else if (err.code === 'P2025') { status = 404; code = 'not_found'; message = 'Not found'; }
    else if (err.code === 'P2003') { status = 400; code = 'bad_reference'; message = 'Referenced item does not exist'; }
    else logger.error({ err: err.message, code: err.code, path: req.path }, 'db error');
    // exclusion / check constraint violations raised by the database itself
    if (err.code === 'P2010' || err.code === 'P2004') { status = 409; code = 'conflict'; message = 'That conflicts with an existing item'; }
  } else if ((err as any)?.code === 'LIMIT_FILE_SIZE') { status = 413; code = 'file_too_large'; message = 'That file is too large'; }
  else if ((err as any)?.type === 'entity.too.large') { status = 413; code = 'payload_too_large'; message = 'Request too large'; }
  else if ((err as any)?.type === 'entity.parse.failed') { status = 400; code = 'bad_json'; message = 'Invalid JSON body'; }
  else if ((err as any)?.code === '23P01') { status = 409; code = 'conflict'; message = 'That time overlaps an existing booking'; }
  else logger.error({ err: err?.stack || String(err), path: req.path, method: req.method }, 'unhandled error');
  if (status === 500 && process.env.NODE_ENV !== 'production') details = String(err?.message || err);
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) }, message });
};
