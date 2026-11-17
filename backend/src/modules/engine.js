// Friends Streak engine: pure functions, no browser or framework APIs.
// The same file runs in the demo service (src/services/streakService.js) and can be imported by a Node backend,
// which should call it inside a DB transaction holding a row lock on the friendship (see docs/STREAKS.md).
//
// TIMEZONE POLICY: a streak day is a calendar day in the *friendship timezone* (`tz`, an IANA name such as
// "Asia/Kolkata"). It is fixed when the friendship's streak row is created (the timezone of the user who sent
// the first message, falling back to "UTC") so both friends always share the same deadline. Timestamps are
// stored in UTC; day keys ("YYYY-MM-DD") are always derived with dayKey(ms, tz), which handles DST.

export const MILESTONES = [3, 7, 14, 30, 50, 100, 365];
export const DEFAULT_CONFIG = {
  atRiskHours: 4,          // show the hourglass this long before the deadline
  recoveryWindowHours: 48, // how long after expiry a streak can be recovered
  recoveryCooldownDays: 30, // one recovery per friendship per this many days
  maxProcessedIds: 200,    // idempotency window of remembered message ids
  spamPerDayLimit: 500,    // activity events counted per user per day before further ones are ignored
};
const QUALIFYING = new Set(['text', 'image', 'video', 'voice']);
const HOUR = 3600e3;

// ---------- day math ----------
const pad = (n) => String(n).padStart(2, '0');
const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  return fmtCache.get(tz);
}
const parts = (ms, tz) => Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
export const dayKey = (ms, tz = 'UTC') => { const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day}`; };
export const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
export const diffDays = (a, b) => { const f = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((f(a) - f(b)) / 86400e3); };
// offset (ms) of tz from UTC at instant ms
const offsetAt = (ms, tz) => { const p = parts(ms, tz); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; };
// the UTC instant at which local day `key` begins in tz (DST-safe)
export function startOfDay(key, tz = 'UTC') {
  const [y, m, d] = key.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d);
  let guess = naive - offsetAt(naive, tz);
  guess = naive - offsetAt(guess, tz);
  return guess;
}
export const endOfDay = (key, tz) => startOfDay(addDays(key, 1), tz); // exclusive

// ---------- state ----------
export function newStreak({ friendshipId, userIds, tz = 'UTC', now = Date.now() }) {
  return {
    friendshipId, userIds: [...userIds].sort(), tz,
    count: 0, longest: 0, lastMutualDay: null, status: 'none', // none | active | at_risk | expired
    day: { key: null, contributed: {} },
    createdAt: now, startedAt: null, expiresAt: null,
    streakId: 0, milestones: [], recovery: { available: null, history: [] },
    processedIds: [], counts: {}, blocked: false, removed: false,
  };
}
const clone = (s) => JSON.parse(JSON.stringify(s));

export const isQualifying = (a) => {
  if (!a || a.automated || a.system) return false;
  if (!QUALIFYING.has(a.kind)) return false; // reactions, calls, system notices, etc.
  if (a.kind === 'text') {
    const t = (a.text || '').trim();
    if (!t) return false;
    if (/^(.)\1{19,}$/u.test(t)) return false; // "aaaaaaaaaaaaaaaaaaaa" style spam
  }
  return true;
};

// Recomputes status/expiry for `now`. Pure: returns a new state and a list of events.
export function evaluate(state, now, cfg = {}) {
  const c = { ...DEFAULT_CONFIG, ...cfg };
  const s = clone(state); const events = [];
  const today = dayKey(now, s.tz);
  if (s.day.key !== today) s.day = { key: today, contributed: {} }; // one-sided activity never carries over
  if (s.count > 0 && s.lastMutualDay) {
    const gap = diffDays(today, s.lastMutualDay);
    const deadline = endOfDay(addDays(s.lastMutualDay, 1), s.tz);
    s.expiresAt = deadline;
    if (gap >= 2) { // a full streak day passed with no mutual exchange
      const expiredAt = deadline;
      const recent = s.recovery.history.some((h) => now - h.at < c.recoveryCooldownDays * 86400e3);
      s.recovery.available = recent ? null : { previousCount: s.count, expiredAt, eligibleUntil: expiredAt + c.recoveryWindowHours * HOUR, streakId: s.streakId };
      events.push({ type: 'expired', previousCount: s.count });
      s.count = 0; s.status = 'expired'; s.expiresAt = null; s.startedAt = null;
    } else if (gap === 1 && deadline - now <= c.atRiskHours * HOUR) s.status = 'at_risk';
    else s.status = 'active';
  } else if (s.status === 'expired' && s.recovery.available && now > s.recovery.available.eligibleUntil) {
    s.recovery.available = null; // window closed
  } else if (s.count === 0 && s.status !== 'expired') s.status = 'none';
  return { state: s, events };
}

// Applies one piece of activity. Idempotent on activity.id; safe to replay.
// activity: { id, userId, kind, text?, at (ms), automated?, system? }
// ctx: { now?, cfg? }
export function applyActivity(state, activity, ctx = {}) {
  const c = { ...DEFAULT_CONFIG, ...(ctx.cfg || {}) };
  const now = ctx.now ?? activity.at ?? Date.now();
  const ignore = (reason) => ({ state, changed: false, ignored: reason, events: [] });
  if (state.blocked || state.removed) return ignore('friendship_inactive'); // blocked / unfriended / deleted
  if (!state.userIds.includes(activity.userId)) return ignore('not_a_participant');
  if (!activity.id) return ignore('missing_id');
  if (state.processedIds.includes(activity.id)) return ignore('duplicate');
  if (!isQualifying(activity)) return ignore('not_qualifying');
  const at = Math.min(activity.at ?? now, now); // clients can't post-date activity
  if (now - at > 36 * HOUR) return ignore('too_old');
  if ((state.counts[`${activity.userId}|${dayKey(at, state.tz)}`] || 0) >= c.spamPerDayLimit) return ignore('rate_limited');

  let { state: s, events } = evaluate(state, now, ctx.cfg);
  const today = s.day.key;
  if (dayKey(at, s.tz) !== today) return { state: { ...s, processedIds: remember(s.processedIds, activity.id, c) }, changed: true, ignored: 'outside_current_day', events };
  s.processedIds = remember(s.processedIds, activity.id, c);
  const ck = `${activity.userId}|${today}`;
  s.counts = { ...s.counts, [ck]: (s.counts[ck] || 0) + 1 };
  const firstTimeToday = !s.day.contributed[activity.userId];
  s.day.contributed[activity.userId] = at;
  if (firstTimeToday) events.push({ type: 'contributed', userId: activity.userId });
  const both = s.userIds.every((u) => s.day.contributed[u]);
  if (both && s.lastMutualDay !== today) {
    const continuing = s.count > 0 && s.lastMutualDay && diffDays(today, s.lastMutualDay) === 1;
    if (!continuing) { s.streakId += 1; s.count = 0; s.startedAt = now; }
    s.count += 1; s.lastMutualDay = today; s.longest = Math.max(s.longest, s.count);
    s.status = 'active'; s.expiresAt = endOfDay(addDays(today, 1), s.tz);
    s.recovery.available = null;
    events.push({ type: s.count === 1 ? 'started' : 'incremented', count: s.count });
    if (MILESTONES.includes(s.count) && !s.milestones.some((m) => m.days === s.count && m.streakId === s.streakId)) {
      s.milestones = [...s.milestones, { days: s.count, at: now, streakId: s.streakId }];
      events.push({ type: 'milestone', days: s.count });
    }
  }
  return { state: s, changed: true, events };
}
const remember = (ids, id, c) => [...ids, id].slice(-c.maxProcessedIds);

// One limited recovery for a recently expired streak. Free by default.
export function recover(state, userId, now, cfg = {}) {
  const c = { ...DEFAULT_CONFIG, ...cfg };
  if (state.blocked || state.removed) return { ok: false, reason: 'friendship_inactive', state };
  if (!state.userIds.includes(userId)) return { ok: false, reason: 'not_a_participant', state };
  const { state: s } = evaluate(state, now, cfg);
  const r = s.recovery.available;
  if (!r) return { ok: false, reason: s.recovery.history.some((h) => now - h.at < c.recoveryCooldownDays * 86400e3) ? 'already_used' : 'nothing_to_recover', state: s };
  if (now > r.eligibleUntil) { s.recovery.available = null; return { ok: false, reason: 'window_closed', state: s }; }
  const today = dayKey(now, s.tz);
  s.count = r.previousCount; s.status = 'active';
  s.lastMutualDay = addDays(today, -1); // both friends still need to exchange today to continue
  s.expiresAt = endOfDay(today, s.tz);
  s.recovery = { available: null, history: [...s.recovery.history, { at: now, by: userId, restoredCount: r.previousCount, expiredAt: r.expiredAt }] };
  return { ok: true, state: s, events: [{ type: 'recovered', count: r.previousCount }] };
}

// Contribution status for UI: who has contributed in the current streak day.
export function contributionStatus(state, now, cfg) {
  const { state: s } = evaluate(state, now, cfg);
  const by = Object.fromEntries(s.userIds.map((u) => [u, !!s.day.contributed[u]]));
  const today = s.day.key;
  const doneToday = s.lastMutualDay === today;
  const msLeft = s.count > 0 && !doneToday && s.lastMutualDay ? Math.max(0, endOfDay(addDays(s.lastMutualDay, 1), s.tz) - now) : null;
  return { day: today, by, doneToday, msLeft, status: s.status, count: s.count };
}

export const defaultReminderPrefs = () => ({ enabled: true, push: true, inApp: true, hoursBefore: 4 });
// Whether to nudge `userId`: only when at risk, they still owe today's contribution, reminders are on, and at most once per day.
export function shouldRemind(state, userId, prefs, now, cfg) {
  const p = { ...defaultReminderPrefs(), ...(prefs || {}) };
  if (!p.enabled || state.blocked || state.removed) return false;
  const { state: s } = evaluate(state, now, { ...cfg, atRiskHours: p.hoursBefore });
  if (s.status !== 'at_risk' || s.day.contributed[userId]) return false;
  return s.lastReminded?.[userId] !== s.day.key;
}
export const markReminded = (state, userId) => ({ ...state, lastReminded: { ...(state.lastReminded || {}), [userId]: state.day.key } });

// Friendly, non-guilt-inducing copy
export function friendshipMessage(count, status) {
  if (status === 'expired') return 'No pressure. Say hi whenever you like.';
  if (status === 'at_risk') return 'A quick hello keeps it going.';
  if (count >= 100) return 'A friendship for the books.';
  if (count >= 30) return 'Going strong together.';
  if (count >= 7) return 'Nice rhythm, you two.';
  if (count >= 1) return 'You two keep showing up for each other.';
  return 'Send a message to start a streak.';
}
