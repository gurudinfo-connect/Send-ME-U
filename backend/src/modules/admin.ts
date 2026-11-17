import fs from 'node:fs/promises';
import os from 'node:os';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma, Prisma } from '../lib/db';
import { HttpError, bad, forbidden, notFound } from '../lib/errors';
import { idParam, page, q, uuid, validate, wrap } from '../lib/http';
import { notify } from '../lib/notify';
import { redis } from '../lib/redis';
import { emitToConversation, emitToUser, getIo } from '../lib/realtime';
import { removeObject, toUrl } from '../lib/storage';
import { revokeAllSessions } from '../lib/auth';
import { requireAuth, requireRole } from '../middleware/auth';
import { unreferenced } from './chat';
import { audit, MS } from './common';

/**
 * Admin API. MODERATOR can work the reports queue and moderate content; everything touching accounts' state
 * (suspend, role changes, audit logs, system) needs ADMIN. Every write is audit-logged. Message bodies are NOT
 * exposed: moderators see only the reported message when a report points at it (no E2EE is claimed, but no browsing either).
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('MODERATOR', 'ADMIN'));
const adminOnly = requireRole('ADMIN');
const ip = (req: any) => String(req.ip || '');

const userRow = (u: any) => ({
  id: u.id, name: u.fullName, username: u.username, email: u.email, phone: u.phone, role: u.role, status: u.status.toLowerCase(), suspendedReason: u.suspendedReason,
  verified: u.verified, isPrivate: u.isPrivate, avatar: toUrl(u.profile?.avatarThumbUrl || u.profile?.avatarUrl), createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
});

// ───────────────────────────── stats / analytics ─────────────────────────────

adminRouter.get('/stats', wrap(async (_req, res) => {
  const now = Date.now(); const d1 = new Date(now - MS.day); const d7 = new Date(now - 7 * MS.day);
  const [users, active, suspended, newToday, new7, messages24, stories, posts, openReports, couples, calls24, online] = await Promise.all([
    prisma.user.count({ where: { status: { not: 'DELETED' } } }),
    prisma.user.count({ where: { status: 'ACTIVE', lastSeenAt: { gte: d7 } } }),
    prisma.user.count({ where: { status: 'SUSPENDED' } }),
    prisma.user.count({ where: { createdAt: { gte: d1 } } }),
    prisma.user.count({ where: { createdAt: { gte: d7 } } }),
    prisma.message.count({ where: { createdAt: { gte: d1 } } }),
    prisma.story.count({ where: { deletedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.post.count({ where: { deletedAt: null } }),
    prisma.report.count({ where: { status: { in: ['OPEN', 'REVIEWING'] } } }),
    prisma.coupleConnection.count({ where: { status: 'ACTIVE' } }),
    prisma.call.count({ where: { createdAt: { gte: d1 } } }),
    Promise.resolve(getIo()?.engine?.clientsCount ?? 0),
  ]);
  res.json({ users, activeUsers7d: active, suspended, newUsers24h: newToday, newUsers7d: new7, messages24h: messages24, liveStories: stories, posts, openReports, activeCouples: couples, calls24h: calls24, socketsConnected: online });
}));

adminRouter.get('/analytics', validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }) }), wrap(async (req, res) => {
  const { days } = q<{ days: number }>(req);
  const since = new Date(Date.now() - days * MS.day);
  const series = async (table: string, col = 'created_at') =>
    (await prisma.$queryRawUnsafe<{ d: Date; n: bigint }[]>(`SELECT date_trunc('day', ${col}) AS d, count(*) AS n FROM ${table} WHERE ${col} >= $1 GROUP BY 1 ORDER BY 1`, since)).map((r) => ({ date: r.d.toISOString().slice(0, 10), count: Number(r.n) }));
  const [signups, messages, stories, calls] = await Promise.all([series('users'), series('messages'), series('stories'), series('calls')]);
  res.json({ days, signups, messages, stories, calls });
}));

// ───────────────────────────── users ─────────────────────────────

adminRouter.get('/users', validate({ query: page.extend({ q: z.string().trim().max(80).optional(), status: z.enum(['active', 'suspended', 'deleted']).optional(), role: z.enum(['USER', 'MODERATOR', 'ADMIN']).optional() }) }), wrap(async (req, res) => {
  const { limit, offset, q: term, status, role } = q<any>(req);
  const where: Prisma.UserWhereInput = {
    ...(status ? { status: status.toUpperCase() } : {}), ...(role ? { role } : {}),
    ...(term ? { OR: [{ username: { contains: term.toLowerCase().replace(/^@/, ''), mode: 'insensitive' } }, { fullName: { contains: term, mode: 'insensitive' } }, { email: { contains: term.toLowerCase() } }] } : {}),
  };
  const [total, rows] = await Promise.all([prisma.user.count({ where }), prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset, include: { profile: true } })]);
  res.json({ total, items: rows.map(userRow) });
}));

adminRouter.get('/users/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.params.id }, include: { profile: true } });
  if (!u) throw notFound('User not found');
  const [followers, following, posts, messagesSent, reportsAgainst, reportsFiled, sessions] = await Promise.all([
    prisma.follow.count({ where: { followeeId: u.id } }), prisma.follow.count({ where: { followerId: u.id } }), prisma.post.count({ where: { userId: u.id, deletedAt: null } }),
    prisma.message.count({ where: { senderId: u.id } }), prisma.report.count({ where: { reportedUserId: u.id } }), prisma.report.count({ where: { reporterId: u.id } }),
    prisma.userSession.count({ where: { userId: u.id, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  res.json({ ...userRow(u), counts: { followers, following, posts, messagesSent, reportsAgainst, reportsFiled, activeSessions: sessions } });
}));

adminRouter.post('/users/:id/suspend', adminOnly, validate({ params: idParam, body: z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }) }), wrap(async (req, res) => {
  const id = req.params.id;
  if (id === req.user.id) throw bad('You cannot suspend yourself');
  const u = await prisma.user.findUnique({ where: { id }, select: { role: true, status: true } });
  if (!u || u.status === 'DELETED') throw notFound('User not found');
  if (u.role === 'ADMIN') throw forbidden('Administrators cannot be suspended. Change the role first');
  await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED', suspendedReason: req.body.reason } });
  await revokeAllSessions(id); // takes effect immediately: the access token's session check fails
  emitToUser(id, 'session:revoked', { reason: 'suspended' });
  await audit(req.user.id, 'admin.user.suspend', { type: 'user', id }, { reason: req.body.reason }, ip(req));
  res.json({ ok: true });
}));
adminRouter.post('/users/:id/unsuspend', adminOnly, validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.user.updateMany({ where: { id: req.params.id, status: 'SUSPENDED' }, data: { status: 'ACTIVE', suspendedReason: null } });
  if (!r.count) throw notFound('That account is not suspended');
  await audit(req.user.id, 'admin.user.unsuspend', { type: 'user', id: req.params.id }, undefined, ip(req));
  await notify({ userId: req.params.id, type: 'SYSTEM', title: 'Your account is active again', body: 'You can use Send Me/U as normal.', push: true });
  res.json({ ok: true });
}));
adminRouter.patch('/users/:id/role', adminOnly, validate({ params: idParam, body: z.object({ role: z.enum(['USER', 'MODERATOR', 'ADMIN']) }) }), wrap(async (req, res) => {
  if (req.params.id === req.user.id) throw bad('You cannot change your own role');
  const u = await prisma.user.update({ where: { id: req.params.id }, data: { role: req.body.role } }).catch(() => { throw notFound('User not found'); });
  await revokeAllSessions(u.id); // the role is read at sign-in; force a fresh one
  await audit(req.user.id, 'admin.user.role', { type: 'user', id: u.id }, { role: req.body.role }, ip(req));
  res.json({ ok: true, role: u.role });
}));
adminRouter.patch('/users/:id/verified', adminOnly, validate({ params: idParam, body: z.object({ verified: z.boolean() }) }), wrap(async (req, res) => {
  await prisma.user.update({ where: { id: req.params.id }, data: { verified: req.body.verified } }).catch(() => { throw notFound('User not found'); });
  await audit(req.user.id, 'admin.user.verified', { type: 'user', id: req.params.id }, { verified: req.body.verified }, ip(req));
  res.json({ ok: true });
}));

// ───────────────────────────── reports queue ─────────────────────────────

adminRouter.get('/reports', validate({ query: page.extend({ status: z.enum(['open', 'reviewing', 'resolved', 'dismissed', 'all']).default('open'), targetType: z.enum(['user', 'message', 'story', 'post']).optional() }) }), wrap(async (req, res) => {
  const { limit, offset, status, targetType } = q<any>(req);
  const where: Prisma.ReportWhereInput = { ...(status === 'all' ? {} : { status: status.toUpperCase() }), ...(targetType ? { targetType: targetType.toUpperCase() } : {}) };
  const [total, rows] = await Promise.all([prisma.report.count({ where }), prisma.report.findMany({ where, orderBy: { createdAt: 'asc' }, take: limit, skip: offset, include: { reporter: { select: { id: true, username: true, fullName: true } }, reportedUser: { select: { id: true, username: true, fullName: true, status: true } } } })]);
  res.json({ total, items: rows.map((r) => ({ id: r.id, targetType: r.targetType.toLowerCase(), targetId: r.targetId, reason: r.reason, details: r.details, status: r.status.toLowerCase(), createdAt: r.createdAt, resolvedAt: r.resolvedAt, resolution: r.resolution, reporter: r.reporter, reportedUser: r.reportedUser })) });
}));

/** The reported item, fetched on demand for the reviewer: only what the report points at. */
adminRouter.get('/reports/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.report.findUnique({ where: { id: req.params.id }, include: { reporter: { select: { id: true, username: true, fullName: true } }, reportedUser: { select: { id: true, username: true, fullName: true, status: true } } } });
  if (!r) throw notFound('Report not found');
  let item: unknown = null;
  if (r.targetType === 'MESSAGE') {
    const m = await prisma.message.findUnique({ where: { id: r.targetId }, include: { attachments: true } });
    item = m && { id: m.id, type: m.type, text: m.deletedAt ? null : m.text, deleted: !!m.deletedAt, createdAt: m.createdAt, attachments: m.deletedAt ? [] : m.attachments.map((a) => ({ kind: a.kind, url: toUrl(a.url), name: a.fileName })) };
  } else if (r.targetType === 'STORY') {
    const s = await prisma.story.findUnique({ where: { id: r.targetId } });
    item = s && { id: s.id, type: s.type, media: toUrl(s.mediaUrl), text: s.textContent, caption: s.caption, deleted: !!s.deletedAt, createdAt: s.createdAt };
  } else if (r.targetType === 'POST') {
    const p = await prisma.post.findUnique({ where: { id: r.targetId } });
    item = p && { id: p.id, mediaType: p.mediaType, media: toUrl(p.mediaUrl), caption: p.caption, deleted: !!p.deletedAt, createdAt: p.createdAt };
  }
  if (r.status === 'OPEN') await prisma.report.updateMany({ where: { id: r.id, status: 'OPEN' }, data: { status: 'REVIEWING' } });
  await audit(req.user.id, 'admin.report.view', { type: 'report', id: r.id }, undefined, ip(req));
  res.json({ id: r.id, targetType: r.targetType.toLowerCase(), targetId: r.targetId, reason: r.reason, details: r.details, status: r.status === 'OPEN' ? 'reviewing' : r.status.toLowerCase(), reporter: r.reporter, reportedUser: r.reportedUser, item });
}));

const resolveBody = z.object({
  action: z.enum(['dismiss', 'remove_content', 'warn', 'suspend']),
  note: z.string().trim().max(500).default(''),
  suspendReason: z.string().trim().max(300).optional(),
});
adminRouter.post('/reports/:id/resolve', validate({ params: idParam, body: resolveBody }), wrap(async (req, res) => {
  const b = req.body as z.infer<typeof resolveBody>;
  const r = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!r) throw notFound('Report not found');
  if (r.status === 'RESOLVED' || r.status === 'DISMISSED') throw new HttpError(409, 'This report is already closed', 'conflict');
  if (b.action === 'suspend' && req.user.role !== 'ADMIN') throw forbidden('Only administrators can suspend accounts');
  if (b.action === 'suspend' && (!r.reportedUserId || r.reportedUserId === req.user.id)) throw bad('There is no account to suspend');

  if (b.action === 'remove_content') await removeContent(r.targetType, r.targetId, req.user.id);
  if (b.action === 'warn' && r.reportedUserId) await notify({ userId: r.reportedUserId, type: 'SYSTEM', title: 'A warning about your account', body: b.note || 'Content you shared broke our community guidelines.', push: true });
  if (b.action === 'suspend' && r.reportedUserId) {
    const t = await prisma.user.findUnique({ where: { id: r.reportedUserId }, select: { role: true } });
    if (t?.role === 'ADMIN') throw forbidden('Administrators cannot be suspended');
    await prisma.user.update({ where: { id: r.reportedUserId }, data: { status: 'SUSPENDED', suspendedReason: b.suspendReason || r.reason } });
    await revokeAllSessions(r.reportedUserId);
    emitToUser(r.reportedUserId, 'session:revoked', { reason: 'suspended' });
  }
  const status = b.action === 'dismiss' ? 'DISMISSED' : 'RESOLVED';
  // closes every open report about the same item at once
  await prisma.report.updateMany({ where: { targetType: r.targetType, targetId: r.targetId, status: { in: ['OPEN', 'REVIEWING'] } }, data: { status, resolvedById: req.user.id, resolvedAt: new Date(), resolution: `${b.action}${b.note ? `: ${b.note}` : ''}` } });
  await audit(req.user.id, `admin.report.${b.action}`, { type: 'report', id: r.id }, { targetType: r.targetType, targetId: r.targetId, note: b.note }, ip(req));
  res.json({ ok: true, status: status.toLowerCase() });
}));

async function removeContent(type: string, id: string, actor: string) {
  if (type === 'MESSAGE') {
    const m = await prisma.message.findUnique({ where: { id }, include: { attachments: true } });
    if (!m) return;
    await prisma.message.update({ where: { id }, data: { deletedAt: new Date(), text: null } });
    await prisma.messageAttachment.deleteMany({ where: { messageId: id } });
    await unreferenced(m.attachments.flatMap((a) => [a.storageKey, a.thumbUrl])); // forwards may share the same file
    emitToConversation(m.conversationId, 'message:deleted', { id, conversationId: m.conversationId, scope: 'everyone' });
  } else if (type === 'STORY') {
    const s = await prisma.story.findUnique({ where: { id } });
    if (!s) return;
    await prisma.story.update({ where: { id }, data: { deletedAt: new Date() } });
    await removeObject(s.mediaUrl); await removeObject(s.thumbUrl);
  } else if (type === 'POST') {
    const p = await prisma.post.findUnique({ where: { id } });
    if (!p) return;
    await prisma.post.update({ where: { id }, data: { deletedAt: new Date() } });
    await removeObject(p.mediaUrl); await removeObject(p.posterUrl);
  } else return; // USER reports have no content to remove
  void actor;
}

// ───────────────────────────── content moderation (without browsing private chats) ─────────────────────────────

adminRouter.get('/content/posts', validate({ query: page }), wrap(async (req, res) => {
  const { limit, offset } = q<any>(req);
  const rows = await prisma.post.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: limit, skip: offset, include: { user: { select: { id: true, username: true, fullName: true } } } });
  res.json(rows.map((p) => ({ id: p.id, user: p.user, mediaType: p.mediaType, media: toUrl(p.posterUrl || p.mediaUrl), caption: p.caption, createdAt: p.createdAt })));
}));
adminRouter.get('/content/stories', validate({ query: page }), wrap(async (req, res) => {
  const { limit, offset } = q<any>(req);
  const rows = await prisma.story.findMany({ where: { deletedAt: null, expiresAt: { gt: new Date() }, privacy: 'EVERYONE' }, orderBy: { createdAt: 'desc' }, take: limit, skip: offset, include: { user: { select: { id: true, username: true, fullName: true } } } });
  res.json(rows.map((s) => ({ id: s.id, user: s.user, type: s.type, media: toUrl(s.thumbUrl || s.mediaUrl), text: s.textContent, caption: s.caption, expiresAt: s.expiresAt, createdAt: s.createdAt })));
}));
adminRouter.delete('/content/:type/:id', validate({ params: z.object({ type: z.enum(['post', 'story']), id: uuid }), body: z.object({ reason: z.string().trim().min(3).max(300) }).optional() }), wrap(async (req, res) => {
  const { type, id } = req.params as any;
  const row = type === 'post' ? await prisma.post.findUnique({ where: { id } }) : await prisma.story.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw notFound('Content not found');
  await removeContent(type.toUpperCase(), id, req.user.id);
  await audit(req.user.id, `admin.content.remove`, { type, id }, { reason: req.body?.reason, ownerId: row.userId }, ip(req));
  res.json({ ok: true });
}));

// ───────────────────────────── system, storage, audit ─────────────────────────────

adminRouter.get('/system/health', adminOnly, wrap(async (_req, res) => {
  const t0 = Date.now();
  const db = await prisma.$queryRaw`SELECT 1`.then(() => ({ ok: true, ms: Date.now() - t0 }), (e) => ({ ok: false, error: String(e.message).slice(0, 120) }));
  const rt = Date.now();
  const rd = redis ? await redis.ping().then(() => ({ ok: true, ms: Date.now() - rt }), (e: any) => ({ ok: false, error: String(e.message).slice(0, 120) })) : { ok: true, mode: 'disabled (in-memory fallback)' };
  res.json({ status: db.ok && rd.ok ? 'ok' : 'degraded', uptimeSec: Math.round(process.uptime()), db, redis: rd, memoryMb: Math.round(process.memoryUsage().rss / 1048576), loadAvg: os.loadavg()[0], node: process.version, storage: env.STORAGE_DRIVER, sockets: getIo()?.engine?.clientsCount ?? 0 });
}));

adminRouter.get('/system/storage', adminOnly, wrap(async (_req, res) => {
  const [att, groups] = await Promise.all([
    prisma.messageAttachment.aggregate({ _sum: { sizeBytes: true }, _count: true }),
    prisma.messageAttachment.groupBy({ by: ['kind'], _sum: { sizeBytes: true }, _count: true }),
  ]);
  let disk: { totalBytes: number; freeBytes: number } | null = null;
  if (env.STORAGE_DRIVER === 'local') { try { const s = await fs.statfs(env.UPLOAD_DIR); disk = { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize }; } catch { /* dir not created yet */ } }
  res.json({ driver: env.STORAGE_DRIVER, attachments: { count: att._count, bytes: att._sum.sizeBytes ?? 0 }, byKind: groups.map((g) => ({ kind: g.kind, count: g._count, bytes: g._sum.sizeBytes ?? 0 })), disk });
}));

adminRouter.get('/audit-logs', adminOnly, validate({ query: page.extend({ action: z.string().max(80).optional(), actorId: uuid.optional(), targetId: z.string().max(80).optional() }) }), wrap(async (req, res) => {
  const { limit, offset, action, actorId, targetId } = q<any>(req);
  const where: Prisma.AuditLogWhereInput = { ...(action ? { action: { startsWith: action } } : {}), ...(actorId ? { actorId } : {}), ...(targetId ? { targetId } : {}) };
  const [total, rows] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset, include: { actor: { select: { id: true, username: true } } } })]);
  res.json({ total, items: rows.map((a) => ({ id: a.id, action: a.action, actor: a.actor, targetType: a.targetType, targetId: a.targetId, ip: a.ip, meta: a.meta, createdAt: a.createdAt })) });
}));
