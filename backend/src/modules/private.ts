import { Router, Request } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env';
import { hashPassword, randomToken, verifyPassword } from '../lib/crypto';
import { prisma } from '../lib/db';
import { HttpError, bad, notFound } from '../lib/errors';
import { uuid, validate, wrap } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { audit } from './common';

// Private Space. A conversation the user locked is omitted from every normal list and refuses reads/writes unless the
// request carries a short-lived X-Private-Token minted by POST /private-space/unlock. All checks are on the server.

const SECRET = `${env.JWT_ACCESS_SECRET}:private-space`;
const pinRule = z.string().regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits');
const MAX_FAILS = 5;

const mint = (userId: string, sessionId: string, seconds: number) => jwt.sign({ sub: userId, sid: sessionId, ps: 1 }, SECRET, { expiresIn: seconds });
export function verifyPrivateToken(t: unknown, userId: string, sessionId: string): boolean {
  if (typeof t !== 'string') return false;
  try { const c = jwt.verify(t, SECRET) as any; return c.sub === userId && c.sid === sessionId && c.ps === 1; } catch { return false; }
}
export function hasPrivateAccess(req: Request): boolean {
  return verifyPrivateToken(req.headers['x-private-token'], req.user.id, req.user.sessionId);
}
export async function lockedConversationIds(userId: string): Promise<string[]> {
  return (await prisma.privateChat.findMany({ where: { userId }, select: { conversationId: true } })).map((r) => r.conversationId);
}
/** Throws 423 when the conversation is in the caller's Private Space and no valid unlock token was sent. */
export async function assertConversationAccessible(req: Request, conversationId: string) {
  const locked = await prisma.privateChat.findUnique({ where: { userId_conversationId: { userId: req.user.id, conversationId } } });
  if (locked && !hasPrivateAccess(req)) throw new HttpError(423, 'This chat is in your Private Space. Unlock it first.', 'locked');
}

async function settings(userId: string) { return prisma.userSettings.upsert({ where: { userId }, create: { userId }, update: {} }); }
const ttl = (s: { autoLockSeconds: number }) => Math.min(900, Math.max(15, s.autoLockSeconds));

async function verifyPin(userId: string, pin: string) {
  const s = await settings(userId);
  if (!s.pinHash) throw new HttpError(409, 'Set a Private Space PIN first', 'pin_not_set');
  if (s.pinLockedUntil && s.pinLockedUntil > new Date()) throw new HttpError(423, `Too many wrong PINs. Try again in ${Math.ceil((s.pinLockedUntil.getTime() - Date.now()) / 60000)} min.`, 'pin_locked');
  if (!(await verifyPassword(s.pinHash, pin))) {
    const fails = s.pinFailedAttempts + 1;
    await prisma.userSettings.update({ where: { userId }, data: fails >= MAX_FAILS ? { pinFailedAttempts: 0, pinLockedUntil: new Date(Date.now() + 15 * 60_000) } : { pinFailedAttempts: fails } });
    throw new HttpError(401, fails >= MAX_FAILS ? 'Too many wrong PINs. Locked for 15 minutes.' : `Incorrect PIN (${MAX_FAILS - fails} tries left)`, 'pin_invalid');
  }
  if (s.pinFailedAttempts) await prisma.userSettings.update({ where: { userId }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
  return s;
}
const recoveryCode = () => `${randomToken(6)}-${randomToken(6)}`.toUpperCase().replace(/[-_]/g, 'X').match(/.{1,4}/g)!.join('-');

export async function setLocked(req: Request, conversationId: string, locked: boolean) {
  const m = await prisma.conversationMember.findFirst({ where: { conversationId, userId: req.user.id, leftAt: null } });
  if (!m) throw notFound('Chat not found');
  if (locked) {
    const s = await settings(req.user.id);
    if (!s.pinHash) throw new HttpError(409, 'Set a Private Space PIN before locking chats', 'pin_not_set');
    await prisma.privateChat.upsert({ where: { userId_conversationId: { userId: req.user.id, conversationId } }, create: { userId: req.user.id, conversationId }, update: {} });
  } else {
    if (!hasPrivateAccess(req)) throw new HttpError(423, 'Unlock Private Space to remove a chat from it', 'locked');
    await prisma.privateChat.deleteMany({ where: { userId: req.user.id, conversationId } });
  }
}

export const privateRouter = Router();
privateRouter.use(requireAuth);

privateRouter.get('/status', wrap(async (req, res) => {
  const s = await settings(req.user.id);
  res.json({ pinSet: !!s.pinHash, biometricEnabled: s.biometricEnabled, autoLockSeconds: s.autoLockSeconds, hideNotificationPreviews: s.hideNotificationPreviews, hidden: s.privateSpaceHidden, unlocked: hasPrivateAccess(req), count: await prisma.privateChat.count({ where: { userId: req.user.id } }) });
}));

privateRouter.post('/setup', validate({ body: z.object({ pin: pinRule }) }), wrap(async (req, res) => {
  const s = await settings(req.user.id);
  if (s.pinHash) throw new HttpError(409, 'A PIN is already set. Use change-pin.', 'conflict');
  const code = recoveryCode();
  await prisma.userSettings.update({ where: { userId: req.user.id }, data: { pinHash: await hashPassword(req.body.pin), recoveryHash: await hashPassword(code), pinFailedAttempts: 0, pinLockedUntil: null } });
  await audit(req.user.id, 'private.setup', undefined, undefined, req.ip);
  // the recovery code is shown exactly once; only its hash is stored
  res.status(201).json({ ok: true, recoveryCode: code, token: mint(req.user.id, req.user.sessionId, ttl(s)), expiresIn: ttl(s) });
}));

privateRouter.post('/unlock', validate({ body: z.object({ pin: pinRule.optional(), biometricSecret: z.string().min(20).max(200).optional() }).refine((b) => b.pin || b.biometricSecret, 'Enter your PIN') }), wrap(async (req, res) => {
  let s;
  if (req.body.pin) s = await verifyPin(req.user.id, req.body.pin);
  else {
    s = await settings(req.user.id);
    if (!s.biometricEnabled || !s.biometricHash || !(await verifyPassword(s.biometricHash, req.body.biometricSecret))) throw new HttpError(401, 'Biometric unlock is not available', 'pin_invalid');
  }
  res.json({ token: mint(req.user.id, req.user.sessionId, ttl(s)), expiresIn: ttl(s) });
}));
privateRouter.post('/touch', wrap(async (req, res) => { // sliding window while the user is active
  if (!hasPrivateAccess(req)) throw new HttpError(423, 'Private Space is locked', 'locked');
  const s = await settings(req.user.id); res.json({ token: mint(req.user.id, req.user.sessionId, ttl(s)), expiresIn: ttl(s) });
}));

privateRouter.post('/change-pin', validate({ body: z.object({ currentPin: pinRule, newPin: pinRule }) }), wrap(async (req, res) => {
  await verifyPin(req.user.id, req.body.currentPin);
  await prisma.userSettings.update({ where: { userId: req.user.id }, data: { pinHash: await hashPassword(req.body.newPin) } });
  await audit(req.user.id, 'private.change_pin', undefined, undefined, req.ip);
  res.json({ ok: true });
}));
privateRouter.post('/recover', validate({ body: z.object({ recoveryCode: z.string().min(8).max(40), newPin: pinRule }) }), wrap(async (req, res) => {
  const s = await settings(req.user.id);
  if (!s.recoveryHash) throw new HttpError(409, 'No recovery code on file', 'conflict');
  if (s.pinLockedUntil && s.pinLockedUntil > new Date()) throw new HttpError(423, 'Too many attempts. Try again later.', 'pin_locked');
  if (!(await verifyPassword(s.recoveryHash, req.body.recoveryCode.toUpperCase().trim()))) {
    await prisma.userSettings.update({ where: { userId: req.user.id }, data: { pinFailedAttempts: { increment: 1 }, ...(s.pinFailedAttempts + 1 >= MAX_FAILS ? { pinFailedAttempts: 0, pinLockedUntil: new Date(Date.now() + 15 * 60_000) } : {}) } });
    throw new HttpError(401, 'Incorrect recovery code', 'pin_invalid');
  }
  const code = recoveryCode(); // the old code is single-use
  await prisma.userSettings.update({ where: { userId: req.user.id }, data: { pinHash: await hashPassword(req.body.newPin), recoveryHash: await hashPassword(code), pinFailedAttempts: 0, pinLockedUntil: null, biometricEnabled: false, biometricHash: null } });
  await audit(req.user.id, 'private.recover', undefined, undefined, req.ip);
  res.json({ ok: true, recoveryCode: code });
}));

privateRouter.put('/settings', validate({ body: z.object({ autoLockSeconds: z.number().int().min(15).max(900).optional(), hideNotificationPreviews: z.boolean().optional(), hidden: z.boolean().optional() }) }), wrap(async (req, res) => {
  const { hidden, ...rest } = req.body;
  const s = await prisma.userSettings.update({ where: { userId: req.user.id }, data: { ...rest, ...(hidden !== undefined ? { privateSpaceHidden: hidden } : {}) } });
  res.json({ autoLockSeconds: s.autoLockSeconds, hideNotificationPreviews: s.hideNotificationPreviews, hidden: s.privateSpaceHidden });
}));
// Biometrics: the phone's Face/Touch ID gates access to a random secret the server issued here and only stores hashed.
privateRouter.post('/biometric/enable', wrap(async (req, res) => {
  if (!hasPrivateAccess(req)) throw new HttpError(423, 'Unlock Private Space first', 'locked');
  const secret = randomToken(32);
  await prisma.userSettings.update({ where: { userId: req.user.id }, data: { biometricEnabled: true, biometricHash: await hashPassword(secret) } });
  res.json({ biometricSecret: secret });
}));
privateRouter.post('/biometric/disable', wrap(async (req, res) => {
  await prisma.userSettings.update({ where: { userId: req.user.id }, data: { biometricEnabled: false, biometricHash: null } });
  res.json({ ok: true });
}));

privateRouter.post('/lock', validate({ body: z.object({ conversationId: uuid }) }), wrap(async (req, res) => { await setLocked(req, req.body.conversationId, true); res.json({ locked: true }); }));
privateRouter.post('/remove', validate({ body: z.object({ conversationId: uuid }) }), wrap(async (req, res) => { await setLocked(req, req.body.conversationId, false); res.json({ locked: false }); }));
privateRouter.get('/chats', wrap(async (req, res) => {
  if (!hasPrivateAccess(req)) throw new HttpError(423, 'Private Space is locked', 'locked');
  const { listConversations } = await import('./chat');
  res.json(await listConversations(req.user.id, { onlyLocked: true }));
}));
void bad;
