// Demo "server" for Friends Streaks, used when VITE_USE_MOCK=true. It plays the role of the backend:
// all rules live in ../streaks/engine.js, state is persisted per browser, and every change is
// broadcast on `streakBus` exactly like a `streak:update` socket event would be.
// With a real backend, the same engine runs server-side and api.js talks to /streaks (see docs/STREAKS.md).
import { newStreak, applyActivity, evaluate, recover as recoverStreak, contributionStatus, shouldRemind, markReminded, defaultReminderPrefs, addDays, dayKey, startOfDay, friendshipMessage } from '../streaks/engine.js';

export const streakBus = new EventTarget();
const KEY = 'smu_streaks_v1';
const ME = 'u0';
export const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

// conversation id -> friend. In the real app the friendship id comes from the friendships table.
export const FRIENDS = {
  c1: { id: 'u1', name: 'Priya', avatar: '/assets/priya.png' },
  c2: { id: 'u2', name: 'Rahul', avatar: '/assets/rahul.png' },
  c5: { id: 'u3', name: 'Anu', avatar: '/assets/tl-anu.png' },
};

let mem = null;
const load = () => {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { mem = null; }
  if (!mem) mem = seed();
  return mem;
};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* storage unavailable: keep in memory */ } };

function seed() {
  const now = Date.now(); const tz = localTz(); const today = dayKey(now, tz);
  const mk = (cid, over) => ({ ...newStreak({ friendshipId: cid, userIds: [ME, FRIENDS[cid].id], tz, now: now - 40 * 864e5 }), ...over });
  const yesterday = addDays(today, -1);
  const states = {
    c1: mk('c1', { count: 12, longest: 21, lastMutualDay: yesterday, status: 'active', streakId: 2, startedAt: now - 12 * 864e5, milestones: [{ days: 3, at: now - 9 * 864e5, streakId: 2 }, { days: 7, at: now - 5 * 864e5, streakId: 2 }], day: { key: today, contributed: { u1: now - 3600e3 } } }),
    c2: mk('c2', { count: 3, longest: 5, lastMutualDay: yesterday, status: 'active', streakId: 1, startedAt: now - 3 * 864e5, milestones: [{ days: 3, at: now - 864e5, streakId: 1 }], day: { key: today, contributed: {} } }),
    c5: mk('c5', { count: 21, longest: 21, lastMutualDay: addDays(today, -3), status: 'active', streakId: 1, startedAt: now - 24 * 864e5, milestones: [{ days: 3, at: now - 20 * 864e5, streakId: 1 }, { days: 7, at: now - 16 * 864e5, streakId: 1 }, { days: 14, at: now - 10 * 864e5, streakId: 1 }], day: { key: today, contributed: {} } }),
  };
  return { states, prefs: defaultReminderPrefs() };
}
const stateOf = (cid) => { const m = load(); return m.states[cid] || null; };

// ---- read models ----
export function summarize(s, cid, now = Date.now()) {
  const f = FRIENDS[cid] || { id: s.userIds.find((u) => u !== ME), name: 'Friend', avatar: '' };
  const { state: e } = evaluate(s, now);
  const cs = contributionStatus(s, now);
  return {
    friendshipId: cid, friend: f, count: e.count, longest: e.longest, status: e.status, tz: e.tz,
    lastMutualDay: e.lastMutualDay, expiresAt: e.expiresAt, msLeft: cs.msLeft, doneToday: cs.doneToday,
    me: !!e.day.contributed[ME], them: !!e.day.contributed[f.id],
    milestones: e.milestones, nextMilestone: [3, 7, 14, 30, 50, 100, 365].find((m) => m > e.count) || null,
    recovery: e.recovery.available, recoveryUsed: e.recovery.history.length, blocked: e.blocked || e.removed,
    message: friendshipMessage(e.count, e.status),
  };
}

// ---- endpoints ----
export const streakService = {
  list(now = Date.now()) {
    const m = load(); let dirty = false;
    const items = Object.entries(m.states).map(([cid, s]) => {
      const { state: e, events } = evaluate(s, now);
      if (events.length || e.day.key !== s.day.key || e.status !== s.status) { m.states[cid] = e; dirty = true; }
      return summarize(m.states[cid], cid, now);
    }).filter((x) => !x.blocked);
    if (dirty) save();
    return items;
  },
  get(cid, now = Date.now()) { const s = stateOf(cid); if (!s) return null; return summarize(s, cid, now); },
  contribution(cid, now = Date.now()) { const s = stateOf(cid); return s ? contributionStatus(s, now) : null; },
  // Called by the message pipeline on every sent message/media. Idempotent by activity.id.
  record(cid, activity, now = Date.now()) {
    const m = load(); const f = FRIENDS[cid];
    if (!f) return { ignored: 'no_friendship', events: [] };
    const s = m.states[cid] || (m.states[cid] = newStreak({ friendshipId: cid, userIds: [ME, f.id], tz: localTz(), now }));
    const r = applyActivity(s, { ...activity, at: activity.at ?? now }, { now });
    if (r.changed) { m.states[cid] = r.state; save(); }
    const summary = summarize(m.states[cid], cid, now);
    if (r.changed) streakBus.dispatchEvent(new CustomEvent('streak:update', { detail: { friendshipId: cid, summary, events: r.events } }));
    return { summary, events: r.events, ignored: r.ignored };
  },
  recover(cid, now = Date.now()) {
    const m = load(); const s = stateOf(cid); if (!s) return { ok: false, reason: 'nothing_to_recover' };
    const r = recoverStreak(s, ME, now);
    if (r.ok) { m.states[cid] = r.state; save(); streakBus.dispatchEvent(new CustomEvent('streak:update', { detail: { friendshipId: cid, summary: summarize(r.state, cid, now), events: r.events } })); }
    return { ok: r.ok, reason: r.reason, summary: r.ok ? summarize(r.state, cid, now) : null };
  },
  prefs() { return { ...load().prefs }; },
  setPrefs(p) { const m = load(); m.prefs = { ...m.prefs, ...p }; save(); streakBus.dispatchEvent(new CustomEvent('streak:prefs', { detail: m.prefs })); return { ...m.prefs }; },
  // Friendship changes: blocking / unfriending / account deletion stop streak activity and hide the streak.
  setFlags(cid, flags) { const m = load(); const s = m.states[cid]; if (!s) return; m.states[cid] = { ...s, ...flags }; save(); streakBus.dispatchEvent(new CustomEvent('streak:update', { detail: { friendshipId: cid, events: [] } })); },
  // Reminders that are due now (in-app). Marks them as sent so a user is nudged at most once a day.
  dueReminders(now = Date.now()) {
    const m = load(); const p = m.prefs; const out = [];
    for (const [cid, s] of Object.entries(m.states)) {
      if (p.inApp !== false && shouldRemind(s, ME, p, now)) { out.push(summarize(s, cid, now)); m.states[cid] = markReminded(evaluate(s, now).state, ME); }
    }
    if (out.length) save();
    return out;
  },
  reset() { mem = null; try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};
export const fmtLeft = (ms) => { if (ms == null) return ''; const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3); return h > 0 ? `${h}h ${m}m left` : `${m}m left`; };
export { startOfDay };
