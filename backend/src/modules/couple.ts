import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma, Tx } from '../lib/db';
import { HttpError, bad, conflict, forbidden, notFound } from '../lib/errors';
import { idParam, uuid, validate, wrap } from '../lib/http';
import { notify } from '../lib/notify';
import { emitToUsers } from '../lib/realtime';
import { toUrl } from '../lib/storage';
import { requireAuth } from '../middleware/auth';
// the SAME pure booking/location rules the web app uses client-side (copied from src/couple)
import { apptLabel, availableFor, busyFor, checkBooking, checkPersonal, iso, ms, mutualAvailability, validateRange, viewAppointment } from './rules/scheduling.js';
import { expiryFor, sessionActive, validCoords, visibleLocation } from './rules/location.js';
import { audit, blockedIds, card, fmtDate, isBlockedBetween, toDate } from './common';
import { sendMessage, messageDto } from './chat';

export const coupleRouter = Router();
coupleRouter.use(requireAuth);

const partnerIdOf = (c: { inviterId: string; inviteeId: string }, me: string) => (c.inviterId === me ? c.inviteeId : c.inviterId);
const daysBetween = (d: Date) => Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));

async function activeCouple(userId: string) {
  return prisma.coupleConnection.findFirst({ where: { status: 'ACTIVE', OR: [{ inviterId: userId }, { inviteeId: userId }] } });
}
declare module 'express-serve-static-core' { interface Request { couple: { id: string; me: string; partner: string; conversationId: string | null } } }
/** Everything below is scoped to the caller's own ACTIVE couple: no couple id appears in any URL, so another couple's data cannot even be named. */
const needCouple = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const c = await activeCouple(req.user.id);
    if (!c) throw new HttpError(403, 'Link your partner first', 'not_linked');
    req.couple = { id: c.id, me: req.user.id, partner: partnerIdOf(c, req.user.id), conversationId: c.conversationId };
    next();
  } catch (e) { next(e); }
};

async function coupleView(me: string) {
  const [active, incoming, outgoing] = await Promise.all([
    activeCouple(me),
    prisma.coupleConnection.findMany({ where: { inviteeId: me, status: 'PENDING' }, include: { inviter: { include: { profile: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.coupleConnection.findMany({ where: { inviterId: me, status: 'PENDING' }, include: { invitee: { include: { profile: true } } } }),
  ]);
  const pendingIn = incoming.map((i) => ({ id: i.id, from: card(i.inviter), createdAt: i.createdAt }));
  const pendingOut = outgoing.map((i) => ({ id: i.id, to: card(i.invitee), createdAt: i.createdAt }));
  if (!active) return { status: 'none', linked: false, pendingIn, pendingOut };
  const partner = await prisma.user.findUniqueOrThrow({ where: { id: partnerIdOf(active, me) }, include: { profile: true } });
  const anniversary = active.anniversary ?? active.startDate;
  return {
    status: 'active', linked: true, id: active.id, coupleName: active.coupleName, startDate: fmtDate(active.startDate), anniversary: fmtDate(active.anniversary), theme: active.theme,
    cover: toUrl(active.coverUrl), conversationId: active.conversationId, daysTogether: active.startDate ? daysBetween(active.startDate) : 0,
    nextAnniversary: anniversary ? nextAnnual(anniversary) : null, partner: { ...card(partner), about: partner.profile?.about ?? '', dateOfBirth: fmtDate(partner.dateOfBirth) }, pendingIn, pendingOut,
  };
}
export function nextAnnual(d: Date, from = new Date()) {
  const y = from.getUTCFullYear(); let n = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
  if (n.getTime() < Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) n = new Date(Date.UTC(y + 1, d.getUTCMonth(), d.getUTCDate()));
  return { date: fmtDate(n), inDays: Math.round((n.getTime() - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 86_400_000) };
}
coupleRouter.get('/', wrap(async (req, res) => { res.json(await coupleView(req.user.id)); }));
coupleRouter.get('/profile', wrap(async (req, res) => { res.json(await coupleView(req.user.id)); })); // spec alias

// ── invitations ──
const pairLock = (tx: Tx, a: string, b: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${[a, b].sort().join('|')}, 0)), pg_advisory_xact_lock(hashtextextended(${'couple-user:' + a}, 0)), pg_advisory_xact_lock(hashtextextended(${'couple-user:' + b}, 0))`;
coupleRouter.post('/invite', validate({ body: z.object({ userId: uuid.optional(), handle: z.string().max(40).optional(), email: z.string().email().optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), anniversary: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) }), wrap(async (req, res) => {
  const me = req.user.id; const b = req.body;
  const target = await prisma.user.findFirst({
    where: { status: 'ACTIVE', ...(b.userId ? { id: b.userId } : b.handle ? { username: b.handle.replace(/^@/, '').toLowerCase() } : b.email ? { email: b.email.toLowerCase() } : { id: '00000000-0000-0000-0000-000000000000' }) },
  });
  if (!target) throw notFound('We could not find that person');
  if (target.id === me) throw bad('You cannot invite yourself');
  if (await isBlockedBetween(me, target.id)) throw notFound('We could not find that person');
  const invite = await prisma.$transaction(async (tx) => {
    await pairLock(tx, me, target.id);
    const busy = await tx.coupleConnection.findFirst({ where: { status: 'ACTIVE', OR: [{ inviterId: { in: [me, target.id] } }, { inviteeId: { in: [me, target.id] } }] } });
    if (busy) throw conflict(busy.inviterId === me || busy.inviteeId === me ? 'You are already connected with a partner' : 'That person is already connected with a partner');
    const open = await tx.coupleConnection.findFirst({ where: { status: 'PENDING', OR: [{ inviterId: me, inviteeId: target.id }, { inviterId: target.id, inviteeId: me }] } });
    if (open) throw conflict(open.inviterId === me ? 'You already invited this person' : 'This person already invited you. Check your invitations.');
    return tx.coupleConnection.create({ data: { inviterId: me, inviteeId: target.id, startDate: toDate(b.startDate), anniversary: toDate(b.anniversary) } });
  });
  const inviter = await prisma.user.findUniqueOrThrow({ where: { id: me } });
  await notify({ userId: target.id, actorId: me, type: 'COUPLE_INVITE', title: 'Couple invitation 💞', body: `${inviter.fullName} invited you to connect as a couple`, data: { inviteId: invite.id } });
  emitToUsers([me, target.id], 'couple:updated', { id: invite.id });
  res.status(201).json({ sent: true, id: invite.id });
}));

const decide = (accept: boolean) => wrap(async (req, res) => {
  const me = req.user.id;
  const invite = await prisma.coupleConnection.findFirst({ where: { id: req.body.inviteId, inviteeId: me, status: 'PENDING' } });
  if (!invite) throw notFound('That invitation is no longer open');
  if (!accept) {
    await prisma.coupleConnection.update({ where: { id: invite.id }, data: { status: 'REJECTED', respondedAt: new Date() } });
    await notify({ userId: invite.inviterId, actorId: me, type: 'COUPLE_UPDATE', title: 'Invitation declined', body: 'Your couple invitation was declined', data: { inviteId: invite.id } });
    emitToUsers([me, invite.inviterId], 'couple:updated', { id: invite.id });
    return res.json({ ok: true, status: 'rejected' });
  }
  const couple = await prisma.$transaction(async (tx) => {
    await pairLock(tx, me, invite.inviterId);
    const fresh = await tx.coupleConnection.findUnique({ where: { id: invite.id } });
    if (!fresh || fresh.status !== 'PENDING') throw conflict('That invitation is no longer open');
    const busy = await tx.coupleConnection.findFirst({ where: { status: 'ACTIVE', OR: [{ inviterId: { in: [me, invite.inviterId] } }, { inviteeId: { in: [me, invite.inviterId] } }] } });
    if (busy) throw conflict('One of you is already connected with a partner');
    const key = [me, invite.inviterId].sort().join(':');
    // a private "couple" conversation; if the two already chat directly we keep that history by upgrading it
    let conv = await tx.conversation.findUnique({ where: { directKey: key } });
    if (conv) conv = await tx.conversation.update({ where: { id: conv.id }, data: { type: 'COUPLE', directKey: null } });
    else conv = await tx.conversation.create({ data: { type: 'COUPLE', createdById: invite.inviterId, members: { create: [{ userId: me }, { userId: invite.inviterId }] } } });
    await tx.conversationMember.updateMany({ where: { conversationId: conv.id, userId: { in: [me, invite.inviterId] }, leftAt: { not: null } }, data: { leftAt: null } });
    await tx.privateChat.deleteMany({ where: { conversationId: conv.id } });
    return tx.coupleConnection.update({ where: { id: invite.id }, data: { status: 'ACTIVE', respondedAt: new Date(), startDate: invite.startDate ?? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`), conversationId: conv.id } });
  });
  const mine = await prisma.user.findUniqueOrThrow({ where: { id: me } });
  await notify({ userId: invite.inviterId, actorId: me, type: 'COUPLE_UPDATE', title: 'You’re connected 💞', body: `${mine.fullName} accepted your invitation`, data: { coupleId: couple.id, conversationId: couple.conversationId } });
  emitToUsers([me, invite.inviterId], 'couple:updated', { id: couple.id });
  res.json({ ok: true, status: 'active', couple: await coupleView(me) });
});
coupleRouter.post('/accept', validate({ body: z.object({ inviteId: uuid }) }), decide(true));
coupleRouter.post('/reject', validate({ body: z.object({ inviteId: uuid }) }), decide(false));
coupleRouter.delete('/invite/:id', validate({ params: idParam }), wrap(async (req, res) => { // withdraw my pending invite
  const r = await prisma.coupleConnection.updateMany({ where: { id: req.params.id, inviterId: req.user.id, status: 'PENDING' }, data: { status: 'ENDED', endedAt: new Date(), endedById: req.user.id } });
  if (!r.count) throw notFound('That invitation is no longer open');
  res.json({ ok: true });
}));

async function disconnect(req: Request, res: Response) {
  const c = await activeCouple(req.user.id);
  if (!c) throw notFound('You are not connected with a partner');
  const partner = partnerIdOf(c, req.user.id);
  await prisma.$transaction([
    prisma.coupleConnection.update({ where: { id: c.id }, data: { status: 'ENDED', endedAt: new Date(), endedById: req.user.id } }),
    // shared content stops being shared: each person keeps only what they created, privately
    prisma.coupleMemory.updateMany({ where: { coupleId: c.id }, data: { coupleId: null } }),
    prisma.coupleCalendarEvent.updateMany({ where: { coupleId: c.id }, data: { coupleId: null } }),
    prisma.locationSession.updateMany({ where: { coupleId: c.id, isActive: true }, data: { isActive: false, stoppedAt: new Date() } }),
    prisma.liveLocation.deleteMany({ where: { coupleId: c.id } }),
    ...(c.conversationId ? [prisma.conversationMember.updateMany({ where: { conversationId: c.conversationId }, data: { leftAt: new Date() } })] : []),
  ]);
  await audit(req.user.id, 'couple.disconnect', { type: 'couple', id: c.id });
  await notify({ userId: partner, actorId: req.user.id, type: 'COUPLE_UPDATE', title: 'Couple connection ended', body: 'Your couple connection was ended.', data: { coupleId: c.id } });
  emitToUsers([req.user.id, partner], 'couple:updated', { id: c.id });
  res.json({ ok: true });
}
coupleRouter.delete('/disconnect', wrap(disconnect));
coupleRouter.delete('/', wrap(disconnect));
coupleRouter.put('/', needCouple, validate({ body: z.object({ coupleName: z.string().max(60).nullable().optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), anniversary: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), theme: z.string().max(40).nullable().optional() }) }), wrap(async (req, res) => {
  const b = req.body;
  await prisma.coupleConnection.update({ where: { id: req.couple.id }, data: { ...(b.coupleName !== undefined ? { coupleName: b.coupleName } : {}), ...(b.startDate ? { startDate: toDate(b.startDate) } : {}), ...(b.anniversary !== undefined ? { anniversary: toDate(b.anniversary) } : {}), ...(b.theme !== undefined ? { theme: b.theme } : {}) } });
  emitToUsers([req.couple.me, req.couple.partner], 'couple:updated', { id: req.couple.id });
  res.json(await coupleView(req.user.id));
}));

// ── love notes: a message of type LOVE_NOTE in the couple chat ──
coupleRouter.post('/love-note', needCouple, validate({ body: z.object({ text: z.string().trim().min(1).max(1000) }) }), wrap(async (req, res) => {
  if (!req.couple.conversationId) throw bad('No couple chat found');
  const r = await sendMessage({ conversationId: req.couple.conversationId, senderId: req.user.id, type: 'LOVE_NOTE', text: req.body.text });
  const { emitToUser } = await import('../lib/realtime');
  for (const uid of r.memberIds) emitToUser(uid, 'message:new', messageDto(r.message, uid, r.memberIds));
  res.status(201).json(messageDto(r.message, req.user.id, r.memberIds));
}));

// ── journal & bucket list ──
coupleRouter.get('/journal', needCouple, wrap(async (req, res) => {
  const rows = await prisma.coupleJournal.findMany({ where: { coupleId: req.couple.id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
  res.json(rows.map((j) => ({ id: j.id, title: j.title, body: j.body, text: j.body, date: fmtDate(j.date), mine: j.authorId === req.user.id })));
}));
coupleRouter.post('/journal', needCouple, validate({ body: z.object({ title: z.string().trim().min(1).max(100), body: z.string().max(5000).optional(), text: z.string().max(5000).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) }), wrap(async (req, res) => {
  const j = await prisma.coupleJournal.create({ data: { coupleId: req.couple.id, authorId: req.user.id, title: req.body.title, body: req.body.body ?? req.body.text ?? '', date: toDate(req.body.date) ?? toDate(new Date().toISOString())! } });
  res.status(201).json({ id: j.id, title: j.title, body: j.body, text: j.body, date: fmtDate(j.date), mine: true });
}));
coupleRouter.delete('/journal/:id', needCouple, validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.coupleJournal.deleteMany({ where: { id: req.params.id, coupleId: req.couple.id, authorId: req.user.id } });
  if (!r.count) throw notFound('Entry not found');
  res.json({ ok: true });
}));
coupleRouter.get('/goals', needCouple, wrap(async (req, res) => { res.json((await prisma.coupleGoal.findMany({ where: { coupleId: req.couple.id }, orderBy: { createdAt: 'asc' } })).map((g) => ({ id: g.id, title: g.title, text: g.title, done: g.done }))); }));
coupleRouter.post('/goals', needCouple, validate({ body: z.object({ title: z.string().trim().min(1).max(120).optional(), text: z.string().trim().min(1).max(120).optional() }).refine((b) => b.title || b.text, 'Write the goal') }), wrap(async (req, res) => {
  const g = await prisma.coupleGoal.create({ data: { coupleId: req.couple.id, authorId: req.user.id, title: (req.body.title || req.body.text)! } });
  res.status(201).json({ id: g.id, title: g.title, text: g.title, done: g.done });
}));
coupleRouter.patch('/goals/:id/toggle', needCouple, validate({ params: idParam }), wrap(async (req, res) => {
  const g = await prisma.coupleGoal.findFirst({ where: { id: req.params.id, coupleId: req.couple.id } });
  if (!g) throw notFound('Goal not found');
  const u = await prisma.coupleGoal.update({ where: { id: g.id }, data: { done: !g.done, doneAt: g.done ? null : new Date() } });
  res.json({ id: u.id, title: u.title, text: u.title, done: u.done });
}));
coupleRouter.delete('/goals/:id', needCouple, validate({ params: idParam }), wrap(async (req, res) => { await prisma.coupleGoal.deleteMany({ where: { id: req.params.id, coupleId: req.couple.id } }); res.json({ ok: true }); }));

// ── appointments (booking rules shared with the client; DB exclusion constraints are the last line of defence) ──
const clean = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);
const apptDto = (a: any) => ({ id: a.id, couple_id: a.coupleId, created_by: a.createdById, title: a.title, location: a.location, start_time: a.startTime.toISOString(), end_time: a.endTime.toISOString(), notes: a.notes, visibility: a.visibility, status: a.status, rev: a.rev, created_at: a.createdAt.toISOString(), updated_at: a.updatedAt.toISOString() });
const availDto = (b: any) => ({ id: b.id, user_id: b.userId, couple_id: b.coupleId, start_time: b.startTime.toISOString(), end_time: b.endTime.toISOString(), availability_type: b.type });
const outAppt = (a: any, uid: string) => viewAppointment(apptDto(a), uid);

async function withCoupleLock<T>(coupleId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'couple:' + coupleId}, 0))`; // serialise one couple's writes
      return fn(tx);
    });
  } catch (e: any) {
    if (e?.code === '23P01' || /exclusion constraint|23P01/.test(String(e?.message))) throw new HttpError(409, 'That time was just taken. Pick another slot.', 'overlap');
    throw e;
  }
}
const range = (qs: any): [Date, Date] => {
  const from = qs.from ? new Date(qs.from) : null; const to = qs.to ? new Date(qs.to) : null;
  if (!from || !to || Number.isNaN(+from) || Number.isNaN(+to) || to <= from || +to - +from > 62 * 864e5) throw new HttpError(400, 'Send a valid from/to (at most 62 days)', 'bad_range');
  return [from, to];
};
const apptsIn = (db: Tx | typeof prisma, coupleId: string, from: Date, to: Date) => db.coupleAppointment.findMany({ where: { coupleId, status: 'confirmed', startTime: { lt: to }, endTime: { gt: from } }, orderBy: { startTime: 'asc' } });
const availIn = (db: Tx | typeof prisma, coupleId: string, from: Date, to: Date) => db.coupleAvailability.findMany({ where: { coupleId, startTime: { lt: to }, endTime: { gt: from } } });
const ctxOf = (appts: any[], avail: any[]) => ({ appointments: appts.map(apptDto), availability: avail.map(availDto) });
const partnerNote = async (req: Request, text: string) => notify({ userId: req.couple.partner, actorId: req.couple.me, type: 'COUPLE_UPDATE', title: 'Couple calendar', body: text, data: { kind: 'appointment' } });
const firstName = async (id: string) => ((await prisma.user.findUnique({ where: { id }, select: { fullName: true } }))?.fullName ?? 'Your partner').split(' ')[0];

coupleRouter.get('/appointments', needCouple, wrap(async (req, res) => {
  const [from, to] = range(req.query);
  res.json((await apptsIn(prisma, req.couple.id, from, to)).map((a) => outAppt(a, req.couple.me)).filter(Boolean)); // partner's private rows dropped, notes stripped
}));
const apptFields = (b: any, existing?: any) => {
  const visibility = b.visibility ? (b.visibility === 'private' ? 'private' : 'shared') : existing?.visibility || 'shared';
  const title = b.title !== undefined || !existing ? clean(b.title, 80) : existing.title;
  const location = b.location !== undefined || !existing ? clean(b.location, 120) : existing.location;
  if (!title) throw new HttpError(400, 'Give it a name', 'title_required');
  if (visibility === 'shared' && !location) throw new HttpError(400, 'Add a location so your partner knows where', 'location_required');
  const start = b.start_time ?? existing?.startTime.toISOString(); const end = b.end_time ?? existing?.endTime.toISOString();
  const v = validateRange(start, end, { now: Date.now() });
  if (!v.ok) throw new HttpError(422, v.message!, v.code);
  return { visibility, title, location, start: iso(start), end: iso(end) };
};
const windowOf = (b: any, start: string, end: string) => {
  const s = b.window?.start ? ms(b.window.start) : ms(start) - 12 * 36e5; const e = b.window?.end ? ms(b.window.end) : ms(end) + 12 * 36e5;
  if (!(e > s) || e - s > 36e5 * 26 || s > ms(start) || e < ms(end)) throw new HttpError(400, 'Invalid planning window', 'bad_window');
  return { start: s, end: e };
};
coupleRouter.post('/appointments', needCouple, wrap(async (req, res) => {
  const f = apptFields(req.body);
  const created = await withCoupleLock(req.couple.id, async (tx) => {
    const win = windowOf(req.body, f.start, f.end);
    const lo = new Date(Math.min(win.start, ms(f.start))); const hi = new Date(Math.max(win.end, ms(f.end)));
    const ctx = ctxOf(await apptsIn(tx, req.couple.id, lo, hi), await availIn(tx, req.couple.id, lo, hi));
    const r = { start: ms(f.start), end: ms(f.end) };
    const verdict = f.visibility === 'shared' ? checkBooking({ range: r, window: win, users: [req.couple.me, req.couple.partner], ...ctx }) : checkPersonal({ range: r, userId: req.couple.me, appointments: ctx.appointments });
    if (!verdict.ok) throw new HttpError(409, verdict.message!, verdict.code);
    return tx.coupleAppointment.create({ data: { coupleId: req.couple.id, createdById: req.couple.me, title: f.title, location: f.location, startTime: new Date(f.start), endTime: new Date(f.end), notes: clean(req.body.notes, 500), visibility: f.visibility } });
  });
  if (created.visibility === 'shared') await partnerNote(req, `${await firstName(req.couple.me)} booked ${apptLabel(apptDto(created))}`);
  emitToUsers([req.couple.me, ...(created.visibility === 'shared' ? [req.couple.partner] : [])], 'appointment:created', { id: created.id });
  res.status(201).json(outAppt(created, req.couple.me));
}));
coupleRouter.put('/appointments/:id', needCouple, validate({ params: idParam }), wrap(async (req, res) => {
  const updated = await withCoupleLock(req.couple.id, async (tx) => {
    const cur = await tx.coupleAppointment.findFirst({ where: { id: req.params.id, coupleId: req.couple.id, status: 'confirmed' } });
    if (!cur || outAppt(cur, req.couple.me) === null) throw new HttpError(404, 'That appointment no longer exists', 'not_found');
    if (req.body.rev != null && Number(req.body.rev) !== cur.rev) throw new HttpError(409, 'This was just changed. Showing the latest version.', 'stale');
    const f = apptFields(req.body, cur); const win = windowOf(req.body, f.start, f.end);
    const lo = new Date(Math.min(win.start, ms(f.start))); const hi = new Date(Math.max(win.end, ms(f.end)));
    const ctx = ctxOf(await apptsIn(tx, req.couple.id, lo, hi), await availIn(tx, req.couple.id, lo, hi));
    const r = { start: ms(f.start), end: ms(f.end) };
    const verdict = f.visibility === 'shared' ? checkBooking({ range: r, window: win, users: [req.couple.me, req.couple.partner], ignoreId: cur.id, ...ctx }) : checkPersonal({ range: r, userId: cur.createdById, ignoreId: cur.id, appointments: ctx.appointments });
    if (!verdict.ok) throw new HttpError(409, verdict.message!, verdict.code);
    const notes = cur.createdById === req.couple.me && req.body.notes !== undefined ? clean(req.body.notes, 500) : cur.notes; // notes stay with their author
    return tx.coupleAppointment.update({ where: { id: cur.id }, data: { title: f.title, location: f.location, startTime: new Date(f.start), endTime: new Date(f.end), notes, rev: { increment: 1 } } });
  });
  if (updated.visibility === 'shared') await partnerNote(req, `${await firstName(req.couple.me)} changed ${apptLabel(apptDto(updated))}`);
  emitToUsers([req.couple.me, ...(updated.visibility === 'shared' ? [req.couple.partner] : [])], 'appointment:updated', { id: updated.id });
  res.json(outAppt(updated, req.couple.me));
}));
coupleRouter.delete('/appointments/:id', needCouple, validate({ params: idParam }), wrap(async (req, res) => {
  const gone = await withCoupleLock(req.couple.id, async (tx) => {
    const cur = await tx.coupleAppointment.findFirst({ where: { id: req.params.id, coupleId: req.couple.id, status: 'confirmed', OR: [{ visibility: 'shared' }, { createdById: req.couple.me }] } });
    if (!cur) throw new HttpError(404, 'That appointment no longer exists', 'not_found');
    return tx.coupleAppointment.update({ where: { id: cur.id }, data: { status: 'cancelled', rev: { increment: 1 } } });
  });
  if (gone.visibility === 'shared') await partnerNote(req, `${await firstName(req.couple.me)} cancelled ${apptLabel(apptDto(gone))}`);
  emitToUsers([req.couple.me, ...(gone.visibility === 'shared' ? [req.couple.partner] : [])], 'appointment:cancelled', { id: gone.id });
  res.json({ ok: true });
}));

// ── availability (own blocks only) + mutual free slots ──
const blockBody = (b: any) => {
  if (!['busy', 'available'].includes(b.availability_type)) throw new HttpError(400, 'Choose busy or available', 'bad_type');
  const v = validateRange(b.start_time, b.end_time, { maxHours: 24 });
  if (!v.ok) throw new HttpError(422, v.message!, v.code);
  return { startTime: new Date(iso(b.start_time)), endTime: new Date(iso(b.end_time)), type: b.availability_type as string };
};
coupleRouter.get('/availability', needCouple, wrap(async (req, res) => {
  const [from, to] = range(req.query);
  res.json((await prisma.coupleAvailability.findMany({ where: { userId: req.couple.me, startTime: { lt: to }, endTime: { gt: from } }, orderBy: { startTime: 'asc' } })).map(availDto));
}));
coupleRouter.post('/availability', needCouple, wrap(async (req, res) => {
  const b = await prisma.coupleAvailability.create({ data: { userId: req.couple.me, coupleId: req.couple.id, ...blockBody(req.body) } });
  emitToUsers([req.couple.me, req.couple.partner], 'availability:updated', {});
  res.status(201).json(availDto(b));
}));
coupleRouter.put('/availability/:id', needCouple, validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.coupleAvailability.updateMany({ where: { id: req.params.id, userId: req.couple.me }, data: blockBody(req.body) });
  if (!r.count) throw new HttpError(404, 'Block not found', 'not_found');
  emitToUsers([req.couple.me, req.couple.partner], 'availability:updated', {});
  res.json(availDto(await prisma.coupleAvailability.findUniqueOrThrow({ where: { id: req.params.id } })));
}));
coupleRouter.delete('/availability/:id', needCouple, validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.coupleAvailability.deleteMany({ where: { id: req.params.id, userId: req.couple.me } });
  if (!r.count) throw new HttpError(404, 'Block not found', 'not_found');
  emitToUsers([req.couple.me, req.couple.partner], 'availability:updated', {});
  res.json({ ok: true });
}));
coupleRouter.get('/slots', needCouple, wrap(async (req, res) => {
  const [from, to] = range(req.query);
  if (+to - +from > 36e5 * 26) throw new HttpError(400, 'Ask for one day at a time', 'bad_range');
  const ctx = ctxOf(await apptsIn(prisma, req.couple.id, from, to), await availIn(prisma, req.couple.id, from, to));
  const ignoreId = req.query.ignoreId ? String(req.query.ignoreId) : null;
  const side = (u: string) => ({ available: availableFor(u, ctx.availability), busy: busyFor(u, { ...ctx, ignoreId }) });
  res.json(mutualAvailability({ from: +from, to: +to, slotMinutes: Number(req.query.minutes) || 30, notBefore: req.query.notBefore ? ms(String(req.query.notBefore)) : null, me: side(req.couple.me), partner: side(req.couple.partner) })); // free/busy shape only, never titles
}));

// ── live location (consent-based, expiring, latest position only) ──
const sessDto = (s: any) => s && ({ id: s.id, user_id: s.userId, couple_id: s.coupleId, is_active: s.isActive, expires_at: s.expiresAt?.toISOString() ?? null, started_at: s.startedAt.toISOString(), stopped_at: s.stoppedAt?.toISOString() ?? null });
const locDto = (l: any) => l && ({ user_id: l.userId, couple_id: l.coupleId, latitude: l.latitude, longitude: l.longitude, accuracy: l.accuracy, updated_at: l.updatedAt.toISOString() });
const activeSession = (userId: string) => prisma.locationSession.findFirst({ where: { userId, isActive: true } });
coupleRouter.get('/location', needCouple, wrap(async (req, res) => {
  const { me, partner } = req.couple;
  for (const uid of [me, partner]) { // reads enforce expiry themselves; the janitor job is only housekeeping
    const s = await activeSession(uid); const l = await prisma.liveLocation.findUnique({ where: { userId: uid } });
    if (s && !sessionActive(sessDto(s), Date.now(), l?.updatedAt)) await prisma.$transaction([prisma.locationSession.update({ where: { id: s.id }, data: { isActive: false, stoppedAt: new Date() } }), prisma.liveLocation.deleteMany({ where: { userId: uid } })]);
  }
  const [mySession, myLoc, pSession, pLoc] = await Promise.all([activeSession(me), prisma.liveLocation.findUnique({ where: { userId: me } }), activeSession(partner), prisma.liveLocation.findUnique({ where: { userId: partner } })]);
  res.json({ session: sessDto(mySession), me: locDto(myLoc), partner: visibleLocation({ session: sessDto(pSession), location: locDto(pLoc) }), partnerSharing: sessionActive(sessDto(pSession), Date.now(), pLoc?.updatedAt), serverTime: new Date().toISOString() });
}));
coupleRouter.post('/location/session', needCouple, wrap(async (req, res) => {
  const exp = expiryFor(req.body.duration);
  if (exp === undefined) throw new HttpError(400, 'Choose 15 minutes, 1 hour, 8 hours or until you turn it off', 'bad_duration');
  const s = await withCoupleLock(req.couple.id, async (tx) => {
    await tx.locationSession.updateMany({ where: { userId: req.couple.me, isActive: true }, data: { isActive: false, stoppedAt: new Date() } });
    return tx.locationSession.create({ data: { userId: req.couple.me, coupleId: req.couple.id, expiresAt: exp ? new Date(exp) : null } });
  });
  await notify({ userId: req.couple.partner, actorId: req.couple.me, type: 'COUPLE_UPDATE', title: 'Live location', body: `${await firstName(req.couple.me)} is sharing a live location with you`, data: { kind: 'location' } });
  emitToUsers([req.couple.me, req.couple.partner], 'location:started', { expires_at: s.expiresAt });
  res.status(201).json(sessDto(s));
}));
coupleRouter.delete('/location/session', needCouple, wrap(async (req, res) => {
  await prisma.$transaction([prisma.locationSession.updateMany({ where: { userId: req.couple.me, isActive: true }, data: { isActive: false, stoppedAt: new Date() } }), prisma.liveLocation.deleteMany({ where: { userId: req.couple.me } })]);
  emitToUsers([req.couple.me, req.couple.partner], 'location:stopped', { reason: 'stopped' });
  res.json({ ok: true });
}));
coupleRouter.put('/location', needCouple, wrap(async (req, res) => {
  const lat = Number(req.body.latitude); const lng = Number(req.body.longitude); const acc = req.body.accuracy == null ? null : Number(req.body.accuracy);
  if (!validCoords(lat, lng, acc)) throw new HttpError(422, 'Those coordinates are not valid', 'bad_coords');
  const s = await activeSession(req.couple.me); const cur = await prisma.liveLocation.findUnique({ where: { userId: req.couple.me } });
  if (!s || !sessionActive(sessDto(s), Date.now(), cur?.updatedAt)) throw new HttpError(403, 'Location sharing is not turned on', 'not_sharing');
  if (cur && Date.now() - cur.updatedAt.getTime() < 5000) throw new HttpError(429, 'Slow down', 'too_fast'); // at most one write per 5 s
  const l = await prisma.liveLocation.upsert({ where: { userId: req.couple.me }, create: { userId: req.couple.me, coupleId: req.couple.id, latitude: lat, longitude: lng, accuracy: acc }, update: { latitude: lat, longitude: lng, accuracy: acc, updatedAt: new Date() } });
  emitToUsers([req.couple.partner], 'location:update', {}); // partner re-fetches; coordinates never travel inside the event
  res.json(locDto(l));
}));
coupleRouter.post('/location/request', needCouple, wrap(async (req, res) => {
  const recent = await prisma.notification.findFirst({ where: { userId: req.couple.partner, actorId: req.couple.me, type: 'COUPLE_UPDATE', createdAt: { gt: new Date(Date.now() - 10 * 60_000) }, data: { path: ['kind'], equals: 'location_request' } } });
  if (recent) throw new HttpError(429, 'You asked a moment ago. Give them a little time.', 'too_soon');
  await notify({ userId: req.couple.partner, actorId: req.couple.me, type: 'COUPLE_UPDATE', title: 'Live location', body: `${await firstName(req.couple.me)} asked if you can share your live location`, data: { kind: 'location_request' } }); // a request only; it never switches anything on
  emitToUsers([req.couple.partner], 'location:request', {});
  res.json({ sent: true });
}));

// ── shared calendar (spec: GET/POST /couple/calendar) — same data as /events ──
coupleRouter.get('/calendar', needCouple, wrap(async (req, res) => {
  const { listEvents } = await import('./misc');
  res.json(await listEvents(req.user.id));
}));
coupleRouter.post('/calendar', needCouple, wrap(async (req, res) => {
  const { createEvent } = await import('./misc');
  res.status(201).json(await createEvent(req.user.id, { ...req.body, shared: true }));
}));

void forbidden; void blockedIds; void Prisma;
