// Demo "server" for Couple Calendar, shared availability and live location (used when VITE_USE_MOCK=true).
// It enforces the same rules the real server does, by calling the shared modules in ../couple/, and it announces
// every change on `coupleBus` exactly like the Socket.IO events in backend/src/couple/sockets.js.
// Two accounts exist in the demo: me (u0) and my partner (u1). State persists in this browser only.
import { validateRange, checkBooking, checkPersonal, mutualAvailability, busyFor, availableFor, viewAppointment, apptLabel, iso, ms } from '../couple/scheduling.js';
import { expiryFor, sessionActive, visibleLocation, validCoords } from '../couple/location.js';

export const coupleBus = new EventTarget();
const KEY = 'smu_couple_v1';
export const ME = 'u0', PARTNER = 'u1', COUPLE = 'cp1';
const NAMES = { u0: 'Mr_Dgs', u1: 'Priya' };
const other = (u) => (u === ME ? PARTNER : ME);
const MAX_NOTIFS = 50;
const REQUEST_COOLDOWN_MS = 10 * 60e3;

const fail = (status, code, message) => { throw Object.assign(new Error(message), { response: { status, data: { code, message } } }); };
const emit = (name, payload = {}) => coupleBus.dispatchEvent(new CustomEvent('couple:event', { detail: { name, payload } }));

let mem = null;
const store = () => { try { return globalThis.localStorage; } catch { return null; } };
const save = () => { try { store()?.setItem(KEY, JSON.stringify(mem)); } catch { /* storage unavailable: keep in memory */ } };
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(store()?.getItem(KEY) || 'null'); } catch { mem = null; }
  if (!mem) { mem = seed(); save(); }
  return mem;
}

const localAt = (dayOffset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.toISOString(); };
function seed() {
  const now = new Date().toISOString();
  const row = (id, by, vis, title, location, a, b) => ({ id, couple_id: COUPLE, created_by: by, title, location, start_time: a, end_time: b, notes: '', visibility: vis, status: 'confirmed', rev: 1, created_at: now, updated_at: now });
  return {
    seq: 10,
    appointments: [
      row('a1', ME, 'shared', 'Coffee Date', 'Third Wave Coffee, Indiranagar', localAt(3, 17), localAt(3, 18, 30)),
      row('a2', PARTNER, 'shared', 'Evening Walk', 'Cubbon Park', localAt(1, 18), localAt(1, 19)),
      row('a3', PARTNER, 'private', 'Private commitment', '', localAt(2, 11), localAt(2, 12)), // never shown to me
    ],
    availability: [
      { id: 'v1', user_id: PARTNER, couple_id: COUPLE, availability_type: 'busy', start_time: localAt(0, 9), end_time: localAt(0, 13), created_at: now, updated_at: now },
      { id: 'v2', user_id: PARTNER, couple_id: COUPLE, availability_type: 'busy', start_time: localAt(1, 9), end_time: localAt(1, 12), created_at: now, updated_at: now },
    ],
    sessions: { [ME]: null, [PARTNER]: null },
    locations: { [ME]: null, [PARTNER]: null },
    notifications: [],
    lastRequest: {},
    demoPartnerOptOut: false,
  };
}

function notify(userId, text, kind = 'couple') {
  const m = load();
  m.notifications.unshift({ id: `n${m.seq++}`, user_id: userId, text, kind, created_at: new Date().toISOString() });
  m.notifications.length = Math.min(m.notifications.length, MAX_NOTIFS);
  if (userId === ME) emit('notification:new', { text, kind });
}

const dayWindow = (startIso) => { const d = new Date(startIso); const a = new Date(d); a.setHours(0, 0, 0, 0); const b = new Date(a); b.setDate(b.getDate() + 1); return { start: a.getTime(), end: b.getTime() }; };
const clean = (s, max) => String(s ?? '').trim().slice(0, max);

// ---------- appointments ----------
function checkFields(actor, b, { partial = false, existing = null } = {}) {
  const visibility = b.visibility ? (b.visibility === 'private' ? 'private' : 'shared') : existing?.visibility || 'shared';
  const title = b.title !== undefined || !partial ? clean(b.title, 80) : existing.title;
  const location = b.location !== undefined || !partial ? clean(b.location, 120) : existing.location;
  if (!title) fail(400, 'title_required', 'Give it a name');
  if (visibility === 'shared' && !location) fail(400, 'location_required', 'Add a location so your partner knows where');
  return { visibility, title, location };
}

function apply(actor, b, existing = null) {
  const m = load();
  const f = checkFields(actor, b, { partial: !!existing, existing });
  const start_time = b.start_time ?? existing?.start_time, end_time = b.end_time ?? existing?.end_time;
  const v = validateRange(start_time, end_time, { now: Date.now() });
  if (!v.ok) fail(422, v.code, v.message);
  const range = { start: ms(start_time), end: ms(end_time) };
  const ctx = { appointments: m.appointments, availability: m.availability, ignoreId: existing?.id ?? null };
  const res = f.visibility === 'shared'
    ? checkBooking({ range, window: b.window ? { start: ms(b.window.start), end: ms(b.window.end) } : dayWindow(start_time), users: [ME, PARTNER], ...ctx })
    : checkPersonal({ range, userId: existing?.created_by ?? actor, ...ctx });
  if (!res.ok) fail(409, res.code, res.message);
  return { ...f, start_time: iso(start_time), end_time: iso(end_time) };
}

export const coupleService = {
  appointments({ from, to } = {}, viewer = ME) {
    const f = from ? ms(from) : -Infinity, t = to ? ms(to) : Infinity;
    return load().appointments
      .filter((a) => a.status === 'confirmed' && ms(a.start_time) < t && ms(a.end_time) > f)
      .map((a) => viewAppointment(a, viewer)).filter(Boolean)
      .sort((a, b) => ms(a.start_time) - ms(b.start_time));
  },

  createAppointment(b, actor = ME) {
    const m = load();
    const f = apply(actor, b);
    const now = new Date().toISOString();
    const row = { id: `a${m.seq++}`, couple_id: COUPLE, created_by: actor, ...f, notes: clean(b.notes, 500), status: 'confirmed', rev: 1, created_at: now, updated_at: now };
    m.appointments.push(row); save();
    emit('appointment:created', { id: row.id, by: actor });
    if (row.visibility === 'shared') notify(other(actor), `${NAMES[actor]} booked ${apptLabel(row)}`);
    return viewAppointment(row, actor);
  },

  updateAppointment(id, b, actor = ME) {
    const m = load();
    const a = m.appointments.find((x) => x.id === id && x.status === 'confirmed');
    if (!a || viewAppointment(a, actor) === null) fail(404, 'not_found', 'That appointment no longer exists');
    if (a.visibility === 'private' && a.created_by !== actor) fail(403, 'forbidden', 'Not allowed');
    if (b.rev != null && b.rev !== a.rev) fail(409, 'stale', 'This was just changed. Showing the latest version.');
    const f = apply(actor, b, a);
    Object.assign(a, f, { rev: a.rev + 1, updated_at: new Date().toISOString() });
    if (actor === a.created_by && b.notes !== undefined) a.notes = clean(b.notes, 500); // notes stay with their author
    save();
    emit('appointment:updated', { id, by: actor });
    if (a.visibility === 'shared') notify(other(actor), `${NAMES[actor]} changed ${apptLabel(a)}`);
    return viewAppointment(a, actor);
  },

  cancelAppointment(id, actor = ME) {
    const m = load();
    const a = m.appointments.find((x) => x.id === id && x.status === 'confirmed');
    if (!a || viewAppointment(a, actor) === null) fail(404, 'not_found', 'That appointment no longer exists');
    a.status = 'cancelled'; a.rev += 1; a.updated_at = new Date().toISOString(); save();
    emit('appointment:cancelled', { id, by: actor });
    if (a.visibility === 'shared') notify(other(actor), `${NAMES[actor]} cancelled ${apptLabel(a)}`);
    return { ok: true };
  },

  // ---------- availability (my own blocks only; the partner only ever gets computed free time) ----------
  availability({ from, to } = {}, actor = ME) {
    const f = from ? ms(from) : -Infinity, t = to ? ms(to) : Infinity;
    return load().availability.filter((b) => b.user_id === actor && ms(b.start_time) < t && ms(b.end_time) > f).sort((a, b) => ms(a.start_time) - ms(b.start_time));
  },
  addAvailability(b, actor = ME) {
    if (!['busy', 'available'].includes(b.availability_type)) fail(400, 'bad_type', 'Choose busy or available');
    const v = validateRange(b.start_time, b.end_time, { maxHours: 24 });
    if (!v.ok) fail(422, v.code, v.message);
    const m = load(), now = new Date().toISOString();
    const row = { id: `v${m.seq++}`, user_id: actor, couple_id: COUPLE, availability_type: b.availability_type, start_time: iso(b.start_time), end_time: iso(b.end_time), created_at: now, updated_at: now };
    m.availability.push(row); save();
    emit('availability:updated', { by: actor });
    return row;
  },
  updateAvailability(id, b, actor = ME) {
    const row = load().availability.find((x) => x.id === id && x.user_id === actor);
    if (!row) fail(404, 'not_found', 'Block not found');
    const next = { ...row, ...b, id, user_id: actor };
    if (!['busy', 'available'].includes(next.availability_type)) fail(400, 'bad_type', 'Choose busy or available');
    const v = validateRange(next.start_time, next.end_time, { maxHours: 24 });
    if (!v.ok) fail(422, v.code, v.message);
    Object.assign(row, { availability_type: next.availability_type, start_time: iso(next.start_time), end_time: iso(next.end_time), updated_at: new Date().toISOString() });
    save(); emit('availability:updated', { by: actor });
    return row;
  },
  deleteAvailability(id, actor = ME) {
    const m = load(), n = m.availability.length;
    m.availability = m.availability.filter((x) => !(x.id === id && x.user_id === actor));
    if (m.availability.length === n) fail(404, 'not_found', 'Block not found');
    save(); emit('availability:updated', { by: actor });
    return { ok: true };
  },

  // Both partners' free time inside [from, to] plus the time they share. No private detail is returned.
  slots({ from, to, minutes = 30, ignoreId = null, notBefore = null }, actor = ME) {
    const m = load(), p = other(actor);
    const side = (u) => ({ available: availableFor(u, m.availability), busy: busyFor(u, { appointments: m.appointments, availability: m.availability, ignoreId }) });
    return mutualAvailability({ from: ms(from), to: ms(to), slotMinutes: Number(minutes) || 30, notBefore: notBefore ? ms(notBefore) : null, me: side(actor), partner: side(p) });
  },

  // ---------- live location ----------
  _expireIfNeeded(u) {
    const m = load(), s = m.sessions[u];
    if (s && s.is_active && !sessionActive(s, Date.now(), m.locations[u]?.updated_at)) {
      m.sessions[u] = { ...s, is_active: false, stopped_at: new Date().toISOString() };
      m.locations[u] = null; // nothing is kept once a session ends
      save(); emit('location:stopped', { by: u, reason: 'expired' });
    }
  },
  locationState(actor = ME) {
    const m = load(), p = other(actor);
    this._ensureDemoPartner();
    this._expireIfNeeded(actor); this._expireIfNeeded(p);
    const mine = m.sessions[actor];
    return {
      session: mine && sessionActive(mine, Date.now(), m.locations[actor]?.updated_at) ? mine : null,
      me: m.locations[actor] || null,
      partner: visibleLocation({ session: m.sessions[p], location: m.locations[p] }),
      partnerSharing: sessionActive(m.sessions[p], Date.now(), m.locations[p]?.updated_at),
      serverTime: new Date().toISOString(),
    };
  },
  startLocation({ duration }, actor = ME) {
    const exp = expiryFor(duration);
    if (exp === undefined) fail(400, 'bad_duration', 'Choose 15 minutes, 1 hour, 8 hours or until you turn it off');
    const m = load(), now = new Date().toISOString();
    m.sessions[actor] = { id: `s${m.seq++}`, user_id: actor, couple_id: COUPLE, is_active: true, expires_at: exp, started_at: now, stopped_at: null };
    save(); emit('location:started', { by: actor, expires_at: exp });
    notify(other(actor), `${NAMES[actor]} is sharing a live location with you`);
    return m.sessions[actor];
  },
  stopLocation(actor = ME) {
    const m = load(), s = m.sessions[actor];
    if (s && s.is_active) m.sessions[actor] = { ...s, is_active: false, stopped_at: new Date().toISOString() };
    m.locations[actor] = null; // last position is deleted immediately, no history
    if (actor === PARTNER) m.demoPartnerOptOut = true;
    save(); emit('location:stopped', { by: actor, reason: 'stopped' });
    return { ok: true };
  },
  pushLocation({ latitude, longitude, accuracy }, actor = ME) {
    const m = load(); this._expireIfNeeded(actor);
    const s = m.sessions[actor];
    if (!s || !sessionActive(s, Date.now(), m.locations[actor]?.updated_at)) fail(403, 'not_sharing', 'Location sharing is not turned on');
    if (!validCoords(latitude, longitude, accuracy)) fail(422, 'bad_coords', 'Those coordinates are not valid');
    m.locations[actor] = { id: `l${actor}`, user_id: actor, couple_id: COUPLE, latitude, longitude, accuracy: accuracy ?? null, updated_at: new Date().toISOString() };
    save(); emit('location:update', { by: actor });
    return m.locations[actor];
  },
  requestLocation(actor = ME) {
    const m = load(), last = m.lastRequest[actor] || 0;
    if (Date.now() - last < REQUEST_COOLDOWN_MS) fail(429, 'too_soon', 'You asked a moment ago. Give them a little time.');
    m.lastRequest[actor] = Date.now(); save();
    notify(other(actor), `${NAMES[actor]} asked if you can share your live location`, 'location_request');
    emit('location:request', { by: actor });
    return { sent: true };
  },

  notifications(viewer = ME) {
    return load().notifications.filter((n) => n.user_id === viewer).map((n) => ({ id: n.id, text: n.text, ago: agoShort(n.created_at), kind: n.kind }));
  },

  // ---- demo-only: the partner is simulated so the map and notifications have something to show ----
  _ensureDemoPartner() {
    const m = load();
    if (m.demoPartnerOptOut || sessionActive(m.sessions[PARTNER], Date.now(), m.locations[PARTNER]?.updated_at)) return;
    const now = new Date().toISOString();
    m.sessions[PARTNER] = { id: `s${m.seq++}`, user_id: PARTNER, couple_id: COUPLE, is_active: true, expires_at: expiryFor('8h'), started_at: now, stopped_at: null };
    m.locations[PARTNER] = { id: 'l' + PARTNER, user_id: PARTNER, couple_id: COUPLE, latitude: 12.9784, longitude: 77.6408, accuracy: 25, updated_at: now };
    save();
  },
  simulatePartnerStep() {
    const m = load(), l = m.locations[PARTNER];
    if (!l || !sessionActive(m.sessions[PARTNER], Date.now(), l.updated_at)) return;
    m.locations[PARTNER] = { ...l, latitude: l.latitude + (Math.random() - 0.5) * 0.0006, longitude: l.longitude + (Math.random() - 0.5) * 0.0006, updated_at: new Date().toISOString() };
    save(); emit('location:update', { by: PARTNER });
  },
  reset() { mem = null; try { store()?.removeItem(KEY); } catch { /* ignore */ } },
};

function agoShort(isoStr) {
  const s = Math.max(0, (Date.now() - ms(isoStr)) / 1000);
  if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`;
}

// While a screen is subscribed in demo mode, move the simulated partner a little every 15 s.
let simTimer = null, simUsers = 0;
export function useDemoPartnerSim(on) {
  if (typeof window === 'undefined') return () => {};
  if (!on) return () => {};
  simUsers++;
  if (!simTimer) simTimer = setInterval(() => coupleService.simulatePartnerStep(), 15000);
  return () => { simUsers--; if (simUsers <= 0 && simTimer) { clearInterval(simTimer); simTimer = null; simUsers = 0; } };
}
