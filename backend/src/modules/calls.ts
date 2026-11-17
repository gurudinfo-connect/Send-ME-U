import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma, Prisma } from '../lib/db';
import { HttpError, bad, conflict, forbidden, notFound } from '../lib/errors';
import { idParam, page, q, uuid, validate, wrap } from '../lib/http';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify';
import { onlineSet } from '../lib/presence';
import { emitToUser, emitToUsers } from '../lib/realtime';
import { saveUpload, toUrl } from '../lib/storage';
import { requireAuth } from '../middleware/auth';
import { blockedIds, card, isBlockedBetween, MS } from './common';
import { eventState, joinDecision, mergeGuests, reminderAt, reminderLabel, validateEvent, ms as toMs } from './rules/callEvents';

export const callsRouter = Router();
callsRouter.use(requireAuth);

const RING_SECONDS = 45;
const MAX_CALL_HOURS = 12;

// ───────────────────────────── ICE servers ─────────────────────────────

/** STUN plus (when configured) TURN. With TURN_SECRET the credentials are short-lived (coturn "use-auth-secret"). */
export function iceServers(userId: string) {
  const out: { urls: string[]; username?: string; credential?: string }[] = [];
  const stun = env.STUN_URLS.split(',').map((s) => s.trim()).filter(Boolean);
  if (stun.length) out.push({ urls: stun });
  const turn = env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean);
  const ttl = 3600;
  if (turn.length && env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + ttl}:${userId}`;
    out.push({ urls: turn, username, credential: crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') });
  } else if (turn.length && env.TURN_USERNAME) {
    out.push({ urls: turn, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  }
  return { iceServers: out, ttl };
}
callsRouter.get('/ice-servers', wrap((req, res) => { res.json(iceServers(req.user.id)); }));

// ───────────────────────────── call log + lifecycle ─────────────────────────────

type CallRow = Prisma.CallGetPayload<{ include: { participants: { include: { user: { include: { profile: true } } } } } }>;
const callInclude = { participants: { include: { user: { include: { profile: true } } } } } as const;

function callDto(c: CallRow, me: string, favs: Set<string>) {
  const other = c.participants.find((p) => p.userId !== me);
  const mine = c.callerId === me;
  const dir = mine ? 'out' : c.status === 'MISSED' ? 'missed' : 'in';
  const peer = other ? card(other.user) : null;
  return {
    id: c.id, userId: other?.userId ?? null, name: peer?.name ?? 'Unknown', handle: peer?.handle ?? '', avatar: peer?.avatar ?? null, verified: !!peer?.verified,
    video: c.type === 'VIDEO', type: c.type.toLowerCase(), status: c.status.toLowerCase(), dir, fav: other ? favs.has(other.userId) : false,
    at: c.createdAt.toISOString(), when: c.createdAt.toISOString(), answeredAt: c.answeredAt?.toISOString() ?? null, endedAt: c.endedAt?.toISOString() ?? null,
    durationSec: c.durationSec ?? 0, endReason: c.endReason, conversationId: c.conversationId,
  };
}

/** A call is "live" while ringing (inside the ring window) or ongoing. Stale rows are closed lazily so nobody stays "busy" forever. */
async function busyWith(userIds: string[], db: Prisma.TransactionClient | typeof prisma = prisma) {
  const ringSince = new Date(Date.now() - RING_SECONDS * 1000);
  const staleAnswered = new Date(Date.now() - MAX_CALL_HOURS * MS.hour);
  const row = await db.callParticipant.findFirst({
    where: { userId: { in: userIds }, leftAt: null, call: { OR: [{ status: 'RINGING', createdAt: { gt: ringSince } }, { status: 'ONGOING', answeredAt: { gt: staleAnswered } }] } },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

const placeBody = z.object({ peerId: uuid.optional(), conversationId: uuid.optional(), video: z.boolean().default(false) }).refine((b) => b.peerId || b.conversationId, { message: 'Choose who to call' });

async function lockUsers(tx: Prisma.TransactionClient, ids: string[]) {
  for (const id of [...ids].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'call:' + id}))`; // sorted: no deadlocks
}

callsRouter.post('/', validate({ body: placeBody }), wrap(async (req, res) => {
  const me = req.user.id; const b = req.body as z.infer<typeof placeBody>;
  let peerId = b.peerId; let conversationId = b.conversationId ?? null;
  if (conversationId) {
    const members = await prisma.conversationMember.findMany({ where: { conversationId, leftAt: null }, select: { userId: true, conversation: { select: { type: true } } } });
    if (!members.some((m) => m.userId === me)) throw notFound('Conversation not found');
    if (members[0]?.conversation.type === 'GROUP') throw bad('Group calls are not supported yet. Call a member directly');
    const other = members.find((m) => m.userId !== me);
    if (!other) throw bad('There is nobody to call here');
    if (peerId && peerId !== other.userId) throw bad('That person is not in this conversation');
    peerId = other.userId;
  }
  if (!peerId || peerId === me) throw bad('You can’t call yourself');
  const peer = await prisma.user.findUnique({ where: { id: peerId }, include: { profile: true, settings: true } });
  if (!peer || peer.status !== 'ACTIVE') throw notFound('This person is not available');
  if (await isBlockedBetween(me, peerId)) throw forbidden('You can’t call this person');
  const caller = await prisma.user.findUniqueOrThrow({ where: { id: me }, include: { profile: true } });

  const call = await prisma.$transaction(async (tx) => {
    await lockUsers(tx, [me, peerId!]);
    const busy = await busyWith([me, peerId!], tx);
    if (busy === me) throw conflict('You are already on a call');
    if (busy) throw new HttpError(409, `${peer.fullName.split(' ')[0]} is on another call`, 'busy');
    return tx.call.create({
      data: { callerId: me, conversationId, type: b.video ? 'VIDEO' : 'VOICE', participants: { create: [{ userId: me, role: 'caller', joinedAt: new Date() }, { userId: peerId!, role: 'callee' }] } },
      include: callInclude,
    });
  });

  const favs = new Set((await prisma.callFavorite.findMany({ where: { userId: me }, select: { peerId: true } })).map((f) => f.peerId));
  const payload = { callId: call.id, video: b.video, conversationId, from: card(caller), ringSeconds: RING_SECONDS, at: call.createdAt.toISOString() };
  emitToUser(peerId, 'call:incoming', payload);
  const online = (await onlineSet([peerId])).has(peerId);
  // the push wakes the phone even if the app is closed; calls ignore quiet hours
  await notify({ userId: peerId, actorId: me, type: 'CALL', title: `${caller.fullName} is ${b.video ? 'video ' : ''}calling`, body: 'Tap to answer', data: { callId: call.id, video: b.video, kind: 'incoming_call' }, urgent: true, push: true });
  res.status(201).json({ ...callDto(call, me, favs), ice: iceServers(me), calleeOnline: online });
}));

async function loadForUser(callId: string, me: string) {
  const c = await prisma.call.findUnique({ where: { id: callId }, include: callInclude });
  if (!c || !c.participants.some((p) => p.userId === me)) throw notFound('Call not found');
  return c;
}
const peersOf = (c: { participants: { userId: string }[] }, me: string) => c.participants.map((p) => p.userId).filter((u) => u !== me);

/** Ids the user may signal to for this call (empty unless the call is live and they take part in it). Used by the socket layer. */
export async function signalPeers(callId: string, me: string): Promise<string[]> {
  const c = await prisma.call.findUnique({ where: { id: callId }, select: { status: true, participants: { select: { userId: true } } } });
  if (!c || !['RINGING', 'ONGOING'].includes(c.status) || !c.participants.some((p) => p.userId === me)) return [];
  return peersOf(c, me);
}

export async function answerCall(callId: string, me: string) {
  const r = await prisma.call.updateMany({ where: { id: callId, status: 'RINGING', callerId: { not: me }, participants: { some: { userId: me, role: 'callee' } }, createdAt: { gt: new Date(Date.now() - (RING_SECONDS + 10) * 1000) } }, data: { status: 'ONGOING', answeredAt: new Date() } });
  const c = await loadForUser(callId, me);
  if (r.count === 0) {
    if (c.status === 'ONGOING') return c; // idempotent (e.g. two devices)
    throw new HttpError(409, c.status === 'RINGING' ? 'This call has timed out' : 'This call has already ended', 'call_closed');
  }
  await prisma.callParticipant.update({ where: { callId_userId: { callId, userId: me } }, data: { joinedAt: new Date() } });
  emitToUsers([...peersOf(c, me), me], 'call:answered', { callId, by: me });
  return c;
}

/** reject (callee) / cancel (caller while ringing) / end (anyone while ongoing). */
export async function closeCall(callId: string, me: string, reason: 'hangup' | 'rejected' | 'canceled' | 'busy' | 'failed' = 'hangup') {
  const c = await loadForUser(callId, me);
  if (c.status === 'ENDED' || c.status === 'MISSED' || c.status === 'REJECTED' || c.status === 'CANCELED') return c;
  const now = new Date();
  let status: 'ENDED' | 'REJECTED' | 'CANCELED'; let endReason: string = reason;
  if (c.status === 'RINGING') { if (c.callerId === me) { status = 'CANCELED'; endReason = 'canceled'; } else { status = 'REJECTED'; endReason = reason === 'busy' ? 'busy' : 'rejected'; } }
  else status = 'ENDED';
  const durationSec = c.answeredAt ? Math.max(0, Math.round((now.getTime() - c.answeredAt.getTime()) / 1000)) : 0;
  const r = await prisma.call.updateMany({ where: { id: callId, status: c.status }, data: { status, endedAt: now, durationSec, endReason } });
  if (r.count === 0) return loadForUser(callId, me);
  await prisma.callParticipant.updateMany({ where: { callId, leftAt: null }, data: { leftAt: now } });
  emitToUsers([...peersOf(c, me), me], 'call:ended', { callId, by: me, status: status.toLowerCase(), reason: endReason, durationSec });
  if (status === 'CANCELED') { // callee never picked up: it shows as a missed call on their side
    for (const p of peersOf(c, me)) await notify({ userId: p, actorId: me, type: 'CALL', title: 'Missed call', body: `${c.participants.find((x) => x.userId === me)?.user.fullName ?? 'Someone'} called you`, data: { callId, kind: 'missed_call' }, push: true, urgent: true });
  }
  return loadForUser(callId, me);
}

/** Job: ringing calls nobody answered become MISSED; calls "ongoing" for far too long are closed. */
export async function expireCalls() {
  const now = new Date();
  const ringing = await prisma.call.findMany({ where: { status: 'RINGING', createdAt: { lt: new Date(now.getTime() - (RING_SECONDS + 5) * 1000) } }, include: callInclude, take: 200 });
  for (const c of ringing) {
    const r = await prisma.call.updateMany({ where: { id: c.id, status: 'RINGING' }, data: { status: 'MISSED', endedAt: now, endReason: 'no_answer', durationSec: 0 } });
    if (!r.count) continue;
    await prisma.callParticipant.updateMany({ where: { callId: c.id }, data: { leftAt: now } });
    const caller = c.participants.find((p) => p.userId === c.callerId);
    for (const p of c.participants.filter((x) => x.userId !== c.callerId)) {
      emitToUser(p.userId, 'call:ended', { callId: c.id, status: 'missed', reason: 'no_answer' });
      await notify({ userId: p.userId, actorId: c.callerId, type: 'CALL', title: 'Missed call', body: `${caller?.user.fullName ?? 'Someone'} called you`, data: { callId: c.id, kind: 'missed_call' }, push: true, urgent: true });
    }
    emitToUser(c.callerId, 'call:ended', { callId: c.id, status: 'missed', reason: 'no_answer' });
  }
  const stale = await prisma.call.findMany({ where: { status: 'ONGOING', answeredAt: { lt: new Date(now.getTime() - MAX_CALL_HOURS * MS.hour) } }, select: { id: true, answeredAt: true }, take: 200 });
  for (const c of stale) {
    await prisma.call.updateMany({ where: { id: c.id, status: 'ONGOING' }, data: { status: 'ENDED', endedAt: now, endReason: 'timeout', durationSec: Math.round((now.getTime() - c.answeredAt!.getTime()) / 1000) } });
    await prisma.callParticipant.updateMany({ where: { callId: c.id }, data: { leftAt: now } });
  }
  return ringing.length + stale.length;
}

callsRouter.get('/', validate({ query: page }), wrap(async (req, res) => {
  const me = req.user.id; const { limit, offset } = q<z.infer<typeof page>>(req);
  const hide = await blockedIds(me);
  const rows = await prisma.call.findMany({ where: { participants: { some: { userId: me, clearedAt: null } } }, orderBy: { createdAt: 'desc' }, take: limit, skip: offset, include: callInclude });
  const favs = new Set((await prisma.callFavorite.findMany({ where: { userId: me }, select: { peerId: true } })).map((f) => f.peerId));
  res.json(rows.filter((c) => !c.participants.some((p) => p.userId !== me && hide.includes(p.userId))).map((c) => callDto(c, me, favs)));
}));

callsRouter.delete('/', wrap(async (req, res) => {
  await prisma.callParticipant.updateMany({ where: { userId: req.user.id, clearedAt: null, call: { status: { notIn: ['RINGING', 'ONGOING'] } } }, data: { clearedAt: new Date() } });
  res.json({ ok: true });
}));

// ── favourites (declared before /:id so they are not mistaken for ids)
callsRouter.get('/favorites', wrap(async (req, res) => {
  const rows = await prisma.callFavorite.findMany({ where: { userId: req.user.id }, include: { peer: { include: { profile: true } } } });
  res.json(rows.map((f) => card(f.peer)));
}));
callsRouter.put('/favorites/:id', validate({ params: idParam, body: z.object({ fav: z.boolean().default(true) }) }), wrap(async (req, res) => {
  const me = req.user.id; const peerId = req.params.id;
  if (peerId === me) throw bad('You can’t favourite yourself');
  if (!(await prisma.user.findUnique({ where: { id: peerId }, select: { id: true } }))) throw notFound('Person not found');
  if (req.body.fav) await prisma.callFavorite.upsert({ where: { userId_peerId: { userId: me, peerId } }, create: { userId: me, peerId }, update: {} });
  else await prisma.callFavorite.deleteMany({ where: { userId: me, peerId } });
  res.json({ ok: true, fav: req.body.fav });
}));

// ── scheduled calls (personal "call X at time" reminders)
const schedBody = z.object({ peerId: uuid, at: z.string().datetime({ offset: true }), video: z.boolean().default(false), note: z.string().trim().max(200).default('') });
const schedDto = (s: any) => ({ id: s.id, peerId: s.peerId, name: s.peer.fullName, handle: `@${s.peer.username}`, avatar: toUrl(s.peer.profile?.avatarThumbUrl || s.peer.profile?.avatarUrl), at: s.at.toISOString(), video: s.video, note: s.note });
callsRouter.get('/scheduled', wrap(async (req, res) => {
  const rows = await prisma.scheduledCall.findMany({ where: { userId: req.user.id, at: { gte: new Date(Date.now() - MS.hour) } }, orderBy: { at: 'asc' }, take: 100, include: { peer: { include: { profile: true } } } });
  res.json(rows.map(schedDto));
}));
callsRouter.post('/scheduled', validate({ body: schedBody }), wrap(async (req, res) => {
  const me = req.user.id; const b = req.body as z.infer<typeof schedBody>;
  if (b.peerId === me) throw bad('Choose someone else to call');
  if (new Date(b.at).getTime() < Date.now() - 60_000) throw bad('Pick a time in the future');
  if (!(await prisma.user.findFirst({ where: { id: b.peerId, status: 'ACTIVE' }, select: { id: true } }))) throw notFound('Person not found');
  if (await isBlockedBetween(me, b.peerId)) throw forbidden('You can’t schedule a call with this person');
  if ((await prisma.scheduledCall.count({ where: { userId: me, at: { gte: new Date() } } })) >= 100) throw bad('You have too many scheduled calls');
  const row = await prisma.scheduledCall.create({ data: { userId: me, peerId: b.peerId, at: new Date(b.at), video: b.video, note: b.note }, include: { peer: { include: { profile: true } } } });
  res.status(201).json(schedDto(row));
}));
callsRouter.delete('/scheduled/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.scheduledCall.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  if (!r.count) throw notFound('Scheduled call not found');
  res.json({ ok: true });
}));

// ── single call
callsRouter.get('/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const favs = new Set((await prisma.callFavorite.findMany({ where: { userId: req.user.id }, select: { peerId: true } })).map((f) => f.peerId));
  res.json({ ...callDto(await loadForUser(req.params.id, req.user.id), req.user.id, favs), ice: iceServers(req.user.id) });
}));
const act = (fn: (id: string, me: string) => Promise<CallRow>) => wrap(async (req, res) => {
  const favs = new Set((await prisma.callFavorite.findMany({ where: { userId: req.user.id }, select: { peerId: true } })).map((f) => f.peerId));
  res.json(callDto(await fn(req.params.id, req.user.id), req.user.id, favs));
});
callsRouter.post('/:id/answer', validate({ params: idParam }), act(answerCall));
callsRouter.post('/:id/reject', validate({ params: idParam }), act((id, me) => closeCall(id, me, 'rejected')));
callsRouter.post('/:id/cancel', validate({ params: idParam }), act((id, me) => closeCall(id, me, 'canceled')));
callsRouter.post('/:id/end', validate({ params: idParam }), act((id, me) => closeCall(id, me, 'hangup')));
callsRouter.delete('/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.callParticipant.updateMany({ where: { callId: req.params.id, userId: req.user.id, call: { status: { notIn: ['RINGING', 'ONGOING'] } } }, data: { clearedAt: new Date() } });
  if (!r.count) throw notFound('Call not found');
  res.json({ ok: true });
}));

// ═════════════════════════════ call events (scheduled group/solo calls with invite links) ═════════════════════════════
// Same pure rules as the frontend demo service (rules/callEvents.js, copied from src/callEvents/logic.js).

export const callEventsRouter = Router();
callEventsRouter.use(requireAuth);

const publicOrigin = () => env.PUBLIC_APP_URL || 'http://localhost:5173';
const newMeetingId = () => crypto.randomBytes(15).toString('hex');
const first = (n?: string) => (n || 'Someone').split(/[ _]/)[0];
const lc = (s: string) => s.toLowerCase();

type EventFull = Prisma.CallEventGetPayload<{ include: { host: { include: { profile: true } }; guests: { include: { user: { include: { profile: true } } } } } }>;
const evInclude = { host: { include: { profile: true } }, guests: { include: { user: { include: { profile: true } } }, orderBy: { createdAt: 'asc' as const } } } as const;

function shape(e: EventFull, viewer: string) {
  const raw = { status: e.status, host_user_id: e.hostId, start_datetime: e.startsAt.toISOString(), end_datetime: e.endsAt.toISOString(), require_approval: e.requireApproval };
  const mine = e.guests.find((g) => g.userId === viewer);
  const isHost = e.hostId === viewer;
  const guests = e.guests.filter((g) => g.response !== 'REMOVED').map((g) => {
    const c = card(g.user);
    return { user_id: g.userId, name: c.name, avatar: c.avatar, invitation_status: lc(g.response), approved: g.approved, join_requested: g.joinRequested, joined_at: g.joinedAt?.toISOString() ?? null };
  });
  const host = card(e.host);
  return {
    id: e.id, host_user_id: e.hostId, host: { id: e.hostId, name: host.name, avatar: host.avatar }, title: e.title, description: e.description, event_image: toUrl(e.imageUrl),
    start_datetime: raw.start_datetime, end_datetime: raw.end_datetime, call_type: lc(e.callType), meeting_id: e.meetingId, meeting_link: `${publicOrigin()}/calls/join/${e.meetingId}`,
    require_approval: e.requireApproval, reminder_minutes: (isHost ? e.hostReminderMinutes : mine?.reminderMinutes) ?? e.reminderMinutes, status: e.status, created_at: e.createdAt, updated_at: e.updatedAt,
    state: eventState(raw), guests,
    me: { host: isHost, status: isHost ? 'accepted' : mine ? lc(mine.response) : null, approved: !!mine?.approved, join_requested: !!mine?.joinRequested },
    join: joinDecision(raw, viewer, mine && { invitation_status: lc(mine.response), approved: mine.approved }),
  };
}
type Shaped = ReturnType<typeof shape>;

async function loadEvent(where: Prisma.CallEventWhereUniqueInput, viewer: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<Shaped> {
  const e = await db.callEvent.findUnique({ where, include: evInclude });
  if (!e) throw notFound('Event not found');
  return shape(e, viewer);
}
const hostOnly = (ev: Shaped) => { if (!ev.me.host) throw forbidden('Only the host can do that'); };
const openOnly = (ev: Shaped) => { if (ev.state === 'cancelled') throw conflict('This event was cancelled'); if (ev.state === 'ended') throw conflict('This event has ended'); };
const changed = (ids: string[]) => emitToUsers(ids, 'callevent:changed', {});
async function evNotify(userId: string, actorId: string, title: string, eventId: string, kind: string) {
  await notify({ userId, actorId, type: 'EVENT', title, data: { eventId, kind } });
}
async function existingUsers(ids: string[], me: string) {
  const uniq = [...new Set(ids.filter((x) => z.string().uuid().safeParse(x).success && x !== me))];
  if (!uniq.length) return [];
  const blocked = new Set(await blockedIds(me));
  return (await prisma.user.findMany({ where: { id: { in: uniq }, status: 'ACTIVE' }, select: { id: true } })).map((u) => u.id).filter((id) => !blocked.has(id));
}
/** The event image arrives as a small data URL (<=400kb); store it like any other upload and keep only the key. */
async function storeEventImage(v: unknown): Promise<string | null | undefined> {
  if (v === undefined) return undefined;
  if (!v) return null;
  const s = String(v);
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(s);
  if (!m) { if (/^https?:\/\//.test(s) && s.length < 500) return s; throw bad('The event image must be a PNG, JPEG, WebP or GIF picture'); }
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > 400 * 1024) throw bad('The event image is too large (max 400 KB)');
  return (await saveUpload({ buffer, originalname: 'event.' + m[1], mimetype: 'image/' + m[1], size: buffer.length }, { folder: 'call-events', accept: ['image'], thumb: 320, maxDim: 1280 })).key;
}

const guestIdsSchema = z.array(z.string().max(64)).max(250).optional();

callEventsRouter.get('/', wrap(async (req, res) => {
  const me = req.user.id;
  const rows = await prisma.callEvent.findMany({
    where: { endsAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }, OR: [{ hostId: me }, { guests: { some: { userId: me, response: { not: 'REMOVED' } } } }] },
    orderBy: { startsAt: 'asc' }, take: 200, include: evInclude,
  });
  res.json({ data: rows.map((e) => shape(e, me)) });
}));

// Opening an invitation link: any signed-in user may view the invitation; they then respond through /respond
callEventsRouter.get('/link/:meetingId', wrap(async (req, res) => {
  const id = String(req.params.meetingId);
  if (!/^[a-z0-9]{10,40}$/.test(id)) throw notFound('This invitation link is not valid');
  const ev = await loadEvent({ meetingId: id }, req.user.id).catch((e) => { throw e.status === 404 ? notFound('This invitation link is not valid') : e; });
  res.json({ data: ev });
}));

callEventsRouter.post('/', wrap(async (req, res) => {
  const me = req.user.id;
  const v = validateEvent(req.body); if (!v.ok) throw bad(v.error!);
  const x = v.value; const image = await storeEventImage(req.body.event_image);
  const wanted = await existingUsers(Array.isArray(req.body.guest_ids) ? req.body.guest_ids.map(String) : [], me);
  const { added } = mergeGuests([], wanted, me);
  let meetingId = /^[a-z0-9]{10,40}$/.test(req.body.meeting_id || '') ? String(req.body.meeting_id) : newMeetingId();
  if (await prisma.callEvent.findUnique({ where: { meetingId }, select: { id: true } })) meetingId = newMeetingId();
  const ev = await prisma.callEvent.create({
    data: { hostId: me, title: x.title, description: x.description, imageUrl: image ?? null, startsAt: new Date(x.start_datetime), endsAt: new Date(x.end_datetime), callType: x.call_type === 'video' ? 'VIDEO' : 'VOICE', meetingId, requireApproval: x.require_approval, reminderMinutes: x.reminder_minutes, guests: { create: added.map((userId) => ({ userId })) } },
  });
  const host = first((await prisma.user.findUnique({ where: { id: me }, select: { fullName: true } }))?.fullName);
  for (const gid of added) await evNotify(gid, me, `${host} invited you to “${ev.title}”`, ev.id, 'event:invite');
  changed([me, ...added]);
  res.status(201).json({ data: await loadEvent({ id: ev.id }, me) });
}));

callEventsRouter.get('/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const ev = await loadEvent({ id: req.params.id }, req.user.id);
  if (!ev.me.host && !ev.me.status) throw forbidden('You are not invited to this call'); // strangers use /link/:meetingId
  res.json({ data: ev });
}));

// Host edits. Keeps the id and meeting link. `guest_ids` (optional) is the full wanted guest list.
callEventsRouter.put('/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id;
  const cur = await loadEvent({ id }, me); hostOnly(cur); openOnly(cur);
  const v = validateEvent({ ...cur, ...req.body }); if (!v.ok) throw bad(v.error!);
  const x = v.value; const image = await storeEventImage(req.body.event_image);
  const wantIds = guestIdsSchema.parse(req.body.guest_ids);
  const want = wantIds ? await existingUsers(wantIds.map(String), me) : null;
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM call_events WHERE id = ${id}::uuid FOR UPDATE`;
    await tx.callEvent.update({ where: { id }, data: { title: x.title, description: x.description, ...(image !== undefined ? { imageUrl: image } : {}), startsAt: new Date(x.start_datetime), endsAt: new Date(x.end_datetime), callType: x.call_type === 'video' ? 'VIDEO' : 'VOICE', requireApproval: x.require_approval, reminderMinutes: x.reminder_minutes, hostReminderSentAt: null } });
    await tx.callEventGuest.updateMany({ where: { eventId: id }, data: { reminderSentAt: null } }); // the time may have moved: reminders re-arm
    let added: string[] = [];
    if (want) {
      const rows = await tx.callEventGuest.findMany({ where: { eventId: id } });
      await tx.callEventGuest.updateMany({ where: { eventId: id, userId: { notIn: want }, response: { not: 'REMOVED' } }, data: { response: 'REMOVED' } });
      const m = mergeGuests(rows.map((g) => ({ user_id: g.userId, invitation_status: want.includes(g.userId) ? lc(g.response) : 'removed', approved: g.approved })), want, me);
      added = m.added;
      for (const gid of added) await tx.callEventGuest.upsert({ where: { eventId_userId: { eventId: id, userId: gid } }, create: { eventId: id, userId: gid }, update: { response: 'PENDING', approved: false, joinRequested: false, reminderSentAt: null } });
    }
    const others = (await tx.callEventGuest.findMany({ where: { eventId: id, response: { in: ['PENDING', 'ACCEPTED'] } }, select: { userId: true } })).map((g) => g.userId).filter((g) => !added.includes(g));
    return { others, added };
  });
  const host = first((await prisma.user.findUnique({ where: { id: me }, select: { fullName: true } }))?.fullName);
  for (const gid of out.added) await evNotify(gid, me, `${host} invited you to “${x.title}”`, id, 'event:invite');
  for (const gid of out.others) await evNotify(gid, me, `“${x.title}” was updated`, id, 'event:updated');
  changed([me, ...out.others, ...out.added]);
  res.json({ data: await loadEvent({ id }, me) });
}));

// Cancel (the row stays so guests see "cancelled")
callEventsRouter.delete('/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id;
  const cur = await loadEvent({ id }, me); hostOnly(cur);
  if (cur.status !== 'cancelled') {
    await prisma.callEvent.update({ where: { id }, data: { status: 'cancelled' } });
    const who = cur.guests.map((g) => g.user_id);
    for (const gid of who) await evNotify(gid, me, `“${cur.title}” was cancelled`, id, 'event:cancelled');
    changed([me, ...who]);
  }
  res.json({ data: await loadEvent({ id }, me) });
}));

callEventsRouter.post('/:id/guests', validate({ params: idParam, body: z.object({ guestIds: z.array(z.string().max(64)).max(250) }) }), wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id;
  const cur = await loadEvent({ id }, me); hostOnly(cur); openOnly(cur);
  const want = await existingUsers(req.body.guestIds, me);
  const rows = await prisma.callEventGuest.findMany({ where: { eventId: id } });
  const { added } = mergeGuests(rows.map((g) => ({ user_id: g.userId, invitation_status: lc(g.response), approved: g.approved })), want, me); // never twice, never the host
  const total = rows.filter((g) => g.response !== 'REMOVED').length + added.filter((a) => !rows.some((r) => r.userId === a)).length;
  if (total > 250) throw bad('A call can have up to 250 guests');
  for (const gid of added) await prisma.callEventGuest.upsert({ where: { eventId_userId: { eventId: id, userId: gid } }, create: { eventId: id, userId: gid }, update: { response: 'PENDING', approved: false, joinRequested: false, reminderSentAt: null } });
  const host = first((await prisma.user.findUnique({ where: { id: me }, select: { fullName: true } }))?.fullName);
  for (const gid of added) await evNotify(gid, me, `${host} invited you to “${cur.title}”`, id, 'event:invite');
  changed([me, ...added]);
  res.json({ data: { ...(await loadEvent({ id }, me)), added } });
}));

callEventsRouter.delete('/:id/guests/:userId', validate({ params: z.object({ id: uuid, userId: uuid }) }), wrap(async (req, res) => {
  const { id, userId } = req.params as any; const me = req.user.id;
  hostOnly(await loadEvent({ id }, me));
  const r = await prisma.callEventGuest.updateMany({ where: { eventId: id, userId, response: { not: 'REMOVED' } }, data: { response: 'REMOVED', joinRequested: false, approved: false } });
  if (!r.count) throw notFound('That person is not invited');
  changed([me, userId]);
  res.json({ data: await loadEvent({ id }, me) });
}));

// Invited guests, and people who opened the invitation link
callEventsRouter.post('/:id/respond', validate({ params: idParam, body: z.object({ status: z.enum(['accepted', 'declined'], { message: 'Choose accept or decline' }) }) }), wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id; const status = req.body.status as 'accepted' | 'declined';
  const cur = await loadEvent({ id }, me);
  if (cur.me.host) throw bad('You are the host of this event');
  openOnly(cur);
  const existing = await prisma.callEventGuest.findUnique({ where: { eventId_userId: { eventId: id, userId: me } } });
  if (existing?.response === 'REMOVED') throw forbidden('You are no longer invited to this call');
  if (!existing && (await isBlockedBetween(me, cur.host_user_id))) throw forbidden('You can’t join this call');
  const response = status === 'accepted' ? 'ACCEPTED' : 'DECLINED';
  await prisma.callEventGuest.upsert({ where: { eventId_userId: { eventId: id, userId: me } }, create: { eventId: id, userId: me, response, viaLink: true }, update: { response, reminderSentAt: null } });
  const name = first((await prisma.user.findUnique({ where: { id: me }, select: { fullName: true } }))?.fullName);
  await evNotify(cur.host_user_id, me, `${name} ${status} “${cur.title}”`, id, 'event:response');
  changed([me, cur.host_user_id]);
  res.json({ data: await loadEvent({ id }, me) });
}));

callEventsRouter.get('/:id/participants', validate({ params: idParam }), wrap(async (req, res) => {
  const ev = await loadEvent({ id: req.params.id }, req.user.id);
  if (!ev.me.host && !ev.me.status) throw forbidden('You are not invited to this call');
  res.json({ data: {
    going: [{ ...ev.host, creator: true }, ...ev.guests.filter((g) => g.invitation_status === 'accepted')],
    not_responded: ev.guests.filter((g) => g.invitation_status === 'pending'),
    declined: ev.guests.filter((g) => g.invitation_status === 'declined'),
    requests: ev.me.host ? ev.guests.filter((g) => g.join_requested) : [],
  } });
}));

// The authorisation step before the room: event exists, not cancelled/ended, invited, window open, approval.
callEventsRouter.post('/:id/join', validate({ params: idParam }), wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id;
  const ev = await loadEvent({ id }, me);
  if (!ev.join.ok) throw new HttpError(ev.join.early ? 425 : 403, ev.join.reason || 'You cannot join this call', ev.join.early ? 'too_early' : 'forbidden');
  if (ev.join.needsApproval) {
    const r = await prisma.callEventGuest.updateMany({ where: { eventId: id, userId: me, joinRequested: false }, data: { joinRequested: true } });
    if (r.count) {
      const name = first((await prisma.user.findUnique({ where: { id: me }, select: { fullName: true } }))?.fullName);
      await evNotify(ev.host_user_id, me, `${name} asked to join “${ev.title}”`, id, 'event:request'); changed([ev.host_user_id]);
    }
    return res.json({ data: { status: 'pending', event: await loadEvent({ id }, me) } });
  }
  if (!ev.me.host) await prisma.callEventGuest.updateMany({ where: { eventId: id, userId: me }, data: { joinedAt: new Date(), leftAt: null, joinRequested: false } });
  res.json({ data: { status: 'ok', room: { meeting_id: ev.meeting_id, call_type: ev.call_type, title: ev.title }, event: ev, ice: iceServers(me) } });
}));
callEventsRouter.post('/:id/leave', validate({ params: idParam }), wrap(async (req, res) => {
  await prisma.callEventGuest.updateMany({ where: { eventId: req.params.id, userId: req.user.id }, data: { leftAt: new Date() } });
  res.json({ data: { ok: true } });
}));

// Host lets a guest in (or not)
callEventsRouter.post('/:id/requests/:userId', validate({ params: z.object({ id: uuid, userId: uuid }), body: z.object({ approve: z.boolean() }) }), wrap(async (req, res) => {
  const { id, userId } = req.params as any; const me = req.user.id;
  hostOnly(await loadEvent({ id }, me));
  const r = await prisma.callEventGuest.updateMany({ where: { eventId: id, userId, joinRequested: true }, data: { approved: req.body.approve, joinRequested: false } });
  if (!r.count) throw notFound('There is no join request from that person');
  if (req.body.approve) emitToUser(userId, 'callevent:join_approved', { event_id: id });
  changed([me, userId]);
  res.json({ data: await loadEvent({ id }, me) });
}));

// My own reminder for this event (hosts change the default by editing the event)
callEventsRouter.post('/:id/reminders', validate({ params: idParam, body: z.object({ minutes: z.number().refine((m) => [0, 5, 15, 30, 60, 1440].includes(m), 'Choose a valid reminder') }) }), wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id; const minutes = req.body.minutes as number;
  const ev = await loadEvent({ id }, me); openOnly(ev);
  if (ev.me.host) await prisma.callEvent.update({ where: { id }, data: { hostReminderMinutes: minutes, hostReminderSentAt: null } });
  else if (ev.me.status === 'accepted') await prisma.callEventGuest.update({ where: { eventId_userId: { eventId: id, userId: me } }, data: { reminderMinutes: minutes, reminderSentAt: null } });
  else throw forbidden('Accept the invitation first');
  res.json({ data: { ok: true, reminder: reminderLabel(minutes) } });
}));

/** Job: send each person's reminder once, at start - their chosen minutes. Edits re-arm (see PUT). */
export async function callEventReminderJob(now = new Date()) {
  const events = await prisma.callEvent.findMany({
    where: { status: 'scheduled', startsAt: { gt: now, lte: new Date(now.getTime() + MS.day + MS.min) } },
    include: { guests: { where: { response: 'ACCEPTED', reminderSentAt: null } } }, take: 500,
  });
  let sent = 0;
  const due = (start: Date, minutes: number) => minutes > 0 && now.getTime() >= toMs(reminderAt(start.toISOString(), minutes));
  for (const e of events) {
    const body = `Starts at ${e.startsAt.toISOString()}`;
    const send = async (userId: string) => notify({ userId, type: 'EVENT', title: `Reminder: “${e.title}” starts in ${Math.max(1, Math.round((e.startsAt.getTime() - now.getTime()) / MS.min))} min`, body, data: { eventId: e.id, kind: 'event:reminder' }, urgent: true });
    if (!e.hostReminderSentAt && due(e.startsAt, e.hostReminderMinutes ?? e.reminderMinutes)) {
      const r = await prisma.callEvent.updateMany({ where: { id: e.id, hostReminderSentAt: null }, data: { hostReminderSentAt: now } }); // claim first: two workers never double-send
      if (r.count) { await send(e.hostId); sent++; }
    }
    for (const g of e.guests) {
      if (!due(e.startsAt, g.reminderMinutes ?? e.reminderMinutes)) continue;
      const r = await prisma.callEventGuest.updateMany({ where: { eventId: e.id, userId: g.userId, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (r.count) { await send(g.userId); sent++; }
    }
  }
  if (sent) logger.info({ sent }, 'call event reminders sent');
  return sent;
}

/** Job: scheduled personal calls ("call X at 6pm") nudge their owner once the time arrives. */
export async function scheduledCallReminderJob(now = new Date()) {
  const due = await prisma.scheduledCall.findMany({ where: { at: { lte: now, gt: new Date(now.getTime() - 10 * MS.min) }, notifiedAt: null }, include: { peer: true }, take: 200 });
  for (const s of due) {
    const r = await prisma.scheduledCall.updateMany({ where: { id: s.id, notifiedAt: null }, data: { notifiedAt: now } });
    if (r.count) await notify({ userId: s.userId, type: 'CALENDAR_REMINDER', title: `Time to call ${s.peer.fullName}`, body: s.note || (s.video ? 'Video call' : 'Voice call'), data: { peerId: s.peerId, video: s.video, kind: 'scheduled_call' }, urgent: true });
  }
  return due.length;
}
