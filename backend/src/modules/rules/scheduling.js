// Couple scheduling rules. Pure functions, no dependencies: the demo service (src/services/coupleService.js)
// and the real server (backend/src/couple/routes.js) both import this file, so the rules cannot drift apart.
// All instants are UTC. Ranges are half-open [start, end): a 6-7pm meetup and a 7-8pm meetup do not overlap.

export const MIN = 60000;
export const SLOT_MIN = 30;
export const ms = (t) => (typeof t === 'number' ? t : new Date(t).getTime());
export const iso = (t) => new Date(ms(t)).toISOString();
const R = (s, e) => ({ start: ms(s), end: ms(e) });

export function validateRange(start, end, { maxHours = 12, now = null } = {}) {
  const s = ms(start), e = ms(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: false, code: 'invalid_time', message: 'Enter a valid start and end time' };
  if (e <= s) return { ok: false, code: 'end_before_start', message: 'End time must be after the start time' };
  if (e - s < 15 * MIN) return { ok: false, code: 'too_short', message: 'Make it at least 15 minutes long' };
  if (e - s > maxHours * 60 * MIN) return { ok: false, code: 'too_long', message: `Keep it under ${maxHours} hours` };
  if (now != null && e <= now) return { ok: false, code: 'in_past', message: 'That time has already passed' };
  return { ok: true };
}

export const overlaps = (a, b) => a.start < b.end && b.start < a.end;

export function mergeRanges(list) {
  const rs = list.map((r) => R(r.start, r.end)).filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export function intersect(a, b) {
  const A = mergeRanges(a), B = mergeRanges(b), out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i].start, B[j].start), e = Math.min(A[i].end, B[j].end);
    if (e > s) out.push({ start: s, end: e });
    if (A[i].end < B[j].end) i++; else j++;
  }
  return out;
}

export function subtract(base, busy) {
  const B = mergeRanges(busy), out = [];
  for (const r of mergeRanges(base)) {
    let cur = r.start;
    for (const b of B) {
      if (b.end <= cur || b.start >= r.end) continue;
      if (b.start > cur) out.push({ start: cur, end: b.start });
      cur = Math.max(cur, b.end);
      if (cur >= r.end) break;
    }
    if (cur < r.end) out.push({ start: cur, end: r.end });
  }
  return out;
}

// Free time for one person inside [from, to]. If they declared "available" blocks that touch the window, only
// that time counts ("I'm only free 6-9pm"); otherwise the whole window counts. Busy time is always removed.
export function userFree({ from, to, available = [], busy = [] }) {
  const win = [R(from, to)];
  const av = mergeRanges(available);
  const declared = av.some((r) => overlaps(r, win[0]));
  const base = declared ? intersect(av, win) : win;
  return subtract(base, busy);
}

// Whole slot-sized cells (aligned to `from`) that are completely inside free time.
export function cells(free, from, to, slotMinutes = SLOT_MIN) {
  const step = slotMinutes * MIN, f = mergeRanges(free), out = [];
  for (let s = ms(from); s + step <= ms(to); s += step) {
    if (f.some((r) => r.start <= s && s + step <= r.end)) out.push({ start: s, end: s + step });
  }
  return out;
}

const outRanges = (rs) => rs.map((r) => ({ start: iso(r.start), end: iso(r.end) }));

// Both partners' free time and the time they share. Returns ISO strings (JSON-ready).
// `notBefore` removes time that has already passed (today's earlier hours) without changing which "available" declarations apply.
export function mutualAvailability({ from, to, slotMinutes = SLOT_MIN, notBefore = null, me, partner }) {
  const past = notBefore != null && ms(notBefore) > ms(from) ? [{ start: ms(from), end: ms(notBefore) }] : [];
  const a = subtract(userFree({ from, to, ...me }), past), b = subtract(userFree({ from, to, ...partner }), past);
  const mutual = intersect(a, b);
  return { me: outRanges(a), partner: outRanges(b), mutual: outRanges(mutual), slots: outRanges(cells(mutual, from, to, slotMinutes)) };
}

// ---- busy time per user, from appointments + availability rows ----
// A user is busy for: shared meetups, their own private commitments, and their own "busy" blocks.
// Another person's private commitments are never visible to them or used as detail (only as busy time on the server).
const active = (a, ignoreId) => a.status === 'confirmed' && a.id !== ignoreId;

export function busyFor(userId, { appointments = [], availability = [], ignoreId = null }) {
  const fromAppts = appointments.filter((a) => active(a, ignoreId) && (a.visibility === 'shared' || a.created_by === userId)).map((a) => R(a.start_time, a.end_time));
  const fromBlocks = availability.filter((b) => b.user_id === userId && b.availability_type === 'busy').map((b) => R(b.start_time, b.end_time));
  return [...fromAppts, ...fromBlocks];
}
export const availableFor = (userId, availability = []) => availability.filter((b) => b.user_id === userId && b.availability_type === 'available').map((b) => R(b.start_time, b.end_time));

const fits = (free, r) => free.some((f) => f.start <= r.start && r.end <= f.end);

// Can a shared meetup take place at `range`? `window` is the local-day window used to decide which "available" blocks apply.
export function checkBooking({ range, window, users, appointments, availability, ignoreId = null }) {
  const r = R(range.start, range.end);
  const clash = appointments.find((a) => active(a, ignoreId) && a.visibility === 'shared' && overlaps(r, R(a.start_time, a.end_time)));
  if (clash) return { ok: false, code: 'overlap', message: 'You already have a meetup at that time', conflictId: clash.id };
  const win = window ? R(window.start, window.end) : { start: r.start, end: r.end };
  for (const uid of users) {
    const free = userFree({ from: win.start, to: win.end, available: availableFor(uid, availability), busy: busyFor(uid, { appointments, availability, ignoreId }) });
    if (!fits(free, r)) return { ok: false, code: 'not_mutually_free', message: 'You are not both free at that time', userId: uid };
  }
  return { ok: true };
}

// A private commitment only has to avoid the creator's own appointments.
export function checkPersonal({ range, userId, appointments, ignoreId = null }) {
  const r = R(range.start, range.end);
  const clash = appointments.find((a) => active(a, ignoreId) && (a.visibility === 'shared' || a.created_by === userId) && overlaps(r, R(a.start_time, a.end_time)));
  return clash ? { ok: false, code: 'overlap', message: 'That overlaps another appointment of yours', conflictId: clash.id } : { ok: true };
}

// What a given viewer is allowed to see of an appointment row. Private ones are invisible to the partner; notes only to the author.
export function viewAppointment(a, viewerId) {
  if (a.visibility === 'private' && a.created_by !== viewerId) return null;
  const { notes, ...rest } = a;
  return a.created_by === viewerId ? { ...rest, notes } : rest;
}

// "Name: Location" - the only text the lists and the calendar show.
export const apptLabel = (a) => (a.location?.trim() ? `${a.title}: ${a.location.trim()}` : a.title);
