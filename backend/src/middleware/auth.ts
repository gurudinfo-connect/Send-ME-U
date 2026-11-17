import type { NextFunction, Request, Response } from 'express';
import { verifyAccess } from '../lib/auth';
import { prisma } from '../lib/db';
import { HttpError } from '../lib/errors';

export interface AuthUser { id: string; role: 'USER' | 'MODERATOR' | 'ADMIN'; sessionId: string }
declare module 'express-serve-static-core' { interface Request { user: AuthUser } }

/** Verifies the bearer token AND that its session is live and the account is active (so logout / suspension bite immediately). */
export async function authenticate(token: string): Promise<AuthUser> {
  let claims;
  try { claims = verifyAccess(token); } catch { throw new HttpError(401, 'Session expired', 'token_expired'); }
  const s = await prisma.userSession.findUnique({ where: { id: claims.sid }, select: { revokedAt: true, expiresAt: true, user: { select: { id: true, role: true, status: true } } } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.user.id !== claims.sub) throw new HttpError(401, 'Session expired', 'session_revoked');
  if (s.user.status !== 'ACTIVE') throw new HttpError(403, s.user.status === 'SUSPENDED' ? 'This account is suspended' : 'Account unavailable', 'account_inactive');
  return { id: s.user.id, role: s.user.role as any, sessionId: claims.sid };
}

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new HttpError(401, 'Please sign in', 'no_token'));
  authenticate(h.slice(7)).then((u) => { req.user = u; next(); }, next);
};
export const requireRole = (...roles: Array<'MODERATOR' | 'ADMIN'>) => (req: Request, _res: Response, next: NextFunction) =>
  roles.includes(req.user.role as any) ? next() : next(new HttpError(403, 'Administrator access required', 'forbidden'));
