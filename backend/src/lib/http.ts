import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodTypeAny } from 'zod';
import { HttpError } from './errors';

export const wrap = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** Validate and replace req.body / req.query / req.params with parsed values. Failure -> 400 with field messages. */
export const validate = (spec: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }): RequestHandler => (req, _res, next) => {
  try {
    if (spec.params) (req as any).params = spec.params.parse(req.params);
    if (spec.query) (req as any).validQuery = spec.query.parse(req.query);
    if (spec.body) req.body = spec.body.parse(req.body ?? {});
    next();
  } catch (e) {
    if (e instanceof z.ZodError) {
      const fields = Object.fromEntries(e.issues.map((i) => [i.path.join('.') || '_', i.message]));
      return next(new HttpError(400, e.issues[0] ? `${e.issues[0].path.join('.') || 'Request'}: ${e.issues[0].message}` : 'Invalid request', 'validation_error', fields));
    }
    next(e);
  }
};
export const q = <T = any>(req: Request): T => (req as any).validQuery as T;

export const uuid = z.string().uuid('must be a valid id');
export const idParam = z.object({ id: uuid });
export const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
