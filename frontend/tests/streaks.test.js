import test from 'node:test';
import assert from 'node:assert/strict';
import { newStreak, applyActivity, evaluate, recover, contributionStatus, shouldRemind, markReminded, dayKey, startOfDay, endOfDay, addDays, isQualifying, MILESTONES, DEFAULT_CONFIG } from '../src/streaks/engine.js';

const A = 'u1', B = 'u2';
const T = (iso) => Date.parse(iso);
let n = 0;
const msg = (userId, at, extra = {}) => ({ id: `m${++n}`, userId, kind: 'text', text: 'hello', at, ...extra });
const fresh = (tz = 'UTC', now = T('2026-01-01T00:00:00Z')) => newStreak({ friendshipId: 'f1', userIds: [A, B], tz, now });
const send = (s, m, now = m.at, cfg) => applyActivity(s, m, { now, cfg });
// both friends exchange on the day containing `iso`
function exchange(s, iso) {
  const t = T(iso);
  let r = send(s, msg(A, t)); r = send(r.state, msg(B, t + 60e3));
  return r;
}

test('mutual activity on one day creates a streak of 1', () => {
  let r = send(fresh(), msg(A, T('2026-01-10T09:00:00Z')));
  assert.equal(r.state.count, 0);
  r = send(r.state, msg(B, T('2026-01-10T10:00:00Z')));
  assert.equal(r.state.count, 1);
  assert.equal(r.state.status, 'active');
  assert.ok(r.events.some((e) => e.type === 'started'));
});

test('one-sided activity never creates or keeps a streak', () => {
  let s = fresh();
  for (let d = 10; d < 14; d++) s = send(s, msg(A, T(`2026-01-${d}T09:00:00Z`))).state;
  assert.equal(s.count, 0);
  // existing streak, only one friend writes on the next day, then the day after passes
  s = exchange(fresh(), '2026-02-01T09:00:00Z').state;
  s = send(s, msg(A, T('2026-02-02T09:00:00Z'))).state;
  const r = evaluate(s, T('2026-02-03T00:00:01Z'));
  assert.equal(r.state.count, 0);
  assert.equal(r.state.status, 'expired');
});

test('consecutive days increment, longest tracks the best run', () => {
  let s = fresh();
  for (let d = 1; d <= 5; d++) s = exchange(s, `2026-03-0${d}T08:00:00Z`).state;
  assert.equal(s.count, 5); assert.equal(s.longest, 5);
  // miss a day -> expire, then new streak restarts at 1 but longest stays
  s = evaluate(s, T('2026-03-08T00:00:00Z')).state;
  assert.equal(s.count, 0);
  s = exchange(s, '2026-03-08T08:00:00Z').state;
  assert.equal(s.count, 1); assert.equal(s.longest, 5);
});

test('missing a full day expires the streak; deadline is end of next day', () => {
  const s = exchange(fresh(), '2026-04-01T20:00:00Z').state;
  assert.equal(evaluate(s, T('2026-04-02T23:59:59Z')).state.count, 1); // still alive on the following day
  const e = evaluate(s, T('2026-04-03T00:00:00Z'));
  assert.equal(e.state.count, 0);
  assert.equal(e.state.status, 'expired');
  assert.ok(e.events.some((x) => x.type === 'expired' && x.previousCount === 1));
});

test('at-risk hourglass appears near the deadline only when a day is owed', () => {
  const s = exchange(fresh(), '2026-04-01T10:00:00Z').state;
  assert.equal(evaluate(s, T('2026-04-01T23:00:00Z')).state.status, 'active'); // same day: safe
  assert.equal(evaluate(s, T('2026-04-02T12:00:00Z')).state.status, 'active');
  assert.equal(evaluate(s, T('2026-04-02T21:00:00Z')).state.status, 'at_risk');
  const cs = contributionStatus(s, T('2026-04-02T21:00:00Z'));
  assert.equal(cs.msLeft, 3 * 3600e3);
});

test('timezone: day boundary follows the friendship timezone', () => {
  const tz = 'Asia/Kolkata'; // UTC+5:30
  assert.equal(dayKey(T('2026-05-01T18:29:00Z'), tz), '2026-05-01');
  assert.equal(dayKey(T('2026-05-01T18:31:00Z'), tz), '2026-05-02');
  // 23:50 and 00:10 local on consecutive days -> two different streak days
  let s = fresh(tz);
  s = send(s, msg(A, T('2026-05-01T18:20:00Z'))).state; // 23:50 IST May 1
  s = send(s, msg(B, T('2026-05-01T18:25:00Z'))).state;
  assert.equal(s.count, 1);
  s = send(s, msg(A, T('2026-05-01T18:40:00Z'))).state; // 00:10 IST May 2
  s = send(s, msg(B, T('2026-05-01T18:45:00Z'))).state;
  assert.equal(s.count, 2);
});

test('daylight-saving: 23h and 25h days keep correct boundaries', () => {
  const tz = 'America/New_York';
  // spring forward 2026-03-08 (23-hour day), fall back 2026-11-01 (25-hour day)
  assert.equal((endOfDay('2026-03-08', tz) - startOfDay('2026-03-08', tz)) / 3600e3, 23);
  assert.equal((endOfDay('2026-11-01', tz) - startOfDay('2026-11-01', tz)) / 3600e3, 25);
  assert.equal(new Date(startOfDay('2026-03-09', tz)).toISOString(), '2026-03-09T04:00:00.000Z');
  // streak across the spring-forward night continues
  let s = fresh(tz);
  s = exchange(s, '2026-03-07T15:00:00Z').state;
  s = exchange(s, '2026-03-08T15:00:00Z').state;
  s = exchange(s, '2026-03-09T15:00:00Z').state;
  assert.equal(s.count, 3);
  // and across the fall-back night
  s = fresh(tz);
  s = exchange(s, '2026-10-31T15:00:00Z').state;
  s = exchange(s, '2026-11-01T15:00:00Z').state;
  s = exchange(s, '2026-11-02T15:00:00Z').state;
  assert.equal(s.count, 3);
  assert.equal(s.expiresAt, endOfDay('2026-11-03', tz));
});

test('duplicate message ids and same-day extra messages do not inflate the count', () => {
  let s = fresh();
  const m1 = msg(A, T('2026-06-01T08:00:00Z'));
  s = send(s, m1).state;
  const dup = send(s, m1);
  assert.equal(dup.ignored, 'duplicate');
  s = send(s, msg(B, T('2026-06-01T09:00:00Z'))).state;
  for (let i = 0; i < 10; i++) s = send(s, msg(i % 2 ? A : B, T('2026-06-01T10:00:00Z') + i)).state;
  assert.equal(s.count, 1);
});

test('concurrent / out-of-order / replayed delivery gives the same result', () => {
  const day1 = [msg(A, T('2026-07-01T08:00:00Z')), msg(B, T('2026-07-01T08:00:05Z'))];
  const day2 = [msg(A, T('2026-07-02T08:00:00Z')), msg(B, T('2026-07-02T08:00:01Z'))];
  const now1 = T('2026-07-01T09:00:00Z'), now2 = T('2026-07-02T09:00:00Z');
  const deliver = (s, ms, now) => ms.reduce((st, m) => send(st, m, now).state, s);
  // forward order
  const fwd = deliver(deliver(fresh(), day1, now1), day2, now2);
  // reversed within each day, every message delivered twice (retries / two workers racing)
  const rev = deliver(deliver(fresh(), [...day1].reverse().flatMap((m) => [m, m]), now1), [...day2].reverse().flatMap((m) => [m, m]), now2);
  assert.equal(fwd.count, 2);
  assert.equal(rev.count, 2);
  assert.deepEqual([fwd.count, fwd.longest, fwd.lastMutualDay, fwd.milestones], [rev.count, rev.longest, rev.lastMutualDay, rev.milestones]);
});

test('blocked or removed friendships ignore activity', () => {
  const base = fresh();
  for (const flag of ['blocked', 'removed']) {
    const r = send({ ...base, [flag]: true }, msg(A, T('2026-08-01T08:00:00Z')));
    assert.equal(r.ignored, 'friendship_inactive'); assert.equal(r.changed, false);
  }
  assert.equal(send(base, msg('stranger', T('2026-08-01T08:00:00Z'))).ignored, 'not_a_participant');
});

test('system messages, automated messages, reactions, empty and spam text do not qualify', () => {
  const t = T('2026-08-02T08:00:00Z');
  assert.equal(isQualifying({ kind: 'text', text: 'hi' }), true);
  assert.equal(isQualifying({ kind: 'text', text: 'hi', automated: true }), false);
  assert.equal(isQualifying({ kind: 'text', text: 'hi', system: true }), false);
  assert.equal(isQualifying({ kind: 'reaction', text: '❤️' }), false);
  assert.equal(isQualifying({ kind: 'text', text: '   ' }), false);
  assert.equal(isQualifying({ kind: 'text', text: 'a'.repeat(30) }), false);
  assert.equal(isQualifying({ kind: 'image' }), true);
  assert.equal(isQualifying({ kind: 'video' }), true);
  let r = send(fresh(), msg(A, t, { kind: 'reaction' }));
  assert.equal(r.ignored, 'not_qualifying');
});

test('clients cannot back-date or forge future activity to manipulate counts', () => {
  const now = T('2026-08-10T12:00:00Z');
  let r = send(fresh(), msg(A, T('2026-08-07T12:00:00Z')), now); assert.equal(r.ignored, 'too_old');
  r = send(fresh(), msg(A, now + 5 * 86400e3), now); // claims to be 5 days ahead -> clamped to now
  assert.equal(r.state.day.contributed[A], now);
  // yesterday's one-sided message cannot combine with today's reply from the other friend
  let s = send(fresh(), msg(A, T('2026-08-09T23:00:00Z')), T('2026-08-09T23:00:00Z')).state;
  s = send(s, msg(B, T('2026-08-10T01:00:00Z'))).state;
  assert.equal(s.count, 0);
});

test('milestones fire once at 3, 7, 14, 30, 50, 100, 365 and are saved to history', () => {
  assert.deepEqual(MILESTONES, [3, 7, 14, 30, 50, 100, 365]);
  let s = fresh(); const hit = [];
  for (let d = 0; d < 366; d++) {
    const iso = new Date(T('2026-01-01T10:00:00Z') + d * 86400e3).toISOString();
    const r = exchange(s, iso); s = r.state;
    r.events.filter((e) => e.type === 'milestone').forEach((e) => hit.push(e.days));
  }
  assert.deepEqual(hit, MILESTONES);
  assert.equal(s.milestones.length, 7);
  assert.equal(s.count, 366);
  // replaying today's messages does not re-trigger a milestone
  const again = exchange(s, new Date(T('2026-01-01T10:00:00Z') + 365 * 86400e3).toISOString());
  assert.equal(again.events.filter((e) => e.type === 'milestone').length, 0);
});

test('recovery: eligible within the window, once, restores the previous count', () => {
  let s = fresh();
  for (let d = 1; d <= 9; d++) s = exchange(s, `2026-09-0${d}T10:00:00Z`).state;
  assert.equal(s.count, 9);
  const expiredNow = T('2026-09-12T01:00:00Z'); // missed the 10th and 11th... deadline passed at 09-11T00:00
  const ev = evaluate(s, expiredNow).state;
  assert.equal(ev.status, 'expired');
  assert.equal(ev.recovery.available.previousCount, 9);
  const r = recover(s, A, expiredNow);
  assert.equal(r.ok, true); assert.equal(r.state.count, 9); assert.equal(r.state.status, 'active');
  assert.equal(r.state.recovery.history.length, 1);
  // both friends must still exchange today to continue
  let t = exchange(r.state, '2026-09-12T10:00:00Z').state;
  assert.equal(t.count, 10);
  // second expiry shortly after: recovery is NOT offered again (cooldown)
  const second = evaluate(t, T('2026-09-20T00:00:00Z')).state;
  assert.equal(second.recovery.available, null);
  assert.equal(recover(t, A, T('2026-09-20T00:00:00Z')).ok, false);
});

test('recovery: window closes, strangers and blocked friendships are refused', () => {
  const s = exchange(fresh(), '2026-10-01T10:00:00Z').state;
  const late = T('2026-10-03T00:00:00Z') + DEFAULT_CONFIG.recoveryWindowHours * 3600e3 + 1;
  const r = recover(s, A, late);
  assert.equal(r.ok, false); assert.equal(r.reason, 'window_closed');
  assert.equal(recover(s, 'stranger', T('2026-10-03T01:00:00Z')).reason, 'not_a_participant');
  assert.equal(recover({ ...s, blocked: true }, A, T('2026-10-03T01:00:00Z')).reason, 'friendship_inactive');
});

test('reminders: respect the opt-out, only when at risk, only for the friend who owes, once a day', () => {
  const s = exchange(fresh(), '2026-11-01T10:00:00Z').state;
  const now = T('2026-11-02T21:00:00Z'); // 3h before the deadline
  assert.equal(shouldRemind(s, A, { enabled: true }, now), true);
  assert.equal(shouldRemind(s, A, { enabled: false }, now), false);                 // reminders switched off
  assert.equal(shouldRemind(s, A, { enabled: true }, T('2026-11-02T10:00:00Z')), false); // not yet at risk
  const after = applyActivity(s, msg(A, now), { now }).state;
  assert.equal(shouldRemind(after, A, { enabled: true }, now), false);              // A already contributed
  assert.equal(shouldRemind(after, B, { enabled: true }, now), true);
  const { state: ev } = evaluate(after, now);
  assert.equal(shouldRemind(markReminded(ev, B), B, { enabled: true }, now), false); // never twice in a day
  assert.equal(shouldRemind({ ...s, blocked: true }, A, { enabled: true }, now), false);
});

test('day helpers', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});
