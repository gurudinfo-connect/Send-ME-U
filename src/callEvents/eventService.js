// Demo "server" for scheduled calls (used when VITE_USE_MOCK=true). It enforces the same rules as backend/src/callEvents/routes.js
// by calling the shared functions in ./logic.js, persists in this browser (localStorage) and announces changes on `callEventBus`
// exactly like the Socket.IO events the real server sends (see backend/src/callEvents/sockets.js).
// Demo accounts: me (u0) plus the people in data/mock.js. Other people are simulated: invited online people accept after a short delay,
// and a simulated host lets me in a few seconds after I ask to join an approval-only call.
import * as mock from '../data/mock.js';
import { validateEvent, reminderAt, joinDecision, mergeGuests, eventState, randomId, meetingLink, ms, reminderLabel } from './logic.js';

export const callEventBus = new EventTarget();
const emit = (name, payload = {}) => callEventBus.dispatchEvent(new CustomEvent('callevent', { detail: { name, payload } }));
const KEY = 'smu_callevents_v1';
const ME = mock.me.id;
const fail = (status, message) => { throw Object.assign(new Error(message), { response: { status, data: { message } } }); };

const dir = () => [mock.me, ...mock.people];
const person = (id) => dir().find((p) => p.id === id);
const brief = (id) => { const p = person(id); return p ? { id: p.id, name: p.name, avatar: p.avatar } : { id, name: 'SendMeU user', avatar: '/assets/me.svg' }; };
const origin = () => (typeof location !== 'undefined' ? location.origin : 'https://sendmeu.app');

let mem = null;
const storage = () => { try { return globalThis.localStorage; } catch { return null; } };
const persist = () => { try { storage()?.setItem(KEY, JSON.stringify(mem)); } catch { /* quota or private mode: keep in memory */ } };
const inMin = (m) => new Date(Date.now() + m * 60e3).toISOString();

function seed() {
  const start = inMin(120), end = inMin(150);
  const ev = {
    id: 'ev_seed1', host_user_id: 'u1', title: 'Weekend trip planning', description: 'Quick call to lock the plan for Coorg.', event_image: null,
    start_datetime: start, end_datetime: end, call_type: 'video', meeting_id: randomId(), require_approval: false, reminder_minutes: 15, status: 'scheduled',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    guests: [{ user_id: ME, invitation_status: 'pending', approved: false, joined_at: null }, { user_id: 'u2', invitation_status: 'accepted', approved: false, joined_at: null }],
  };
  return { seq: 1, events: [ev], reminders: [], notes: [{ id: 'cn0', user_id: ME, kind: 'event:invite', event_id: ev.id, text: 'Priya invited you to “Weekend trip planning”', created_at: new Date().toISOString(), read: false }], rooms: {} };
}
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(storage()?.getItem(KEY) || 'null'); } catch { mem = null; }
  if (!mem) { mem = seed(); persist(); }
  return mem;
}

const note = (userId, kind, text, eventId) => {
  const m = load();
  const n = { id: `cn${m.seq++}`, user_id: userId, kind, event_id: eventId, text, created_at: new Date().toISOString(), read: false };
  m.notes.unshift(n); m.notes.length = Math.min(m.notes.length, 60);
  if (userId === ME) emit('notification:new', { text, kind, event_id: eventId });
};
const setReminder = (e, userId) => {
  const m = load();
  m.reminders = m.reminders.filter((r) => !(r.event_id === e.id && r.user_id === userId));
  const at = reminderAt(e.start_datetime, e.reminder_minutes);
  if (at) m.reminders.push({ id: `r${m.seq++}`, event_id: e.id, user_id: userId, reminder_datetime: at, delivery_status: 'pending' });
};
const firstName = (id) => (person(id)?.name || 'Someone').split(/[ _]/)[0];

// Simulated people react a little later (demo only). Real people answer through the API.
function sweep() {
  const m = load(); let changed = false; const t = Date.now();
  for (const e of m.events) {
    for (const g of e.guests) {
      if (g.auto_at && g.auto_at <= t) {
        g.auto_at = null; changed = true;
        if (person(g.user_id)?.online && g.invitation_status === 'pending') {
          g.invitation_status = 'accepted';
          note(e.host_user_id, 'event:response', `${firstName(g.user_id)} accepted “${e.title}”`, e.id);
        }
      }
      if (g.approve_at && g.approve_at <= t) { g.approve_at = null; g.approved = true; g.join_requested = false; changed = true; if (g.user_id === ME) emit('join:approved', { event_id: e.id }); }
    }
  }
  if (changed) { persist(); emit('events:changed'); }
}

const view = (e, viewer = ME) => {
  const guests = e.guests.filter((g) => g.invitation_status !== 'removed').map((g) => ({ ...g, ...brief(g.user_id), auto_at: undefined, approve_at: undefined }));
  const mine = e.guests.find((g) => g.user_id === viewer);
  const host = brief(e.host_user_id);
  return {
    id: e.id, host_user_id: e.host_user_id, host, title: e.title, description: e.description, event_image: e.event_image,
    start_datetime: e.start_datetime, end_datetime: e.end_datetime, call_type: e.call_type, meeting_id: e.meeting_id, meeting_link: meetingLink(origin(), e.meeting_id),
    require_approval: e.require_approval, reminder_minutes: e.reminder_minutes, status: e.status, created_at: e.created_at, updated_at: e.updated_at,
    state: eventState(e), guests,
    me: { host: e.host_user_id === viewer, status: e.host_user_id === viewer ? 'accepted' : mine?.invitation_status || null, approved: !!mine?.approved, join_requested: !!mine?.join_requested },
    join: joinDecision(e, viewer, mine),
  };
};
const find = (id) => { const e = load().events.find((x) => x.id === id); if (!e) fail(404, 'Event not found'); return e; };
const mustHost = (e) => { if (e.host_user_id !== ME) fail(403, 'Only the host can do that'); };
const mustOpen = (e) => { const s = eventState(e); if (s === 'cancelled') fail(409, 'This event was cancelled'); if (s === 'ended') fail(409, 'This event has ended'); };

export const callEventService = {
  reset() { mem = null; try { storage()?.removeItem(KEY); } catch { /* ignore */ } }, // tests
  list() { sweep(); return load().events.filter((e) => e.host_user_id === ME || e.guests.some((g) => g.user_id === ME && g.invitation_status !== 'removed')).map((e) => view(e)); },
  get(id) { sweep(); return view(find(id)); },
  // opening a meeting link: any signed-in user can see the invitation; responding adds them as a guest
  byMeeting(meetingId) { sweep(); const e = load().events.find((x) => x.meeting_id === meetingId); if (!e) fail(404, 'This invitation link is not valid'); return view(e); },
  newDraftIds() { return { meeting_id: randomId() }; },

  create(b) {
    const v = validateEvent(b); if (!v.ok) fail(400, v.error);
    const m = load();
    const meetingId = /^[a-z0-9]{10,40}$/.test(b.meeting_id || '') && !m.events.some((x) => x.meeting_id === b.meeting_id) ? b.meeting_id : randomId();
    const now = new Date().toISOString();
    const e = { id: `ev_${randomId(5)}`, host_user_id: ME, ...v.value, meeting_id: meetingId, status: 'scheduled', created_at: now, updated_at: now, guests: [] };
    const { rows, added } = mergeGuests([], (b.guest_ids || []).filter((id) => person(id)), ME);
    e.guests = rows.map((g) => ({ ...g, auto_at: person(g.user_id)?.online ? Date.now() + 6000 + Math.floor(Math.random() * 9000) : null }));
    m.events.push(e); setReminder(e, ME); persist();
    added.forEach((id) => note(id, 'event:invite', `${firstName(ME)} invited you to “${e.title}”`, e.id));
    emit('events:changed'); return view(e);
  },

  update(id, b) {
    const e = find(id); mustHost(e); mustOpen(e);
    const v = validateEvent({ ...e, ...b }); if (!v.ok) fail(400, v.error);
    const timeChanged = v.value.start_datetime !== e.start_datetime || v.value.end_datetime !== e.end_datetime || v.value.call_type !== e.call_type || v.value.title !== e.title;
    Object.assign(e, v.value, { updated_at: new Date().toISOString() }); // id, meeting_id and meeting link are kept
    let added = [];
    if (Array.isArray(b.guest_ids)) {
      // the edit screen sends the full selection: add new people, remove the unselected (never the host)
      const want = new Set(b.guest_ids.filter((x) => person(x)));
      e.guests.forEach((g) => { if (!want.has(g.user_id) && g.invitation_status !== 'removed') g.invitation_status = 'removed'; });
      const r = mergeGuests(e.guests, [...want], ME); e.guests = r.rows; added = r.added;
      e.guests.forEach((g) => { if (added.includes(g.user_id)) g.auto_at = person(g.user_id)?.online ? Date.now() + 6000 : null; });
    }
    load().reminders = load().reminders.filter((r) => r.event_id !== e.id);
    setReminder(e, ME);
    e.guests.filter((g) => g.invitation_status === 'accepted').forEach((g) => setReminder(e, g.user_id));
    persist();
    added.forEach((gid) => note(gid, 'event:invite', `${firstName(ME)} invited you to “${e.title}”`, e.id));
    if (timeChanged) e.guests.filter((g) => g.invitation_status !== 'removed' && !added.includes(g.user_id)).forEach((g) => note(g.user_id, 'event:updated', `“${e.title}” was updated`, e.id));
    emit('events:changed'); return view(e);
  },

  cancel(id) {
    const e = find(id); mustHost(e);
    if (e.status === 'cancelled') return view(e);
    e.status = 'cancelled'; e.updated_at = new Date().toISOString();
    load().reminders = load().reminders.filter((r) => r.event_id !== id);
    e.guests.filter((g) => g.invitation_status !== 'removed').forEach((g) => note(g.user_id, 'event:cancelled', `“${e.title}” was cancelled`, e.id));
    persist(); emit('events:changed'); return view(e);
  },

  addGuests(id, ids) {
    const e = find(id); mustHost(e); mustOpen(e);
    const r = mergeGuests(e.guests, (ids || []).filter((x) => person(x)), ME);
    if (!r.added.length) return { ...view(e), added: [] };
    e.guests = r.rows.map((g) => (r.added.includes(g.user_id) ? { ...g, auto_at: person(g.user_id)?.online ? Date.now() + 6000 + Math.floor(Math.random() * 6000) : null } : g));
    e.updated_at = new Date().toISOString(); persist();
    r.added.forEach((gid) => note(gid, 'event:invite', `${firstName(ME)} invited you to “${e.title}”`, e.id));
    emit('events:changed'); return { ...view(e), added: r.added };
  },

  removeGuest(id, userId) {
    const e = find(id); mustHost(e);
    const g = e.guests.find((x) => x.user_id === userId); if (!g) fail(404, 'That person is not invited');
    g.invitation_status = 'removed'; persist(); emit('events:changed'); return view(e);
  },

  // accepted | declined. Works for invited guests and for people who opened the invitation link.
  respond(id, status) {
    if (!['accepted', 'declined'].includes(status)) fail(400, 'Choose accept or decline');
    const e = find(id);
    if (e.host_user_id === ME) fail(400, 'You are the host of this event');
    mustOpen(e);
    let g = e.guests.find((x) => x.user_id === ME);
    if (!g) { g = { user_id: ME, invitation_status: status, approved: false, joined_at: null, via_link: true }; e.guests.push(g); }
    else if (g.invitation_status === 'removed') fail(403, 'You are no longer invited to this call');
    g.invitation_status = status;
    if (status === 'accepted') setReminder(e, ME); else load().reminders = load().reminders.filter((r) => !(r.event_id === id && r.user_id === ME));
    note(e.host_user_id, 'event:response', `${firstName(ME)} ${status} “${e.title}”`, e.id);
    persist(); emit('events:changed'); return view(e);
  },

  participants(id) {
    sweep();
    const e = find(id); const v = view(e);
    const going = [{ ...v.host, creator: true, joined_at: null }, ...v.guests.filter((g) => g.invitation_status === 'accepted')];
    return { going, not_responded: v.guests.filter((g) => g.invitation_status === 'pending'), declined: v.guests.filter((g) => g.invitation_status === 'declined'),
      requests: e.host_user_id === ME ? v.guests.filter((g) => g.join_requested) : [] };
  },

  // Verifies the event, the person's invitation, the time window and the approval rule. On success returns the room to connect to.
  join(id) {
    sweep();
    const e = find(id); const g = e.guests.find((x) => x.user_id === ME);
    const d = joinDecision(e, ME, g);
    if (!d.ok) fail(d.early ? 425 : 403, d.reason);
    if (d.needsApproval) {
      if (!g.join_requested) { g.join_requested = true; g.approve_at = person(e.host_user_id)?.online ? Date.now() + 5000 : null; persist(); note(e.host_user_id, 'event:request', `${firstName(ME)} asked to join “${e.title}”`, e.id); emit('events:changed'); }
      return { status: 'pending', event: view(e) };
    }
    if (g) { g.joined_at = new Date().toISOString(); g.join_requested = false; persist(); }
    return { status: 'ok', room: { meeting_id: e.meeting_id, call_type: e.call_type, title: e.title }, event: view(e) };
  },
  leave(id) { const e = find(id); const g = e.guests.find((x) => x.user_id === ME); if (g) { g.left_at = new Date().toISOString(); persist(); } return { ok: true }; },

  decideRequest(id, userId, approve) {
    const e = find(id); mustHost(e);
    const g = e.guests.find((x) => x.user_id === userId); if (!g || !g.join_requested) fail(404, 'There is no join request from that person');
    g.join_requested = false; g.approve_at = null; g.approved = !!approve; persist(); emit('events:changed');
    return view(e);
  },

  // Due reminders for me, delivered once. The real server does this in its scheduler (backend/src/callEvents/sockets.js).
  deliverReminders() {
    const m = load(); const out = [];
    for (const r of m.reminders) {
      if (r.delivery_status !== 'pending' || r.user_id !== ME || ms(r.reminder_datetime) > Date.now()) continue;
      const e = m.events.find((x) => x.id === r.event_id);
      r.delivery_status = !e || eventState(e) !== 'upcoming' ? 'skipped' : 'sent';
      if (r.delivery_status === 'sent') { note(ME, 'event:reminder', `Starting soon: “${e.title}” (${reminderLabel(e.reminder_minutes).replace(' before', '')} to go)`, e.id); out.push(e.id); }
    }
    if (out.length || m.reminders.some((r) => r.delivery_status === 'skipped')) persist();
    return out;
  },

  notifications() {
    sweep();
    const ago = (iso) => { const s = Math.max(1, (Date.now() - ms(iso)) / 1000); return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };
    return load().notes.filter((n) => n.user_id === ME).map((n) => {
      const e = load().events.find((x) => x.id === n.event_id);
      const g = e?.guests.find((x) => x.user_id === ME);
      return { id: n.id, text: n.text, ago: ago(n.created_at), kind: n.kind, event_id: n.event_id, actionable: n.kind === 'event:invite' && e && e.status !== 'cancelled' && g?.invitation_status === 'pending' && ms(e.end_datetime) > Date.now() };
    });
  },
};
