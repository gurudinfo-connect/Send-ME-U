import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRange, overlaps, mergeRanges, intersect, subtract, userFree, cells, mutualAvailability, checkBooking, checkPersonal, busyFor, viewAppointment, apptLabel } from '../src/couple/scheduling.js';

const H = 3600e3, D0 = Date.UTC(2026, 10, 10, 0, 0); // arbitrary day, UTC
const at = (h, m = 0) => D0 + h * H + m * 60e3;
const r = (a, b) => ({ start: at(a), end: at(b) });
const appt = (id, by, vis, a, b, status = 'confirmed') => ({ id, created_by: by, visibility: vis, start_time: new Date(at(a)).toISOString(), end_time: new Date(at(b)).toISOString(), status });
const blk = (uid, type, a, b) => ({ user_id: uid, availability_type: type, start_time: new Date(at(a)).toISOString(), end_time: new Date(at(b)).toISOString() });

test('validateRange', () => {
  assert.equal(validateRange(at(9), at(10)).ok, true);
  assert.equal(validateRange(at(10), at(9)).code, 'end_before_start');
  assert.equal(validateRange(at(9), at(9, 10)).code, 'too_short');
  assert.equal(validateRange(at(1), at(20)).code, 'too_long');
  assert.equal(validateRange(at(9), at(10), { now: at(11) }).code, 'in_past');
  assert.equal(validateRange('x', at(10)).code, 'invalid_time');
});

test('half-open ranges: back-to-back is not an overlap', () => {
  assert.equal(overlaps(r(9, 10), r(10, 11)), false);
  assert.equal(overlaps(r(9, 10, 0), r(9, 11)), true);
});

test('merge / intersect / subtract', () => {
  assert.deepEqual(mergeRanges([r(9, 10), r(10, 11), r(13, 14), r(9, 9.5)]), [r(9, 11), r(13, 14)]);
  assert.deepEqual(intersect([r(9, 12)], [r(11, 15)]), [r(11, 12)]);
  assert.deepEqual(subtract([r(9, 18)], [r(10, 11), r(12, 13)]), [r(9, 10), r(11, 12), r(13, 18)]);
  assert.deepEqual(subtract([r(9, 10)], [r(8, 11)]), []);
});

test('userFree: default window minus busy; declared availability narrows it', () => {
  assert.deepEqual(userFree({ from: at(8), to: at(20), busy: [r(12, 13)] }), [r(8, 12), r(13, 20)]);
  assert.deepEqual(userFree({ from: at(8), to: at(20), available: [r(18, 21)], busy: [r(19, 19.5)] }), [{ start: at(18), end: at(19) }, { start: at(19, 30), end: at(20) }]);
  // availability on another day does not narrow this one
  assert.deepEqual(userFree({ from: at(8), to: at(20), available: [r(30, 33)] }), [r(8, 20)]);
});

test('cells are whole free slots', () => {
  const c = cells([r(9, 10.5)], at(8), at(12));
  assert.equal(c.length, 3);
  assert.equal(c[0].start, at(9));
  assert.equal(cells([{ start: at(9, 15), end: at(10, 15) }], at(8), at(12)).length, 1);
});

test('mutualAvailability intersects both people and returns ISO', () => {
  const m = mutualAvailability({ from: at(8), to: at(22), me: { busy: [r(8, 12)] }, partner: { available: [r(18, 21)] } });
  assert.deepEqual(m.mutual, [{ start: new Date(at(18)).toISOString(), end: new Date(at(21)).toISOString() }]);
  assert.equal(m.slots.length, 6);
  assert.equal(m.partner.length, 1);
});

test('checkBooking: overlap, partner busy, private commitment, availability', () => {
  const users = ['a', 'b'], window = r(8, 22);
  const appointments = [appt(1, 'a', 'shared', 18, 19), appt(2, 'b', 'private', 20, 21), appt(3, 'a', 'shared', 9, 10, 'cancelled')];
  const availability = [blk('b', 'busy', 14, 15)];
  const base = { users, window, appointments, availability };
  assert.equal(checkBooking({ ...base, range: r(18.5, 19.5) }).code, 'overlap');
  assert.equal(checkBooking({ ...base, range: r(19, 20) }).ok, true);                // back-to-back is fine
  assert.equal(checkBooking({ ...base, range: r(20.5, 21.5) }).code, 'not_mutually_free'); // partner's private commitment
  assert.equal(checkBooking({ ...base, range: r(14, 15) }).code, 'not_mutually_free');     // partner's busy block
  assert.equal(checkBooking({ ...base, range: r(9, 10) }).ok, true);                  // cancelled appointment frees the time
  assert.equal(checkBooking({ ...base, range: r(11, 12), availability: [blk('b', 'available', 16, 18)] }).code, 'not_mutually_free');
  assert.equal(checkBooking({ ...base, range: r(16, 17), availability: [blk('b', 'available', 16, 18)] }).ok, true);
  assert.equal(checkBooking({ ...base, range: r(18.5, 19.5), ignoreId: 1 }).ok, true);     // moving an appointment ignores itself
});

test('checkPersonal only looks at the creator', () => {
  const appointments = [appt(1, 'a', 'private', 10, 11), appt(2, 'b', 'private', 10, 11), appt(3, 'b', 'shared', 15, 16)];
  assert.equal(checkPersonal({ range: r(10, 11), userId: 'a', appointments }).code, 'overlap');
  assert.equal(checkPersonal({ range: r(10, 11), userId: 'c', appointments }).ok, true);
  assert.equal(checkPersonal({ range: r(15, 16), userId: 'a', appointments }).code, 'overlap'); // shared meetup counts for both
});

test('privacy: private rows are invisible to the partner; notes only for the author', () => {
  const p = { ...appt(1, 'a', 'private', 10, 11), title: 'Doctor', notes: 'x' };
  const s = { ...appt(2, 'a', 'shared', 12, 13), title: 'Coffee Date', location: 'Third Wave Coffee, Indiranagar', notes: 'bring umbrella' };
  assert.equal(viewAppointment(p, 'b'), null);
  assert.equal(viewAppointment(p, 'a').notes, 'x');
  assert.equal('notes' in viewAppointment(s, 'b'), false);
  assert.equal(viewAppointment(s, 'a').notes, 'bring umbrella');
  assert.equal(apptLabel(s), 'Coffee Date: Third Wave Coffee, Indiranagar');
  assert.equal(apptLabel({ title: 'Call', location: ' ' }), 'Call');
  assert.equal(busyFor('b', { appointments: [p, s] }).length, 1); // a's private row is not b's busy time
});

test('notBefore drops the past but keeps the declared-availability logic', () => {
  const m = mutualAvailability({ from: at(8), to: at(20), notBefore: at(14), me: {}, partner: { available: [r(9, 11), r(16, 18)] } });
  assert.deepEqual(m.mutual, [{ start: new Date(at(16)).toISOString(), end: new Date(at(18)).toISOString() }]);
  assert.equal(m.slots.length, 4);
  assert.equal(mutualAvailability({ from: at(8), to: at(20), notBefore: at(25), me: {}, partner: {} }).slots.length, 0);
});
