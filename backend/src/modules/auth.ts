import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { hashPassword, hmac, randomCode, safeEqual, verifyPassword } from '../lib/crypto';
import { prisma } from '../lib/db';
import { HttpError, bad } from '../lib/errors';
import { validate, wrap } from '../lib/http';
import { ClientInfo, revokeAllSessions, revokeSession, rotateRefresh, startSession } from '../lib/auth';
import { sendOtp } from '../lib/mail';
import { requireAuth } from '../middleware/auth';
import { authLimiter, otpLimiter } from '../middleware/rateLimit';
import { USERNAME_RE, RESERVED, audit, isEmail, meDto, normEmail, normPhone, normUsername, userInclude, toDate } from './common';

export const authRouter = Router();

const clientInfo = (req: any, body: any = {}): ClientInfo => ({ ip: req.ip, userAgent: req.headers['user-agent'], deviceName: body.deviceName, platform: body.platform });
const password = z.string().min(8, 'At least 8 characters').max(128).refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and at least one number');
const identifier = z.string().trim().min(3).max(120);

// A hash to verify against when the account does not exist, so response time does not reveal which accounts exist.
let dummyHash: Promise<string> | null = null;
const DUMMY = () => (dummyHash ||= hashPassword('not-a-real-password-1'));
const OTP_TTL = 10 * 60_000;

async function findByIdentifier(idf: string) {
  const v = idf.trim();
  const where = isEmail(v) ? { email: normEmail(v) } : /^\+?[0-9\s()-]{8,18}$/.test(v) ? { phone: normPhone(v) } : { username: normUsername(v) };
  return prisma.user.findUnique({ where: where as any, include: userInclude });
}

async function issueOtp(target: string, purpose: 'REGISTER' | 'LOGIN' | 'RESET_PASSWORD' | 'PHONE_VERIFY', userId?: string) {
  // one live code per target+purpose; a new request replaces the old one
  await prisma.otpCode.updateMany({ where: { target, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  const code = randomCode(6);
  await prisma.otpCode.create({ data: { target, purpose, userId, codeHash: hmac(`${target}:${purpose}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL) } });
  await sendOtp(target, code, purpose);
  return code;
}
/** Verifies and burns a code. 5 wrong tries kill it. */
async function consumeOtp(target: string, purpose: 'REGISTER' | 'LOGIN' | 'RESET_PASSWORD' | 'PHONE_VERIFY', code: string) {
  const row = await prisma.otpCode.findFirst({ where: { target, purpose, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!row || row.attempts >= 5) throw new HttpError(400, 'That code has expired. Request a new one.', 'otp_expired');
  if (!safeEqual(row.codeHash, hmac(`${target}:${purpose}:${code}`))) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new HttpError(400, 'Incorrect code', 'otp_invalid');
  }
  await prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return row;
}
const otpTarget = (idf: string) => (isEmail(idf) ? normEmail(idf) : normPhone(idf));

function suggestUsername(base: string) { return base.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 20) || 'user'; }

// ── username availability (public, rate-limited by the global limiter) ──
authRouter.get('/username-available', wrap(async (req, res) => {
  const u = normUsername(String(req.query.username || ''));
  if (!USERNAME_RE.test(u)) return res.json({ available: false, reason: 'Use 3–30 letters, numbers, . or _' });
  if (RESERVED.has(u)) return res.json({ available: false, reason: 'That username is reserved' });
  const taken = await prisma.user.findUnique({ where: { username: u }, select: { id: true } });
  res.json({ available: !taken, reason: taken ? 'Already taken' : undefined });
}));

// ── register ──
const registerBody = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(60).optional(),
  fullName: z.string().trim().min(2).max(60).optional(),
  identifier: identifier.optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().regex(/^\+?[0-9\s()-]{8,18}$/, 'Enter a valid phone number').optional(),
  username: z.string().trim().optional(),
  password,
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  bio: z.string().max(200).optional(),
  deviceName: z.string().max(80).optional(), platform: z.string().max(20).optional(),
}).refine((b) => b.name || b.fullName, { message: 'Enter your full name', path: ['name'] })
  .refine((b) => b.identifier || b.email || b.phone, { message: 'Email or phone is required', path: ['identifier'] });

authRouter.post('/register', authLimiter, validate({ body: registerBody }), wrap(async (req, res) => {
  const b = req.body as z.infer<typeof registerBody>;
  let email = b.email ? normEmail(b.email) : undefined;
  let phone = b.phone ? normPhone(b.phone) : undefined;
  if (b.identifier) { if (isEmail(b.identifier)) email ||= normEmail(b.identifier); else phone ||= normPhone(b.identifier); }
  if (!email && !phone) throw bad('Email or phone is required');
  if (b.dateOfBirth) {
    const dob = new Date(b.dateOfBirth); const age = (Date.now() - dob.getTime()) / (365.25 * 864e5);
    if (Number.isNaN(age) || age < 13 || age > 120) throw bad('You must be at least 13 to use Send ME/U');
  }
  const fullName = (b.fullName || b.name)!;
  let username = b.username ? normUsername(b.username) : '';
  if (username) {
    if (!USERNAME_RE.test(username)) throw bad('Username must be 3–30 letters, numbers, . or _');
    if (RESERVED.has(username)) throw bad('That username is reserved');
  } else {
    const base = suggestUsername(email ? email.split('@')[0] : fullName);
    username = base.length >= 3 ? base : `${base}user`;
    for (let i = 0; i < 6 && (await prisma.user.findUnique({ where: { username }, select: { id: true } })); i++) username = `${base}${Math.floor(100 + Math.random() * 9000)}`.slice(0, 30);
  }
  const clash = await prisma.user.findFirst({ where: { OR: [{ username }, ...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] }, select: { username: true, email: true, phone: true } });
  if (clash) throw new HttpError(409, clash.username === username ? 'That username is taken' : 'An account with those details already exists', 'conflict');

  const passwordHash = await hashPassword(b.password);
  const user = await prisma.user.create({
    data: {
      email: email || `${username}@phone.sendmeu.invalid`, phone, username, passwordHash, fullName,
      dateOfBirth: toDate(b.dateOfBirth), // a phone-only account gets a placeholder email until one is added
      emailVerifiedAt: null,
      profile: { create: { bio: b.bio ?? '' } },
      settings: { create: {} },
    },
    include: userInclude,
  });
  await audit(user.id, 'auth.register', { type: 'user', id: user.id }, undefined, req.ip);

  const target = email || phone!;
  const code = await issueOtp(target, 'REGISTER', user.id);
  const dev = env.EXPOSE_DEV_OTP ? { devOtp: code } : {};
  if (env.REQUIRE_EMAIL_VERIFICATION) return res.status(201).json({ verificationRequired: true, target, ...dev });
  const s = await startSession(user, clientInfo(req, b));
  res.status(201).json({ token: s.accessToken, accessToken: s.accessToken, refreshToken: s.refreshToken, expiresIn: s.expiresIn, user: meDto(user), verificationRequired: false, ...dev });
}));

// ── login (password) ──
const loginBody = z.object({ identifier, password: z.string().min(1).max(128), deviceName: z.string().max(80).optional(), platform: z.string().max(20).optional() });
authRouter.post('/login', authLimiter, validate({ body: loginBody }), wrap(async (req, res) => {
  const b = req.body as z.infer<typeof loginBody>;
  const user = await findByIdentifier(b.identifier);
  const generic = new HttpError(401, 'Invalid credentials', 'invalid_credentials');
  if (!user || user.status === 'DELETED') { await verifyPassword(await DUMMY(), b.password); throw generic; }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new HttpError(423, 'Too many failed attempts. Try again in a few minutes.', 'locked');
  const ok = await verifyPassword(user.passwordHash, b.password);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({ where: { id: user.id }, data: failed >= 8 ? { failedLogins: 0, lockedUntil: new Date(Date.now() + 15 * 60_000) } : { failedLogins: failed } });
    await audit(user.id, 'auth.login_failed', { type: 'user', id: user.id }, { failed }, req.ip);
    throw generic;
  }
  if (user.status === 'SUSPENDED') throw new HttpError(403, user.suspendedReason ? `This account is suspended: ${user.suspendedReason}` : 'This account is suspended', 'account_suspended');
  if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt && !user.phoneVerifiedAt) {
    const code = await issueOtp(user.phone && !isEmail(b.identifier) ? user.phone : user.email, 'REGISTER', user.id);
    return res.status(403).json({ error: { code: 'verification_required', message: 'Verify your account to continue' }, message: 'Verify your account to continue', verificationRequired: true, ...(env.EXPOSE_DEV_OTP ? { devOtp: code } : {}) });
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastSeenAt: new Date() } });
  const s = await startSession(user, clientInfo(req, b));
  await audit(user.id, 'auth.login', { type: 'session', id: s.session.id }, undefined, req.ip);
  res.json({ token: s.accessToken, accessToken: s.accessToken, refreshToken: s.refreshToken, expiresIn: s.expiresIn, user: meDto(user) });
}));

// ── OTP: request a login/verify code, then verify it ──
authRouter.post('/request-otp', otpLimiter, validate({ body: z.object({ identifier, purpose: z.enum(['LOGIN', 'REGISTER', 'PHONE_VERIFY']).default('LOGIN') }) }), wrap(async (req, res) => {
  const user = await findByIdentifier(req.body.identifier);
  // identical response whether or not the account exists
  if (user && user.status === 'ACTIVE') {
    const code = await issueOtp(otpTarget(req.body.identifier), req.body.purpose, user.id);
    if (env.EXPOSE_DEV_OTP) return res.json({ sent: true, devOtp: code });
  }
  res.json({ sent: true });
}));

authRouter.post('/verify-otp', authLimiter, validate({ body: z.object({ identifier, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'), purpose: z.enum(['LOGIN', 'REGISTER', 'PHONE_VERIFY']).default('REGISTER'), deviceName: z.string().max(80).optional(), platform: z.string().max(20).optional() }) }), wrap(async (req, res) => {
  const { identifier: idf, code, purpose } = req.body;
  const user = await findByIdentifier(idf);
  if (!user || user.status !== 'ACTIVE') throw new HttpError(400, 'Incorrect code', 'otp_invalid');
  await consumeOtp(otpTarget(idf), purpose, code);
  const viaEmail = isEmail(idf);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: viaEmail ? { emailVerifiedAt: user.emailVerifiedAt ?? new Date() } : { phoneVerifiedAt: user.phoneVerifiedAt ?? new Date() },
    include: userInclude,
  });
  const s = await startSession(updated, clientInfo(req, req.body));
  res.json({ token: s.accessToken, accessToken: s.accessToken, refreshToken: s.refreshToken, expiresIn: s.expiresIn, user: meDto(updated) });
}));

// ── refresh (rotation) / logout ──
authRouter.post('/refresh', validate({ body: z.object({ refreshToken: z.string().min(20).max(200) }) }), wrap(async (req, res) => {
  const r = await rotateRefresh(req.body.refreshToken, clientInfo(req));
  res.json({ token: r.accessToken, accessToken: r.accessToken, refreshToken: r.refreshToken, expiresIn: r.expiresIn });
}));
authRouter.post('/logout', requireAuth, wrap(async (req, res) => {
  await revokeSession(req.user.sessionId);
  await audit(req.user.id, 'auth.logout', { type: 'session', id: req.user.sessionId }, undefined, req.ip);
  res.json({ ok: true });
}));
authRouter.post('/logout-all', requireAuth, wrap(async (req, res) => {
  const n = await revokeAllSessions(req.user.id);
  res.json({ ok: true, revoked: n });
}));

// ── sessions / devices ──
authRouter.get('/sessions', requireAuth, wrap(async (req, res) => {
  const rows = await prisma.userSession.findMany({ where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastActiveAt: 'desc' } });
  res.json(rows.map((s) => ({ id: s.id, deviceName: s.deviceName, platform: s.platform, userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt, lastActiveAt: s.lastActiveAt, current: s.id === req.user.sessionId })));
}));
authRouter.delete('/sessions/:id', requireAuth, validate({ params: z.object({ id: z.string().uuid() }) }), wrap(async (req, res) => {
  const s = await prisma.userSession.findFirst({ where: { id: req.params.id, userId: req.user.id }, select: { id: true } });
  if (!s) throw new HttpError(404, 'Session not found');
  await revokeSession(s.id);
  res.json({ ok: true });
}));

// ── forgot / reset password ──
authRouter.post('/forgot-password', otpLimiter, validate({ body: z.object({ identifier }) }), wrap(async (req, res) => {
  const user = await findByIdentifier(req.body.identifier);
  let dev: Record<string, string> = {};
  if (user && user.status === 'ACTIVE') {
    const code = await issueOtp(otpTarget(req.body.identifier), 'RESET_PASSWORD', user.id);
    if (env.EXPOSE_DEV_OTP) dev = { devOtp: code };
  }
  res.json({ ok: true, ...dev }); // same answer for unknown accounts: no account enumeration
}));
authRouter.post('/reset-password', authLimiter, validate({ body: z.object({ identifier, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'), password }) }), wrap(async (req, res) => {
  const user = await findByIdentifier(req.body.identifier);
  if (!user || user.status !== 'ACTIVE') throw new HttpError(400, 'Incorrect code', 'otp_invalid');
  await consumeOtp(otpTarget(req.body.identifier), 'RESET_PASSWORD', req.body.code);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(req.body.password), failedLogins: 0, lockedUntil: null } });
  await revokeAllSessions(user.id); // a reset signs out every device
  await audit(user.id, 'auth.password_reset', { type: 'user', id: user.id }, undefined, req.ip);
  res.json({ ok: true });
}));

authRouter.post('/change-password', requireAuth, validate({ body: z.object({ currentPassword: z.string().min(1), newPassword: password }) }), wrap(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
  if (!(await verifyPassword(user.passwordHash, req.body.currentPassword))) throw new HttpError(400, 'Current password is incorrect', 'invalid_credentials');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(req.body.newPassword) } });
  await revokeAllSessions(user.id, req.user.sessionId); // keep this device signed in, sign out the rest
  res.json({ ok: true });
}));
