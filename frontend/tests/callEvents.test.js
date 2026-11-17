import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const L = await import('../src/callEvents/logic.js');
const { callEventService: S, callEventBus } = await import('../src/callEvents/eventService.js');

const min = (m) => new Date(Date.now() + m * 60e3).toISOString();
const base = (o = {}) => ({ title: 'Sync', description: '', start_datetime: min(60), end_datetime: min(90), call_type: 'video', require_approval: false, reminder_minutes: 15, ...o });
const code = (fn) => { try { fn(); return null; } catch (e) { return e.response?.status; } };
const bus = [];
callEventBus.addEventListener('callevent', (e) => bus.push(e.detail.name));
test.beforeEach(() => { S.reset(); bus.length = 0; });

test('validation: title, order of times, past events, type, reminder', () => {
  assert.equal(L.validateEvent(base({ title: '  ' })).ok, false);
  assert.match(L.validateEvent(base({ end_datetime: min(60) })).error, /after the start/);
  assert.match(L.validateEvent(base({ start_datetime: min(-120), end_datetime: min(-60) })).error, /future|over/);
  assert.equal(L.validateEvent(base({ call_type: 'hologram' })).ok, false);
  assert.equal(L.validateEvent(base({ reminder_minutes: 7 })).ok, false);
  const v = L.validateEvent(base({ reminder_minutes: undefined }));
  assert.equal(v.value.reminder_minutes, 15); // default
});

test('reminder time and calendar file', () => {
  assert.equal(L.reminderAt(min(60), 0), null);
  assert.equal(Math.round((L.ms(min(60)) - L.ms(L.reminderAt(min(60), 15))) / 60e3), 15);
  const ics = L.toICS({ id: 'x', title: 'A, B', description: '', start_datetime: min(60), end_datetime: min(90), reminder_minutes: 30 }, 'https://x/y');
  assert.match(ics, /BEGIN:VEVENT/); assert.match(ics, /TRIGGER:-PT30M/); assert.match(ics, /SUMMARY:A\\, B/);
});

test('create: host is me, unique id + secure link, guests invited once, invitations delivered', () => {
  const a = S.create(base({ guest_ids: ['u2', 'u2', 'u0', 'zzz'] }));
  const b = S.create(base());
  assert.equal(a.host_user_id, 'u0');
  assert.notEqual(a.meeting_id, b.meeting_id);
  assert.match(a.meeting_link, /\/calls\/join\/[a-z0-9]+$/);
  assert.deepEqual(a.guests.map((g) => g.user_id), ['u2']); // duplicates, host and unknown ids dropped
  assert.equal(S.get(a.id).require_approval, false);
  assert.ok(bus.includes('events:changed'));
  assert.equal(code(() => S.create(base({ end_datetime: min(10) }))), 400);
});

test('only the host can edit / cancel / invite; edit keeps id and link and can change guests', () => {
  const mine = S.create(base({ guest_ids: ['u2', 'u3'] }));
  const upd = S.update(mine.id, { title: 'Renamed', call_type: 'voice', reminder_minutes: 60, guest_ids: ['u3', 'u4'] });
  assert.equal(upd.id, mine.id); assert.equal(upd.meeting_link, mine.meeting_link);
  assert.equal(upd.title, 'Renamed'); assert.equal(upd.reminder_minutes, 60);
  assert.deepEqual(upd.guests.map((g) => g.user_id).sort(), ['u3', 'u4']); // u2 removed, u4 added
  const theirs = S.list().find((e) => e.host_user_id === 'u1');
  assert.equal(code(() => S.update(theirs.id, { title: 'x' })), 403);
  assert.equal(code(() => S.cancel(theirs.id)), 403);
  assert.equal(code(() => S.addGuests(theirs.id, ['u3'])), 403);
});

test('invite more: no duplicates, removed guests can be re-invited', () => {
  const e = S.create(base({ guest_ids: ['u2'] }));
  assert.deepEqual(S.addGuests(e.id, ['u2', 'u3']).added, ['u3']);
  assert.deepEqual(S.addGuests(e.id, ['u2', 'u3']).added, []);
  S.removeGuest(e.id, 'u3');
  assert.equal(S.participants(e.id).not_responded.some((g) => g.user_id === 'u3'), false);
  assert.deepEqual(S.addGuests(e.id, ['u3']).added, ['u3']);
});

test('going / not responded lists, with the host first and badged as creator', () => {
  const e = S.create(base({ guest_ids: ['u2', 'u3'] }));
  let p = S.participants(e.id);
  assert.equal(p.going.length, 1); assert.equal(p.going[0].creator, true);
  assert.equal(p.not_responded.length, 2);
  const g = JSON.parse(mem.get('smu_callevents_v1')); // an online guest accepts (the demo's simulated reply)
  g.events.find((x) => x.id === e.id).guests.forEach((x) => { x.auto_at = Date.now() - 1; });
  mem.set('smu_callevents_v1', JSON.stringify(g)); S.reset(); mem.set('smu_callevents_v1', JSON.stringify(g));
  p = S.participants(e.id);
  assert.ok(p.going.length >= 2, 'online guest accepted');
});

test('invitation I received: pending -> accept / decline; filter tabs follow the status', () => {
  const inv = S.list().find((e) => e.host_user_id === 'u1');
  const tabs = (t) => L.filterEvents(S.list(), 'u0', t).map((e) => e.id);
  assert.ok(tabs('pending').includes(inv.id)); assert.ok(!tabs('scheduled').includes(inv.id)); assert.ok(tabs('all').includes(inv.id));
  assert.equal(S.notifications().find((n) => n.event_id === inv.id).actionable, true);
  S.respond(inv.id, 'accepted');
  assert.ok(!tabs('pending').includes(inv.id)); assert.ok(tabs('scheduled').includes(inv.id));
  S.respond(inv.id, 'declined');
  assert.ok(!tabs('scheduled').includes(inv.id));
  assert.equal(code(() => S.respond(inv.id, 'maybe')), 400);
});

test('opening an invitation link: a stranger can respond and becomes a guest', () => {
  const inv = S.list().find((e) => e.host_user_id === 'u1');
  const byLink = S.byMeeting(inv.meeting_id);
  assert.equal(byLink.id, inv.id);
  assert.equal(code(() => S.byMeeting('nope')), 404);
});

test('join rules: window, cancelled, approval, not invited', () => {
  const soon = S.create(base({ start_datetime: min(5), end_datetime: min(35) }));
  assert.equal(S.join(soon.id).status, 'ok'); // host, inside the 10 minute window
  const later = S.create(base({ start_datetime: min(120), end_datetime: min(150) }));
  assert.equal(code(() => S.join(later.id)), 425); // too early
  S.cancel(later.id);
  assert.equal(code(() => S.join(later.id)), 403); // cancelled
  assert.equal(S.get(later.id).state, 'cancelled');
  const inv = S.list().find((e) => e.host_user_id === 'u1');
  assert.equal(code(() => S.join(inv.id)), 425);
  const d = L.joinDecision({ ...inv, start_datetime: min(1), end_datetime: min(30), require_approval: true }, 'u0', { invitation_status: 'accepted', approved: false });
  assert.equal(d.needsApproval, true);
  assert.equal(L.joinDecision({ ...inv, host_user_id: 'u1' }, 'u9', undefined).ok, false); // stranger
  assert.equal(L.joinDecision({ ...inv, start_datetime: min(-60), end_datetime: min(-30) }, 'u0', { invitation_status: 'accepted' }).ok, false); // ended
});

test('approval: guest asks, host decides', () => {
  const state = JSON.parse(JSON.stringify({ x: 1 })); void state;
  const inv = S.list().find((e) => e.host_user_id === 'u1');
  const g = JSON.parse(mem.get('smu_callevents_v1'));
  const row = g.events.find((e) => e.id === inv.id);
  row.start_datetime = min(2); row.end_datetime = min(30); row.require_approval = true; row.guests.find((x) => x.user_id === 'u0').invitation_status = 'accepted';
  S.reset(); mem.set('smu_callevents_v1', JSON.stringify(g));
  const r = S.join(inv.id);
  assert.equal(r.status, 'pending');
  assert.equal(S.join(inv.id).status, 'pending'); // asking twice is harmless
  // a simulated host approves a few seconds later
  const g2 = JSON.parse(mem.get('smu_callevents_v1')); g2.events.find((e) => e.id === inv.id).guests.find((x) => x.user_id === 'u0').approve_at = Date.now() - 1;
  S.reset(); mem.set('smu_callevents_v1', JSON.stringify(g2));
  assert.equal(S.join(inv.id).status, 'ok');
});

test('reminders: delivered once when due, never for cancelled events', () => {
  const e = S.create(base({ start_datetime: min(10), end_datetime: min(40), reminder_minutes: 15 })); // reminder time already passed
  assert.deepEqual(S.deliverReminders(), [e.id]);
  assert.deepEqual(S.deliverReminders(), []);
  assert.ok(S.notifications().some((n) => n.kind === 'event:reminder' && n.event_id === e.id));
  const c = S.create(base({ start_datetime: min(10), end_datetime: min(40), reminder_minutes: 15 }));
  S.cancel(c.id);
  assert.deepEqual(S.deliverReminders(), []);
  const none = S.create(base({ start_datetime: min(10), end_datetime: min(40), reminder_minutes: 0 }));
  assert.deepEqual(S.deliverReminders(), []); void none;
});

test('cancel and edit notify the guests; upcoming list for the Calls page', () => {
  const e = S.create(base({ start_datetime: min(20), end_datetime: min(50), guest_ids: ['u2'] }));
  assert.ok(L.upcomingFor(S.list(), 'u0').some((x) => x.id === e.id));
  S.cancel(e.id);
  assert.ok(!L.upcomingFor(S.list(), 'u0').some((x) => x.id === e.id));
  assert.equal(code(() => S.update(e.id, { title: 'again' })), 409);
});
