import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma, Tx } from '../lib/db';
import { HttpError, notFound } from '../lib/errors';
import { idParam, validate, wrap } from '../lib/http';
import { notify } from '../lib/notify';
import { emitToUsers } from '../lib/realtime';
import { toUrl } from '../lib/storage';
import { requireAuth } from '../middleware/auth';
import { applyActivity, contributionStatus, defaultReminderPrefs, evaluate, friendshipMessage, markReminded, newStreak, recover, shouldRemind } from './engine';
import { isBlockedBetween } from './common';

// A streak belongs to one DIRECT conversation (the "friendship id" the web app uses). The rules live in engine.js;
// this file owns persistence, locking, server-clock enforcement and fan-out.

const NEXT = [3, 7, 14, 30, 50, 100, 365];
const ordered = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

export function summarize(row: { conversationId: string; state: any }, meId: string, friend: { id: string; name: string; avatar: string | null }, now = Date.now()) {
  const { state: e } = evaluate(row.state, now);
  const cs = contributionStatus(row.state, now);
  return {
    friendshipId: row.conversationId, friend, count: e.count, longest: e.longest, status: e.status, tz: e.tz, lastMutualDay: e.lastMutualDay,
    expiresAt: e.expiresAt, msLeft: cs.msLeft, doneToday: cs.doneToday, me: !!e.day.contributed[meId], them: !!e.day.contributed[friend.id],
    milestones: e.milestones, nextMilestone: NEXT.find((m) => m > e.count) || null, recovery: e.recovery.available, recoveryUsed: e.recovery.history.length,
    blocked: !!(e.blocked || e.removed), message: friendshipMessage(e.count, e.status),
  };
}

async function friendOf(conversationId: string, meId: string) {
  const m = await prisma.conversationMember.findFirst({ where: { conversationId, userId: { not: meId } }, include: { user: { include: { profile: true } } } });
  if (!m) return { id: '', name: 'Friend', avatar: null };
  return { id: m.userId, name: m.user.fullName, avatar: toUrl(m.user.profile?.avatarThumbUrl || m.user.profile?.avatarUrl) };
}

/**
 * Called by the message pipeline inside the send transaction. Locks the streak row, dedupes on message id,
 * applies the engine with the SERVER clock, persists history. Returns events to broadcast after commit.
 */
export async function recordActivity(tx: Tx, a: { conversationId: string; userId: string; messageId: string; kind: 'text' | 'image' | 'video' | 'voice'; text?: string | null }) {
  const conv = await tx.conversation.findUnique({ where: { id: a.conversationId }, select: { type: true, members: { select: { userId: true } } } });
  if (!conv || conv.type !== 'DIRECT' || conv.members.length !== 2) return null;
  const [A, B] = ordered(conv.members[0].userId, conv.members[1].userId);
  const now = Date.now();
  // row lock: concurrent messages from both friends serialise here
  await tx.$executeRaw`INSERT INTO "streaks" ("conversationId","userAId","userBId","state","updatedAt") VALUES (${a.conversationId}::uuid, ${A}::uuid, ${B}::uuid, ${JSON.stringify(newStreak({ friendshipId: a.conversationId, userIds: [A, B], tz: 'UTC', now }))}::jsonb, now()) ON CONFLICT ("conversationId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ state: any; tz: string }[]>`SELECT "state", "tz" FROM "streaks" WHERE "conversationId" = ${a.conversationId}::uuid FOR UPDATE`;
  let state = rows[0].state;
  if (await isBlockedBetween(A, B, tx)) { if (!state.blocked) state = { ...state, blocked: true }; }
  const ins = await tx.streakEvent.createMany({ data: [{ conversationId: a.conversationId, messageId: a.messageId, userId: a.userId, kind: a.kind, dayKey: '' }], skipDuplicates: true });
  if (ins.count === 0) return null; // duplicate message id: nothing to do
  // the friendship timezone is fixed by the first sender (their saved timezone), so both friends share one deadline
  if (!state.createdFor) {
    const st = await tx.userSettings.findUnique({ where: { userId: a.userId }, select: { timezone: true } });
    state = { ...state, tz: st?.timezone || 'UTC', createdFor: a.userId };
  }
  const r = applyActivity(state, { id: a.messageId, userId: a.userId, kind: a.kind, text: a.text ?? undefined, at: now }, { now });
  if (!r.changed && r.state === state) return null;
  const s = r.state;
  await tx.streak.update({ where: { conversationId: a.conversationId }, data: { state: s as Prisma.InputJsonValue, tz: s.tz, currentCount: s.count, longestCount: s.longest, status: s.status, expiresAt: s.expiresAt ? new Date(s.expiresAt) : null, blocked: !!s.blocked } });
  await tx.streakEvent.update({ where: { conversationId_messageId: { conversationId: a.conversationId, messageId: a.messageId } }, data: { dayKey: s.day.key || '' } });
  for (const ev of r.events) {
    if (ev.type === 'started') await tx.streakRun.upsert({ where: { conversationId_run: { conversationId: a.conversationId, run: s.streakId } }, create: { conversationId: a.conversationId, run: s.streakId, startedAt: new Date(now), length: 1 }, update: {} });
    if (ev.type === 'incremented' || ev.type === 'started') await tx.streakRun.updateMany({ where: { conversationId: a.conversationId, run: s.streakId }, data: { length: s.count } });
  }
  return { state: s, events: r.events, userIds: [A, B] as string[] };
}

/** After commit: push realtime updates + milestone notifications. */
export async function broadcastStreak(conversationId: string, result: NonNullable<Awaited<ReturnType<typeof recordActivity>>>) {
  const row = { conversationId, state: result.state };
  for (const uid of result.userIds) {
    const friend = await friendOf(conversationId, uid);
    emitToUsers([uid], 'streak:update', { friendshipId: conversationId, summary: summarize(row, uid, friend), events: result.events });
  }
  for (const ev of result.events) {
    if (ev.type === 'milestone') for (const uid of result.userIds) await notify({ userId: uid, type: 'STREAK', title: `🔥 ${ev.days}-day streak!`, body: 'You two keep showing up for each other.', data: { friendshipId: conversationId, days: ev.days } });
  }
}

export async function setStreakBlocked(a: string, b: string, blocked: boolean) {
  const conv = await prisma.conversation.findUnique({ where: { directKey: ordered(a, b).join(':') }, select: { id: true } });
  if (!conv) return;
  const row = await prisma.streak.findUnique({ where: { conversationId: conv.id } });
  if (!row) return;
  const state = { ...(row.state as any), blocked };
  await prisma.streak.update({ where: { conversationId: conv.id }, data: { state, blocked } });
  emitToUsers([a, b], 'streak:update', { friendshipId: conv.id, summary: null, events: [] });
}

async function mine(userId: string) {
  return prisma.streak.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }], blocked: false }, orderBy: [{ currentCount: 'desc' }, { updatedAt: 'desc' }] });
}
async function persistEvaluated(row: { conversationId: string; state: any }, now: number) {
  const { state: e, events } = evaluate(row.state, now);
  if (events.length || e.day.key !== row.state.day.key || e.status !== row.state.status) {
    await prisma.streak.update({ where: { conversationId: row.conversationId }, data: { state: e, currentCount: e.count, status: e.status, expiresAt: e.expiresAt ? new Date(e.expiresAt) : null } });
    if (events.some((x: any) => x.type === 'expired')) await prisma.streakRun.updateMany({ where: { conversationId: row.conversationId, run: e.streakId, endedAt: null }, data: { endedAt: new Date(now), endReason: 'expired' } });
    return { ...row, state: e };
  }
  return row;
}

export const streaksRouter = Router();
streaksRouter.use(requireAuth);

streaksRouter.get('/', wrap(async (req, res) => {
  const now = Date.now(); const out = [];
  for (const r of await mine(req.user.id)) {
    const row = await persistEvaluated(r, now);
    out.push(summarize(row, req.user.id, await friendOf(r.conversationId, req.user.id), now));
  }
  res.json(out.filter((s) => !s.blocked));
}));

// preferences must be declared before /:id
const prefsBody = z.object({ enabled: z.boolean(), push: z.boolean(), inApp: z.boolean(), hoursBefore: z.number().int().min(1).max(12) }).partial();
streaksRouter.get('/preferences', wrap(async (req, res) => {
  const s = await prisma.userSettings.findUnique({ where: { userId: req.user.id }, select: { streakPrefs: true } });
  res.json({ ...defaultReminderPrefs(), ...((s?.streakPrefs as any) || {}) });
}));
streaksRouter.put('/preferences', validate({ body: prefsBody }), wrap(async (req, res) => {
  const cur = await prisma.userSettings.findUnique({ where: { userId: req.user.id }, select: { streakPrefs: true } });
  const next = { ...defaultReminderPrefs(), ...((cur?.streakPrefs as any) || {}), ...req.body };
  await prisma.userSettings.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, streakPrefs: next }, update: { streakPrefs: next } });
  res.json(next);
}));

async function loadFor(userId: string, id: string) {
  const row = await prisma.streak.findUnique({ where: { conversationId: id } });
  if (!row || (row.userAId !== userId && row.userBId !== userId)) throw notFound('Streak not found'); // non-participants learn nothing
  return row;
}
streaksRouter.get('/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const row = await persistEvaluated(await loadFor(req.user.id, req.params.id), Date.now());
  res.json(summarize(row, req.user.id, await friendOf(req.params.id, req.user.id)));
}));
streaksRouter.get('/:id/contribution', validate({ params: idParam }), wrap(async (req, res) => {
  const row = await loadFor(req.user.id, req.params.id);
  res.json(contributionStatus(row.state, Date.now()));
}));
streaksRouter.get('/:id/history', validate({ params: idParam }), wrap(async (req, res) => {
  await loadFor(req.user.id, req.params.id);
  const runs = await prisma.streakRun.findMany({ where: { conversationId: req.params.id }, orderBy: { run: 'desc' }, take: 50 });
  res.json(runs.map((r) => ({ run: r.run, startedAt: r.startedAt, endedAt: r.endedAt, length: r.length, endReason: r.endReason })));
}));
// Clients can never set their own streak: it is recorded from real, server-stored messages.
streaksRouter.post('/:id/activity', validate({ params: idParam }), wrap(async () => { throw new HttpError(403, 'Streaks are recorded by the server when messages are sent', 'forbidden'); }));
streaksRouter.post('/:id/recover', validate({ params: idParam }), wrap(async (req, res) => {
  const id = req.params.id;
  const out = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ state: any; userAId: string; userBId: string }[]>`SELECT "state","userAId","userBId" FROM "streaks" WHERE "conversationId" = ${id}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row || (row.userAId !== req.user.id && row.userBId !== req.user.id)) throw notFound('Streak not found');
    const r = recover(row.state, req.user.id, Date.now());
    if (r.ok) {
      const s = r.state;
      await tx.streak.update({ where: { conversationId: id }, data: { state: s, currentCount: s.count, longestCount: Math.max(s.longest, s.count), status: s.status, expiresAt: new Date(s.expiresAt) } });
      await tx.streakRun.updateMany({ where: { conversationId: id, run: s.streakId }, data: { endedAt: null, endReason: null, length: s.count } });
    }
    return { r, userIds: [row.userAId, row.userBId] };
  });
  if (!out.r.ok) throw new HttpError(409, ({ already_used: 'Free recovery was already used recently', window_closed: 'The recovery window has closed', nothing_to_recover: 'There is nothing to recover', friendship_inactive: 'This friendship is inactive' } as Record<string, string>)[out.r.reason!] || 'Cannot recover', 'conflict');
  const row = { conversationId: id, state: out.r.state };
  for (const uid of out.userIds) emitToUsers([uid], 'streak:update', { friendshipId: id, summary: summarize(row, uid, await friendOf(id, uid)), events: out.r.events });
  res.json({ ok: true, summary: summarize(row, req.user.id, await friendOf(id, req.user.id)) });
}));

/** Job: remind people whose streak is about to expire (at most once a day each), and close expired runs. */
export async function streakReminderJob(now = Date.now()) {
  const soon = await prisma.streak.findMany({ where: { blocked: false, currentCount: { gt: 0 }, expiresAt: { lt: new Date(now + 13 * 3_600_000), gt: new Date(now - 3_600_000 * 24 * 3) } } });
  let sent = 0;
  for (const r of soon) {
    let state = r.state as any;
    for (const uid of [r.userAId, r.userBId]) {
      const st = await prisma.userSettings.findUnique({ where: { userId: uid }, select: { streakPrefs: true } });
      const prefs = { ...defaultReminderPrefs(), ...((st?.streakPrefs as any) || {}) };
      if (!shouldRemind(state, uid, prefs, now)) continue;
      const friend = await friendOf(r.conversationId, uid);
      await notify({ userId: uid, type: 'STREAK', title: '⏳ Your streak is about to end', body: `Say hi to ${friend.name} to keep your ${evaluate(state, now).state.count}-day streak going.`, data: { friendshipId: r.conversationId }, push: prefs.push });
      state = markReminded(evaluate(state, now).state, uid); sent++;
    }
    if (state !== r.state) await prisma.streak.update({ where: { conversationId: r.conversationId }, data: { state } });
  }
  // expire stale rows so lists and history are right even if nobody opens the app
  const stale = await prisma.streak.findMany({ where: { currentCount: { gt: 0 }, expiresAt: { lt: new Date(now) } }, take: 500 });
  for (const r of stale) await persistEvaluated(r, now);
  return { reminded: sent, expired: stale.length };
}
