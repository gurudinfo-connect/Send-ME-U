import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { coupleService: S, coupleBus, ME, PARTNER } = await import('../src/services/coupleService.js');

const H = 3600e3;
const day = (offset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const code = (fn) => { try { fn(); return null; } catch (e) { return e.response?.data?.code; } };
const events = [];
coupleBus.addEventListener('couple:event', (e) => events.push(e.detail.name));
test.beforeEach(() => { S.reset(); events.length = 0; });

test('seed: partner private commitments are never visible to me; labels are Name: Location', () => {
  const list = S.appointments({ from: day(0, 0), to: day(10, 0) });
  assert.equal(list.some((a) => a.visibility === 'private'), false);
  assert.ok(list.find((a) => a.title === 'Coffee Date' && a.location === 'Third Wave Coffee, Indiranagar'));
});

test('book a meetup: appears for both, partner is notified', () => {
  const a = S.createAppointment({ title: 'Dinner', location: 'MG Road', start_time: day(5, 19), end_time: day(5, 21) });
  assert.equal(a.created_by, ME);
  const seenByPartner = S.appointments({ from: day(5, 0), to: day(6, 0) }, PARTNER);
  assert.equal(seenByPartner.length, 1);
  assert.equal('notes' in seenByPartner[0], false);
  assert.ok(S.notifications(PARTNER).some((n) => n.text === 'Mr_Dgs booked Dinner: MG Road'));
  assert.ok(events.includes('appointment:created'));
});

test('no double booking: overlap rejected, back-to-back allowed, second attempt loses', () => {
  S.createAppointment({ title: 'Dinner', location: 'MG Road', start_time: day(5, 19), end_time: day(5, 21) });
  assert.equal(code(() => S.createAppointment({ title: 'Movie', location: 'PVR', start_time: day(5, 20), end_time: day(5, 22) })), 'overlap');
  assert.equal(code(() => S.createAppointment({ title: 'Drinks', location: 'Toit', start_time: day(5, 21), end_time: day(5, 22) }, PARTNER)), null);
  assert.equal(code(() => S.createAppointment({ title: 'Walk', location: 'Lalbagh', start_time: day(5, 21), end_time: day(5, 22) }, PARTNER)), 'overlap');
});

test("cannot book over the partner's busy time or private commitment", () => {
  assert.equal(code(() => S.createAppointment({ title: 'Brunch', location: 'X', start_time: day(2, 11), end_time: day(2, 12) })), 'not_mutually_free');
  assert.equal(code(() => S.createAppointment({ title: 'Lunch', location: 'X', start_time: day(1, 10), end_time: day(1, 11) })), 'not_mutually_free');
});

test('validation: past, order, missing location/title', () => {
  assert.equal(code(() => S.createAppointment({ title: 'Old', location: 'X', start_time: day(-2, 10), end_time: day(-2, 11) })), 'in_past');
  assert.equal(code(() => S.createAppointment({ title: 'Bad', location: 'X', start_time: day(5, 12), end_time: day(5, 11) })), 'end_before_start');
  assert.equal(code(() => S.createAppointment({ title: 'No place', location: ' ', start_time: day(5, 12), end_time: day(5, 13) })), 'location_required');
  assert.equal(code(() => S.createAppointment({ title: ' ', location: 'X', start_time: day(5, 12), end_time: day(5, 13) })), 'title_required');
});

test('edit, reschedule (ignores itself), stale edit rejected, cancel frees the slot', () => {
  const a = S.createAppointment({ title: 'Dinner', location: 'MG Road', start_time: day(5, 19), end_time: day(5, 21) });
  const moved = S.updateAppointment(a.id, { start_time: day(5, 20), end_time: day(5, 22), rev: a.rev });
  assert.equal(moved.rev, 2);
  assert.equal(code(() => S.updateAppointment(a.id, { title: 'Late', rev: 1 })), 'stale');
  assert.ok(S.notifications(PARTNER).some((n) => n.text.startsWith('Mr_Dgs changed Dinner')));
  S.cancelAppointment(a.id);
  assert.equal(S.appointments({ from: day(5, 0), to: day(6, 0) }).length, 0);
  assert.ok(S.notifications(PARTNER).some((n) => n.text.startsWith('Mr_Dgs cancelled')));
  assert.equal(code(() => S.createAppointment({ title: 'Again', location: 'X', start_time: day(5, 19), end_time: day(5, 21) })), null);
});

test('private commitment: partner never sees it, but it blocks my own time', () => {
  const p = S.createAppointment({ title: 'Dentist', visibility: 'private', start_time: day(6, 10), end_time: day(6, 11), notes: 'x' });
  assert.equal(S.appointments({ from: day(6, 0), to: day(7, 0) }, PARTNER).length, 0);
  assert.equal(S.notifications(PARTNER).some((n) => n.text.includes('Dentist')), false);
  assert.equal(code(() => S.createAppointment({ title: 'Brunch', location: 'X', start_time: day(6, 10), end_time: day(6, 11) })), 'not_mutually_free');
  assert.equal(code(() => S.updateAppointment(p.id, { title: 'hack' }, PARTNER)), 'not_found');
});

test('mutual slots reflect both people', () => {
  const r = S.slots({ from: day(0, 7), to: day(0, 23) });
  const mutual = r.mutual[0];
  assert.ok(r.mutual.length >= 1 && new Date(r.mutual[0].start).getHours() >= 7);
  // partner is busy 09:00-13:00 today, so no mutual slot starts inside that window
  assert.equal(r.slots.some((s) => { const h = new Date(s.start).getHours(); return h >= 9 && h < 13; }), false);
  assert.ok(mutual);
  S.addAvailability({ availability_type: 'busy', start_time: day(0, 18), end_time: day(0, 20) });
  const r2 = S.slots({ from: day(0, 7), to: day(0, 23) });
  assert.equal(r2.slots.some((s) => { const h = new Date(s.start).getHours(); return h >= 18 && h < 20; }), false);
  assert.equal(r2.me.some((x) => new Date(x.start).getHours() === 18), false);
});

test('availability: only own blocks, validated', () => {
  assert.equal(code(() => S.addAvailability({ availability_type: 'maybe', start_time: day(1, 9), end_time: day(1, 10) })), 'bad_type');
  const b = S.addAvailability({ availability_type: 'available', start_time: day(1, 18), end_time: day(1, 21) });
  assert.equal(S.availability({}, PARTNER).some((x) => x.id === b.id), false);
  assert.equal(code(() => S.updateAvailability(b.id, { end_time: day(1, 22) }, PARTNER)), 'not_found');
  S.deleteAvailability(b.id);
  assert.equal(S.availability({}).some((x) => x.id === b.id), false);
});

test('location: never on by default; consent, push, stop deletes the position', () => {
  assert.equal(S.locationState().session, null);
  assert.equal(code(() => S.pushLocation({ latitude: 12.97, longitude: 77.6, accuracy: 10 })), 'not_sharing');
  assert.equal(code(() => S.startLocation({ duration: 'forever' })), 'bad_duration');
  S.startLocation({ duration: '15m' });
  assert.equal(code(() => S.pushLocation({ latitude: 200, longitude: 0 })), 'bad_coords');
  S.pushLocation({ latitude: 12.97, longitude: 77.6, accuracy: 10 });
  assert.equal(S.locationState().me.latitude, 12.97);
  assert.equal(S.locationState(PARTNER).partner.latitude, 12.97); // partner can see it while active
  assert.ok(S.notifications(PARTNER).some((n) => n.text.includes('sharing a live location')));
  S.stopLocation();
  assert.equal(S.locationState().me, null);
  assert.equal(S.locationState(PARTNER).partner, null);          // nothing left to see
  assert.equal(S.locationState(PARTNER).partnerSharing, false);
});

test('location: sessions expire on their own and stale fixes are flagged, not shown as live', () => {
  S.startLocation({ duration: '15m' });
  S.pushLocation({ latitude: 12.97, longitude: 77.6, accuracy: 10 });
  const real = Date.now;
  try {
    Date.now = () => real() + 6 * 60e3;
    assert.equal(S.locationState(PARTNER).partner.freshness, 'stale');   // still inside the session: last known, not live
    Date.now = () => real() + 16 * 60e3;
    assert.equal(S.locationState(PARTNER).partner, null);               // expired: hidden
    assert.equal(S.locationState().session, null);
    assert.equal(code(() => S.pushLocation({ latitude: 12.97, longitude: 77.6 })), 'not_sharing');
  } finally { Date.now = real; }
});

test('location request has a cooldown and only notifies', () => {
  S.requestLocation();
  assert.equal(S.locationState().session, null); // asking never switches anything on
  assert.equal(code(() => S.requestLocation()), 'too_soon');
});
