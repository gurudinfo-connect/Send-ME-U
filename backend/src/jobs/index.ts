import crypto from 'node:crypto';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { notify } from '../lib/notify';
import { emitToConversation } from '../lib/realtime';
import { redis } from '../lib/redis';
import { removeObject } from '../lib/storage';
import { callEventReminderJob, expireCalls, scheduledCallReminderJob } from '../modules/calls';
import { unreferenced } from '../modules/chat';
import { MS } from '../modules/common';
import { streakReminderJob } from '../modules/streaks';
import { storyMediaCleanup } from '../modules/stories';

/**
 * Background work. Every job is idempotent (it claims rows with a conditional update before acting) and runs under a
 * lock so several API instances never run the same job at once: Redis SET NX when available, in-process otherwise.
 */
const INSTANCE = crypto.randomBytes(4).toString('hex');
const running = new Set<string>();

async function withLock(name: string, ttlMs: number, fn: () => Promise<unknown>) {
  if (running.has(name)) return;
  running.add(name);
  let held = false;
  try {
    if (redis) {
      try { held = (await redis.set(`job:${name}`, INSTANCE, 'PX', ttlMs, 'NX')) === 'OK'; } catch { held = true; } // Redis hiccup: better a rare duplicate run than none
      if (!held) return;
    }
    const t = Date.now();
    const out = await fn();
    if (out && typeof out === 'object' ? Object.values(out as object).some(Boolean) : out) logger.info({ job: name, ms: Date.now() - t, out }, 'job done');
  } catch (e: any) { logger.error({ job: name, err: e.message }, 'job failed'); }
  finally {
    running.delete(name);
    if (held && redis) { try { if ((await redis.get(`job:${name}`)) === INSTANCE) await redis.del(`job:${name}`); } catch { /* lock expires on its own */ } }
  }
}

// ───────────────────────────── jobs ─────────────────────────────

/** Disappearing messages: the row becomes a tombstone for everyone, files are removed unless a forward still uses them. */
export async function expireMessages(now = new Date()) {
  const rows = await prisma.message.findMany({ where: { expiresAt: { lte: now }, deletedAt: null }, select: { id: true, conversationId: true, attachments: { select: { storageKey: true, thumbUrl: true } } }, take: 500 });
  for (const m of rows) {
    const r = await prisma.message.updateMany({ where: { id: m.id, deletedAt: null }, data: { deletedAt: now, text: null } });
    if (!r.count) continue;
    await prisma.messageAttachment.deleteMany({ where: { messageId: m.id } });
    await unreferenced(m.attachments.flatMap((a) => [a.storageKey, a.thumbUrl]));
    emitToConversation(m.conversationId, 'message:deleted', { id: m.id, conversationId: m.conversationId, scope: 'expired' });
  }
  return { messages: rows.length };
}

/** Stories vanish for viewers at expiresAt (queries filter on it); this removes the row's files a few minutes later. */
export async function expireStories(now = new Date()) {
  const rows = await prisma.story.findMany({ where: { deletedAt: null, expiresAt: { lte: new Date(now.getTime() - 5 * MS.min) } }, select: { id: true, mediaKey: true, thumbUrl: true, audioKey: true }, take: 300 });
  for (const s of rows) {
    const r = await prisma.story.updateMany({ where: { id: s.id, deletedAt: null }, data: { deletedAt: now } });
    if (r.count) await storyMediaCleanup([s.mediaKey, s.thumbUrl, s.audioKey]); // highlights, memories, drafts and chats that point at the file keep it
  }
  return { stories: rows.length };
}

/** Old drafts nobody finished (30 days) go away with their files. */
export async function purgeStoryDrafts(now = new Date()) {
  const old = await prisma.storyDraft.findMany({ where: { updatedAt: { lt: new Date(now.getTime() - 30 * MS.day) } }, select: { id: true, mediaUrl: true }, take: 200 });
  for (const d of old) { await prisma.storyDraft.delete({ where: { id: d.id } }).catch(() => {}); await storyMediaCleanup([d.mediaUrl]); }
  return { drafts: old.length };
}

/** Accounts deleted more than 30 days ago are removed for good (cascade), together with files nobody else can see. */
export async function purgeDeletedAccounts(now = new Date()) {
  const users = await prisma.user.findMany({ where: { status: 'DELETED', deletedAt: { lt: new Date(now.getTime() - 30 * MS.day) } }, select: { id: true }, take: 25 });
  for (const u of users) {
    const [posts, stories, memories, drafts] = await Promise.all([
      prisma.post.findMany({ where: { userId: u.id }, select: { mediaUrl: true, posterUrl: true } }),
      prisma.story.findMany({ where: { userId: u.id }, select: { mediaKey: true, thumbUrl: true, audioKey: true } }),
      prisma.coupleMemory.findMany({ where: { ownerId: u.id }, select: { storageKey: true, thumbUrl: true } }),
      prisma.storyDraft.findMany({ where: { userId: u.id }, select: { mediaUrl: true } }),
    ]);
    await prisma.user.delete({ where: { id: u.id } });
    for (const p of posts) { await removeObject(p.mediaUrl); await removeObject(p.posterUrl); }
    await storyMediaCleanup([...stories.flatMap((s) => [s.mediaKey, s.thumbUrl, s.audioKey]), ...memories.flatMap((m) => [m.storageKey, m.thumbUrl]), ...drafts.map((d) => d.mediaUrl)]);
    await prisma.auditLog.create({ data: { action: 'account.purge', targetType: 'user', targetId: u.id } });
  }
  return { purged: users.length };
}

/** Shared calendar / personal events: fire `remindAt` once (to the owner and, for shared events, the partner). */
export async function calendarReminders(now = new Date()) {
  const due = await prisma.coupleCalendarEvent.findMany({ where: { remindAt: { lte: now, gt: new Date(now.getTime() - 2 * MS.day) }, notifiedAt: null }, take: 300 });
  let sent = 0;
  for (const e of due) {
    const claimed = await prisma.coupleCalendarEvent.updateMany({ where: { id: e.id, notifiedAt: null }, data: { notifiedAt: now } });
    if (!claimed.count) continue;
    const who = new Set<string>([e.ownerId]);
    if (e.coupleId) {
      const c = await prisma.coupleConnection.findUnique({ where: { id: e.coupleId }, select: { inviterId: true, inviteeId: true, status: true } });
      if (c?.status === 'ACTIVE') { who.add(c.inviterId); who.add(c.inviteeId); }
    }
    for (const userId of who) { await notify({ userId, type: 'CALENDAR_REMINDER', title: `Reminder: ${e.title}`, body: e.date.toISOString().slice(0, 10) + (e.time ? ` at ${e.time}` : ''), data: { eventId: e.id, kind: 'calendar_event' } }); sent++; }
  }
  return { reminders: sent };
}

/** Couple appointments: both people are reminded 30 minutes before. A private appointment only reminds its author. */
export async function appointmentReminders(now = new Date()) {
  const due = await prisma.coupleAppointment.findMany({ where: { status: 'confirmed', remindedAt: null, startTime: { gt: now, lte: new Date(now.getTime() + 30 * MS.min) } }, include: { couple: { select: { inviterId: true, inviteeId: true, status: true } } }, take: 300 });
  let sent = 0;
  for (const a of due) {
    const claimed = await prisma.coupleAppointment.updateMany({ where: { id: a.id, remindedAt: null }, data: { remindedAt: now } });
    if (!claimed.count || a.couple.status !== 'ACTIVE') continue;
    const who = a.visibility === 'private' ? [a.createdById] : [a.couple.inviterId, a.couple.inviteeId];
    for (const userId of who) { await notify({ userId, type: 'CALENDAR_REMINDER', title: `Coming up: ${a.title}`, body: a.location ? `at ${a.location}` : 'In about 30 minutes', data: { appointmentId: a.id, kind: 'appointment' } }); sent++; }
  }
  return { appointments: sent };
}

const localParts = (tz: string, at = new Date()) => {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
    return { y: g('year'), m: g('month'), d: g('day'), h: g('hour') };
  } catch { return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate(), h: at.getUTCHours() }; }
};

/** Anniversary and birthday reminders: the day before and on the day, at 9:00 in the reader's own timezone. Deduped per year. */
export async function annualReminders(now = new Date()) {
  const couples = await prisma.coupleConnection.findMany({ where: { status: 'ACTIVE' }, include: { inviter: { include: { settings: true } }, invitee: { include: { settings: true } } }, take: 5000 });
  let sent = 0;
  const same = (d: Date, m: number, day: number) => d.getUTCMonth() + 1 === m && d.getUTCDate() === day;
  for (const c of couples) {
    for (const [me, other] of [[c.inviter, c.invitee], [c.invitee, c.inviter]] as const) {
      const tz = me.settings?.timezone || 'UTC';
      const t = localParts(tz, now); if (t.h < 9) continue;
      const tomorrow = localParts(tz, new Date(now.getTime() + MS.day));
      const items: { kind: string; date: Date | null; title: (when: string) => string }[] = [
        { kind: 'anniversary', date: c.anniversary ?? c.startDate, title: (w) => `Your anniversary is ${w} 💕` },
        { kind: 'birthday', date: other.dateOfBirth, title: (w) => `${other.fullName.split(' ')[0]}'s birthday is ${w} 🎂` },
      ];
      for (const it of items) {
        if (!it.date) continue;
        const when = same(it.date, t.m, t.d) ? 'today' : same(it.date, tomorrow.m, tomorrow.d) ? 'tomorrow' : null;
        if (!when) continue;
        const key = `${c.id}:${it.kind}:${when === 'today' ? t.y : tomorrow.y}:${when}:${me.id}`;
        const dup = await prisma.notification.findFirst({ where: { userId: me.id, type: 'CALENDAR_REMINDER', data: { path: ['dedupe'], equals: key } }, select: { id: true } });
        if (dup) continue;
        await notify({ userId: me.id, type: 'CALENDAR_REMINDER', title: it.title(when), data: { dedupe: key, kind: it.kind } }); sent++;
      }
    }
  }
  return { annual: sent };
}

/** Location sharing always ends: expired sessions are closed and the coordinates deleted (there is no history table). */
export async function locationJanitor(now = new Date()) {
  const expired = await prisma.locationSession.findMany({ where: { isActive: true, expiresAt: { lte: now } }, select: { id: true, userId: true }, take: 500 });
  for (const s of expired) {
    await prisma.$transaction([prisma.locationSession.update({ where: { id: s.id }, data: { isActive: false, stoppedAt: now } }), prisma.liveLocation.deleteMany({ where: { userId: s.userId } })]);
  }
  const orphans = await prisma.liveLocation.deleteMany({ where: { user: { locationSessions: { none: { isActive: true } } } } }); // coordinates without an active session never linger
  return { sessions: expired.length, orphanLocations: orphans.count };
}

export async function housekeeping(now = new Date()) {
  const [otp, tokens, sessions, notifs, devices] = await Promise.all([
    prisma.otpCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - MS.day) } } }),
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * MS.day) } } }),
    prisma.userSession.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 7 * MS.day) } }, { revokedAt: { lt: new Date(now.getTime() - 30 * MS.day) } }] } }),
    prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * MS.day) } } }),
    prisma.device.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - 120 * MS.day) } } }),
  ]);
  return { otp: otp.count, tokens: tokens.count, sessions: sessions.count, notifications: notifs.count, devices: devices.count };
}

// ───────────────────────────── scheduler ─────────────────────────────

const timers: NodeJS.Timeout[] = [];
const every = (name: string, ms: number, fn: () => Promise<unknown>, lockMs = ms * 2) => {
  const run = () => void withLock(name, lockMs, fn);
  const t = setInterval(run, ms); t.unref(); timers.push(t);
  setTimeout(run, Math.min(5_000, ms)).unref(); // first run shortly after boot
};

export function startJobs() {
  every('calls.expire', 15_000, () => expireCalls());
  every('messages.expire', 30_000, () => expireMessages());
  every('callevents.remind', 30_000, () => callEventReminderJob());
  every('calls.scheduled', 30_000, () => scheduledCallReminderJob());
  every('calendar.remind', 30_000, () => calendarReminders());
  every('appointments.remind', 60_000, () => appointmentReminders());
  every('streaks', 5 * MS.min, () => streakReminderJob(), 4 * MS.min);
  every('stories.expire', 5 * MS.min, () => expireStories());
  every('location.janitor', 60_000, () => locationJanitor());
  every('annual.remind', 30 * MS.min, () => annualReminders());
  every('housekeeping', 6 * MS.hour, () => housekeeping());
  every('drafts.purge', 6 * MS.hour, () => purgeStoryDrafts());
  every('accounts.purge', 6 * MS.hour, () => purgeDeletedAccounts());
  logger.info({ instance: INSTANCE, jobs: timers.length }, 'background jobs started');
}
export function stopJobs() { for (const t of timers) clearInterval(t); timers.length = 0; }
