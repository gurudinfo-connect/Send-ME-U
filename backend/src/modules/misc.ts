import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma } from '../lib/db';
import { HttpError, bad, notFound } from '../lib/errors';
import { idParam, uuid, validate, wrap } from '../lib/http';
import { removeObject, saveUpload, toUrl } from '../lib/storage';
import { requireAuth } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { upload } from '../middleware/upload';
import { addDays, startOfDay } from './engine';
import { blockedIds, card, fmtDate, toDate } from './common';

export const miscRouter = Router();
miscRouter.use(requireAuth);

// ───────────────────────────── events (personal + shared with partner) ─────────────────────────────

const REMINDER_RE = /^(?:(\d+)\s*(minute|hour|day|week)s?\s*before|at time of event)$/i;
const UNIT: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
async function eventInstant(ownerId: string, date: string, time?: string | null) {
  const tz = (await prisma.userSettings.findUnique({ where: { userId: ownerId }, select: { timezone: true } }))?.timezone || 'UTC';
  const [h, m] = (time || '09:00').split(':').map(Number);
  return startOfDay(date, tz) + ((h || 0) * 60 + (m || 0)) * 60_000; // the event's wall-clock time in the owner's timezone
}
const eventBody = z.object({
  title: z.string().trim().min(1, 'Give the event a title').max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'), time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  kind: z.enum(['love', 'cake', 'trip', 'other']).default('love'), reminder: z.string().max(40).nullish().refine((r) => !r || REMINDER_RE.test(r), 'Unsupported reminder'), note: z.string().max(1000).default(''), shared: z.boolean().optional(),
});
const evDto = (e: any, me: string) => ({ id: e.id, title: e.title, date: fmtDate(e.date), time: e.time ?? '', kind: e.kind, reminder: e.reminder ?? '', note: e.note, shared: !!e.coupleId, mine: e.ownerId === me });
async function myCouple(userId: string) { return prisma.coupleConnection.findFirst({ where: { status: 'ACTIVE', OR: [{ inviterId: userId }, { inviteeId: userId }] }, select: { id: true } }); }
export async function listEvents(me: string) {
  const c = await myCouple(me);
  const rows = await prisma.coupleCalendarEvent.findMany({ where: { OR: [{ ownerId: me }, ...(c ? [{ coupleId: c.id }] : [])] }, orderBy: [{ date: 'asc' }, { time: 'asc' }] });
  return rows.map((e) => evDto(e, me));
}
export async function createEvent(me: string, input: unknown, id?: string) {
  const b = eventBody.parse(input);
  const couple = b.shared ? await myCouple(me) : null;
  if (b.shared && !couple) throw new HttpError(403, 'Link your partner to share events', 'not_linked');
  let remindAt: Date | null = null;
  const m = b.reminder ? REMINDER_RE.exec(b.reminder) : null;
  if (m) { const at = await eventInstant(me, b.date, b.time); remindAt = new Date(at - (m[1] ? Number(m[1]) * UNIT[m[2].toLowerCase()] : 0)); }
  const data = { title: b.title, date: toDate(b.date)!, time: b.time ?? null, kind: b.kind, reminder: b.reminder ?? null, note: b.note, coupleId: couple?.id ?? null, remindAt, notifiedAt: null };
  if (id) {
    const cur = await prisma.coupleCalendarEvent.findFirst({ where: { id, ownerId: me } });
    if (!cur) throw notFound('Event not found');
    return evDto(await prisma.coupleCalendarEvent.update({ where: { id }, data: { ...data, coupleId: b.shared === undefined ? cur.coupleId : data.coupleId } }), me);
  }
  return evDto(await prisma.coupleCalendarEvent.create({ data: { ...data, ownerId: me } }), me);
}
miscRouter.get('/events', wrap(async (req, res) => { res.json(await listEvents(req.user.id)); }));
miscRouter.post('/events', wrap(async (req, res) => { res.status(201).json(await createEvent(req.user.id, req.body)); }));
miscRouter.put('/events/:id', validate({ params: idParam }), wrap(async (req, res) => { res.json(await createEvent(req.user.id, req.body, req.params.id)); }));
miscRouter.delete('/events/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.coupleCalendarEvent.deleteMany({ where: { id: req.params.id, ownerId: req.user.id } });
  if (!r.count) throw notFound('Event not found');
  res.json({ ok: true });
}));

// ───────────────────────────── memories (photos / videos / albums) ─────────────────────────────

const memDto = (m: any, me: string) => ({
  id: m.id, type: m.type, album: m.album, caption: m.caption, src: toUrl(m.mediaUrl), poster: toUrl(m.thumbUrl), thumb: toUrl(m.thumbUrl || m.mediaUrl),
  duration: m.durationS != null ? `${Math.floor(m.durationS / 60)}:${String(m.durationS % 60).padStart(2, '0')}` : undefined, date: fmtDate(m.takenAt), takenAt: m.takenAt, shared: !!m.coupleId, mine: m.ownerId === me, ownerId: m.ownerId,
});
miscRouter.get('/memories', validate({ query: z.object({ type: z.enum(['photo', 'video']).optional(), album: z.string().max(60).optional(), q: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(100), before: z.string().datetime().optional() }) }), wrap(async (req, res) => {
  const { type, album, q: term, limit, before } = (req as any).validQuery;
  const c = await myCouple(req.user.id);
  const rows = await prisma.coupleMemory.findMany({
    where: { deletedAt: null, OR: [{ ownerId: req.user.id }, ...(c ? [{ coupleId: c.id }] : [])], ...(type ? { type } : {}), ...(album ? { album } : {}), ...(term ? { OR: [{ album: { contains: term, mode: 'insensitive' as const } }, { caption: { contains: term, mode: 'insensitive' as const } }] } : {}), ...(before ? { takenAt: { lt: new Date(before) } } : {}) },
    orderBy: { takenAt: 'desc' }, take: limit,
  });
  res.json(rows.map((m) => memDto(m, req.user.id)));
}));
miscRouter.post('/memories', uploadLimiter, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw bad('Choose a photo or video');
  const album = String(req.body.album || 'General').trim().slice(0, 60) || 'General';
  const c = await myCouple(req.user.id);
  const wantShared = req.body.shared === undefined ? true : req.body.shared === 'true' || req.body.shared === true;
  const shared = !!c && wantShared && album.toLowerCase() !== 'private'; // the "Private" album is never shared
  const saved = await saveUpload(req.file, { folder: 'memories', accept: ['image', 'video'], thumb: 480, maxVideoSec: 300 });
  const m = await prisma.coupleMemory.create({ data: { ownerId: req.user.id, coupleId: shared ? c!.id : null, type: saved.kind === 'video' ? 'video' : 'photo', album, caption: String(req.body.caption || '').slice(0, 500), mediaUrl: saved.key, thumbUrl: saved.thumbKey, storageKey: saved.key, durationS: saved.durationMs ? Math.round(saved.durationMs / 1000) : null, takenAt: req.body.takenAt ? new Date(req.body.takenAt) : new Date() } });
  res.status(201).json(memDto(m, req.user.id));
}));
miscRouter.patch('/memories/:id', validate({ params: idParam, body: z.object({ caption: z.string().max(500).optional(), album: z.string().trim().min(1).max(60).optional(), shared: z.boolean().optional() }) }), wrap(async (req, res) => {
  const m = await prisma.coupleMemory.findFirst({ where: { id: req.params.id, ownerId: req.user.id, deletedAt: null } });
  if (!m) throw notFound('Memory not found');
  const c = await myCouple(req.user.id);
  const album = req.body.album ?? m.album;
  const coupleId = req.body.shared === undefined ? m.coupleId : req.body.shared && c && album.toLowerCase() !== 'private' ? c.id : null;
  res.json(memDto(await prisma.coupleMemory.update({ where: { id: m.id }, data: { caption: req.body.caption ?? m.caption, album, coupleId } }), req.user.id));
}));
miscRouter.delete('/memories/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const m = await prisma.coupleMemory.findFirst({ where: { id: req.params.id, ownerId: req.user.id, deletedAt: null } });
  if (!m) throw notFound('Memory not found'); // only the owner can delete; the partner can only view
  await prisma.coupleMemory.update({ where: { id: m.id }, data: { deletedAt: new Date() } });
  const still = await prisma.coupleMemory.count({ where: { deletedAt: null, OR: [{ mediaUrl: m.mediaUrl }, { storageKey: m.storageKey }] } });
  const inUse = await prisma.story.count({ where: { deletedAt: null, expiresAt: { gt: new Date() }, mediaKey: m.storageKey } }) + await prisma.storyHighlightItem.count({ where: { mediaUrl: m.mediaUrl } });
  if (!still && !inUse) await Promise.all([removeObject(m.storageKey), removeObject(m.thumbUrl)]);
  res.json({ ok: true });
}));

// ───────────────────────────── saved places ─────────────────────────────

const placeDto = (p: any) => ({ id: p.id, name: p.name, address: p.address, lat: p.latitude, lng: p.longitude });
miscRouter.get('/places', wrap(async (req, res) => { res.json((await prisma.savedPlace.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 200 })).map(placeDto)); }));
miscRouter.post('/places', validate({ body: z.object({ name: z.string().trim().min(1).max(80), address: z.string().max(200).default(''), lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish() }) }), wrap(async (req, res) => {
  res.status(201).json(placeDto(await prisma.savedPlace.create({ data: { userId: req.user.id, name: req.body.name, address: req.body.address, latitude: req.body.lat ?? null, longitude: req.body.lng ?? null } })));
}));
miscRouter.delete('/places/:id', validate({ params: idParam }), wrap(async (req, res) => { await prisma.savedPlace.deleteMany({ where: { id: req.params.id, userId: req.user.id } }); res.json({ ok: true }); }));

// ───────────────────────────── channels ─────────────────────────────

const chDto = (c: any, following: boolean, count: number) => ({ id: c.id, name: c.name, logo: toUrl(c.logoUrl), icon: 'image', last: c.lastPost, time: c.lastPostAt, unread: 0, about: c.about, category: c.category, following, followers: count, mine: false });
miscRouter.get('/channels', wrap(async (req, res) => {
  const rows = await prisma.channel.findMany({ include: { _count: { select: { followers: true } }, followers: { where: { userId: req.user.id }, select: { userId: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(rows.map((c) => ({ ...chDto(c, c.followers.length > 0, c._count.followers), mine: c.ownerId === req.user.id })));
}));
miscRouter.post('/channels', validate({ body: z.object({ name: z.string().trim().min(2).max(60), about: z.string().max(300).default(''), category: z.string().max(30).default('General') }) }), wrap(async (req, res) => {
  const c = await prisma.channel.create({ data: { ownerId: req.user.id, ...req.body, followers: { create: { userId: req.user.id } } } });
  res.status(201).json({ ...chDto(c, true, 1), mine: true });
}));
miscRouter.post('/channels/:id/follow', validate({ params: idParam }), wrap(async (req, res) => {
  if (!(await prisma.channel.findUnique({ where: { id: req.params.id }, select: { id: true } }))) throw notFound('Channel not found');
  await prisma.channelFollower.upsert({ where: { channelId_userId: { channelId: req.params.id, userId: req.user.id } }, create: { channelId: req.params.id, userId: req.user.id }, update: {} });
  res.json({ following: true });
}));
miscRouter.delete('/channels/:id/follow', validate({ params: idParam }), wrap(async (req, res) => { await prisma.channelFollower.deleteMany({ where: { channelId: req.params.id, userId: req.user.id } }); res.json({ following: false }); }));

// ───────────────────────────── notifications ─────────────────────────────

const ago = (d: Date) => { const m = Math.floor((Date.now() - d.getTime()) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };
const nDto = (n: any) => ({ id: n.id, type: n.type.toLowerCase(), title: n.title, body: n.body, text: n.body ? `${n.title}: ${n.body}`.slice(0, 200) : n.title, data: n.data ?? {}, read: !!n.readAt, readAt: n.readAt, createdAt: n.createdAt, ago: ago(n.createdAt) });
miscRouter.get('/notifications', validate({ query: z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), before: z.string().datetime().optional() }) }), wrap(async (req, res) => {
  const { unread, limit, before } = (req as any).validQuery;
  const rows = await prisma.notification.findMany({ where: { userId: req.user.id, ...(unread === 'true' ? { readAt: null } : {}), ...(before ? { createdAt: { lt: new Date(before) } } : {}) }, orderBy: { createdAt: 'desc' }, take: limit });
  res.json(rows.map(nDto));
}));
miscRouter.get('/notifications/unread-count', wrap(async (req, res) => { res.json({ count: await prisma.notification.count({ where: { userId: req.user.id, readAt: null } }) }); }));
miscRouter.put('/notifications/read-all', wrap(async (req, res) => { const r = await prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } }); res.json({ ok: true, count: r.count }); }));
miscRouter.put('/notifications/:id/read', validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
  const n = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!n) throw notFound('Notification not found');
  res.json({ ...nDto(n), updated: r.count });
}));
miscRouter.delete('/notifications/:id', validate({ params: idParam }), wrap(async (req, res) => { await prisma.notification.deleteMany({ where: { id: req.params.id, userId: req.user.id } }); res.json({ ok: true }); }));

// ───────────────────────────── timeline activity ─────────────────────────────

miscRouter.get('/timeline/activity', wrap(async (req, res) => {
  const me = req.user.id; const hidden = await blockedIds(me);
  const following = (await prisma.follow.findMany({ where: { followerId: me }, select: { followeeId: true } })).map((f) => f.followeeId).filter((i) => !hidden.includes(i));
  if (!following.length) return res.json([]);
  const [posts, stories] = await Promise.all([
    prisma.post.findMany({ where: { userId: { in: following }, deletedAt: null, createdAt: { gt: new Date(Date.now() - 7 * 864e5) } }, include: { user: { include: { profile: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.story.findMany({ where: { userId: { in: following }, deletedAt: null, expiresAt: { gt: new Date() }, privacy: { in: ['EVERYONE', 'FOLLOWERS'] } }, include: { user: { include: { profile: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const items = [
    ...posts.map((p) => ({ ...card(p.user), id: `p-${p.id}`, kind: 'post', userId: p.userId, text: p.mediaType === 'video' ? 'shared a new reel' : 'shared a new photo', thumb: toUrl(p.posterUrl || p.mediaUrl), createdAt: p.createdAt })),
    ...stories.map((s) => ({ ...card(s.user), id: `s-${s.id}`, kind: 'story', userId: s.userId, text: 'added to their story', thumb: toUrl(s.thumbUrl || s.mediaUrl), createdAt: s.createdAt })),
  ].sort((a, b) => +b.createdAt - +a.createdAt).slice(0, 50);
  res.json(items.map((i) => ({ ...i, ago: ago(i.createdAt) })));
}));

// ───────────────────────────── reports ─────────────────────────────

miscRouter.post('/reports', validate({ body: z.object({ targetType: z.enum(['user', 'message', 'story', 'post']), targetId: uuid, reason: z.string().trim().min(2).max(60), details: z.string().max(1000).default('') }) }), wrap(async (req, res) => {
  const { targetType, targetId } = req.body; const type = targetType.toUpperCase() as 'USER' | 'MESSAGE' | 'STORY' | 'POST';
  let reportedUserId: string | null = null;
  if (type === 'USER') reportedUserId = (await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } }))?.id ?? null;
  if (type === 'MESSAGE') {
    const m = await prisma.message.findUnique({ where: { id: targetId }, select: { senderId: true, conversationId: true } });
    if (m && !(await prisma.conversationMember.findFirst({ where: { conversationId: m.conversationId, userId: req.user.id }, select: { userId: true } }))) throw notFound('Message not found'); // you can only report what you can see
    reportedUserId = m?.senderId ?? null;
  }
  if (type === 'STORY') reportedUserId = (await prisma.story.findUnique({ where: { id: targetId }, select: { userId: true } }))?.userId ?? null;
  if (type === 'POST') reportedUserId = (await prisma.post.findUnique({ where: { id: targetId }, select: { userId: true } }))?.userId ?? null;
  if (!reportedUserId) throw notFound('That item could not be found');
  if (reportedUserId === req.user.id) throw bad('You cannot report yourself');
  try {
    const r = await prisma.report.create({ data: { reporterId: req.user.id, targetType: type, targetId, reportedUserId, reason: req.body.reason, details: req.body.details } });
    res.status(201).json({ ok: true, id: r.id });
  } catch (e: any) { if (e.code === 'P2002' || /reports_open_dedupe_uq/.test(String(e?.message))) return res.status(200).json({ ok: true, duplicate: true }); throw e; }
}));
void Prisma; void addDays;
