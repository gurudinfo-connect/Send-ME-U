import test from 'node:test';
import assert from 'node:assert/strict';
import { streakService, streakBus } from '../src/services/streakService.js';

const DAY = 864e5;
test.beforeEach(() => streakService.reset());

test('seed: active, pending and recoverable streaks are listed', () => {
  const items = streakService.list();
  const by = Object.fromEntries(items.map((s) => [s.friendshipId, s]));
  assert.equal(by.c1.count, 12); assert.equal(by.c1.them, true); assert.equal(by.c1.me, false);
  assert.equal(by.c2.count, 3);
  assert.equal(by.c5.count, 0); assert.equal(by.c5.status, 'expired'); assert.equal(by.c5.recovery.previousCount, 21);
});

test('my message completes the day, increments the streak and broadcasts to both friends', () => {
  const seen = [];
  streakBus.addEventListener('streak:update', (e) => seen.push(e.detail));
  const r = streakService.record('c1', { id: 'a1', userId: 'u0', kind: 'text', text: 'hi' });
  assert.equal(r.summary.count, 13);
  assert.ok(r.events.some((e) => e.type === 'incremented'));
  assert.equal(seen.at(-1).summary.count, 13);
  // duplicate delivery of the same message id does nothing
  assert.equal(streakService.record('c1', { id: 'a1', userId: 'u0', kind: 'text', text: 'hi' }).ignored, 'duplicate');
  assert.equal(streakService.get('c1').count, 13);
});

test('crossing a milestone: today completes Priya at 13, tomorrow reaches 14 and unlocks the badge', () => {
  streakService.record('c2', { id: 'b1', userId: 'u0', kind: 'text', text: 'yo' });
  assert.equal(streakService.record('c2', { id: 'b2', userId: 'u2', kind: 'image' }).summary.count, 4);
  streakService.record('c1', { id: 'p0', userId: 'u0', kind: 'text', text: 'today' });
  assert.equal(streakService.get('c1').count, 13);
  const t1 = Date.now() + DAY;
  streakService.record('c1', { id: 'p1', userId: 'u0', kind: 'text', text: 'a' }, t1 - 1000);
  const m = streakService.record('c1', { id: 'p2', userId: 'u1', kind: 'text', text: 'b' }, t1);
  assert.equal(m.summary.count, 14);
  assert.ok(m.events.some((e) => e.type === 'milestone' && e.days === 14));
  assert.ok(m.summary.milestones.some((x) => x.days === 14));
});

test('recovery is free, once, and visible only while eligible', () => {
  const before = streakService.get('c5');
  assert.equal(before.recovery.previousCount, 21);
  const r = streakService.recover('c5');
  assert.equal(r.ok, true); assert.equal(r.summary.count, 21);
  assert.equal(streakService.recover('c5').ok, false);
});

test('blocking a friend stops streak activity and hides the streak; reminder prefs persist independently', () => {
  streakService.setFlags('c1', { blocked: true });
  assert.equal(streakService.list().some((s) => s.friendshipId === 'c1'), false);
  assert.equal(streakService.record('c1', { id: 'z1', userId: 'u0', kind: 'text', text: 'x' }).ignored, 'friendship_inactive');
  streakService.setFlags('c1', { blocked: false });
  assert.equal(streakService.list().some((s) => s.friendshipId === 'c1'), true);
  assert.equal(streakService.prefs().enabled, true);
  streakService.setPrefs({ enabled: false });
  assert.equal(streakService.prefs().enabled, false);
  assert.equal(streakService.dueReminders(Date.now() + 40 * 36e5).length, 0); // disabled: never nudged
});
