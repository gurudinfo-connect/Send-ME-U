import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from './db';
import { HttpError } from './errors';
import { randomToken, sha256 } from './crypto';

export interface AccessClaims { sub: string; sid: string; role: 'USER' | 'MODERATOR' | 'ADMIN' }
export const signAccess = (c: AccessClaims) => jwt.sign(c, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL as any, issuer: 'sendmeu' });
export const verifyAccess = (t: string): AccessClaims => jwt.verify(t, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'sendmeu' }) as any;
export const accessTtlSeconds = () => { const d = jwt.decode(signAccess({ sub: 'x', sid: 'x', role: 'USER' })) as any; return d.exp - d.iat; };

export interface ClientInfo { ip?: string; userAgent?: string; deviceName?: string; platform?: string }

/** New login: creates a session and its first refresh token. */
export async function startSession(user: { id: string; role: any }, info: ClientInfo) {
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 864e5);
  const session = await prisma.userSession.create({ data: { userId: user.id, ip: info.ip, userAgent: info.userAgent?.slice(0, 300), deviceName: info.deviceName?.slice(0, 80), platform: info.platform?.slice(0, 20), expiresAt } });
  const refreshToken = await issueRefresh(session.id, user.id, expiresAt);
  return { session, accessToken: signAccess({ sub: user.id, sid: session.id, role: user.role }), refreshToken, expiresIn: accessTtlSeconds() };
}

async function issueRefresh(sessionId: string, userId: string, expiresAt: Date, replaces?: string) {
  const token = randomToken(48);
  const row = await prisma.refreshToken.create({ data: { sessionId, userId, tokenHash: sha256(token), expiresAt } });
  if (replaces) await prisma.refreshToken.update({ where: { id: replaces }, data: { usedAt: new Date(), replacedById: row.id } });
  return token;
}

/**
 * Refresh-token rotation with reuse detection: every refresh returns a NEW token and burns the old one.
 * Presenting an already-used token means it leaked, so the whole session (token family) is revoked.
 */
export async function rotateRefresh(token: string, info: ClientInfo) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { session: { include: { user: true } } } });
  if (!row) throw new HttpError(401, 'Invalid refresh token', 'invalid_refresh');
  const { session } = row;
  if (row.usedAt || row.revokedAt) {
    // a small grace window tolerates two tabs racing the same refresh
    if (row.usedAt && Date.now() - row.usedAt.getTime() < 10_000 && !row.revokedAt) throw new HttpError(409, 'Token already refreshed, retry with the newest token', 'refresh_race');
    await revokeSession(session.id);
    throw new HttpError(401, 'Session revoked', 'refresh_reuse');
  }
  if (row.expiresAt < new Date() || session.revokedAt || session.expiresAt < new Date()) throw new HttpError(401, 'Session expired', 'session_expired');
  const user = session.user;
  if (user.status !== 'ACTIVE') throw new HttpError(403, user.status === 'SUSPENDED' ? 'This account is suspended' : 'Account unavailable', 'account_inactive');
  const next = await issueRefresh(session.id, user.id, session.expiresAt, row.id);
  await prisma.userSession.update({ where: { id: session.id }, data: { lastActiveAt: new Date(), ip: info.ip ?? session.ip } });
  return { accessToken: signAccess({ sub: user.id, sid: session.id, role: user.role }), refreshToken: next, expiresIn: accessTtlSeconds(), user };
}

export async function revokeSession(sessionId: string) {
  await prisma.$transaction([
    prisma.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.device.updateMany({ where: { sessionId }, data: { sessionId: null } }),
  ]);
}
export async function revokeAllSessions(userId: string, except?: string) {
  const ids = (await prisma.userSession.findMany({ where: { userId, revokedAt: null, ...(except ? { id: { not: except } } : {}) }, select: { id: true } })).map((s) => s.id);
  for (const id of ids) await revokeSession(id);
  return ids.length;
}
