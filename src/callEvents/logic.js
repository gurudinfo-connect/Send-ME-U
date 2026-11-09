// Pure rules for scheduled calls ("call events"). Shared by the demo service (src/callEvents/eventService.js),
// the screens and the real server (backend/src/callEvents/routes.js), so both sides enforce the SAME rules.
// All instants are ISO strings / Date values; clients render them in their own time zone.

export const REMINDER_OPTIONS = [
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
  { value: 0, label: 'No reminder' },
];
export const DEFAULT_REMINDER = 15;
export const JOIN_OPENS_MIN = 10; // the room opens this many minutes before the start time
export const MAX_TITLE = 80;
export const MAX_DESC = 500;
export const MAX_GUESTS = 250;
export const CALL_TYPES = ['voice', 'video'];
export const STATUSES = ['pending', 'accepted', 'declined', 'removed']; // guest invitation statuses

export const reminderLabel = (m) => REMINDER_OPTIONS.find((o) => o.value === Number(m))?.label || 'No reminder';
export const callTypeLabel = (t) => (t === 'video' ? 'Video call' : 'Voice call');
export const ms = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

const clean = (s, max) => String(s ?? '').trim().slice(0, max);

/** Validate a create / edit payload. Returns { ok, error, value } - `value` is the cleaned payload. */
export function validateEvent(b, now = Date.now()) {
  const title = clean(b?.title, MAX_TITLE);
  if (!title) return { ok: false, error: 'Add an event title' };
  const start = ms(b?.start_datetime), end = ms(b?.end_datetime);
  if (Number.isNaN(start)) return { ok: false, error: 'Choose a start date and time' };
  if (Number.isNaN(end)) return { ok: false, error: 'Choose an end date and time' };
  if (end <= start) return { ok: false, error: 'End time must be after the start time' };
  if (end <= now) return { ok: false, error: 'This event would already be over. Pick a time in the future' };
  if (end - start > 24 * 3600e3) return { ok: false, error: 'A call can last up to 24 hours' };
  const call_type = CALL_TYPES.includes(b?.call_type) ? b.call_type : null;
  if (!call_type) return { ok: false, error: 'Choose voice or video' };
  const reminder_minutes = b?.reminder_minutes == null ? DEFAULT_REMINDER : Number(b.reminder_minutes);
  if (!REMINDER_OPTIONS.some((o) => o.value === reminder_minutes)) return { ok: false, error: 'Choose a valid reminder' };
  return { ok: true, value: {
    title, description: clean(b?.description, MAX_DESC), event_image: b?.event_image || null,
    start_datetime: new Date(start).toISOString(), end_datetime: new Date(end).toISOString(),
    call_type, require_approval: !!b?.require_approval, reminder_minutes,
  } };
}

/** When should the reminder fire? null when there is no reminder or it would already be in the past at creation. */
export const reminderAt = (startISO, minutes) => (Number(minutes) > 0 ? new Date(ms(startISO) - Number(minutes) * 60e3).toISOString() : null);

/** Lifecycle: cancelled | ended | live | upcoming */
export function eventState(e, now = Date.now()) {
  if (e.status === 'cancelled') return 'cancelled';
  if (now >= ms(e.end_datetime)) return 'ended';
  if (now >= ms(e.start_datetime)) return 'live';
  return 'upcoming';
}

/** Can this user open the room right now? Returns { ok, reason, needsApproval }. `guest` is the user's guest row (or undefined). */
export function joinDecision(e, userId, guest, now = Date.now()) {
  const isHost = String(e.host_user_id) === String(userId);
  const state = eventState(e, now);
  if (state === 'cancelled') return { ok: false, reason: 'This event was cancelled' };
  if (state === 'ended') return { ok: false, reason: 'This event has ended' };
  if (!isHost && (!guest || guest.invitation_status === 'removed')) return { ok: false, reason: 'You are not invited to this call' };
  if (!isHost && guest.invitation_status === 'declined') return { ok: false, reason: 'You declined this invitation. Accept it to join' };
  if (now < ms(e.start_datetime) - JOIN_OPENS_MIN * 60e3) return { ok: false, reason: `You can join ${JOIN_OPENS_MIN} minutes before the start`, early: true };
  if (isHost) return { ok: true, host: true };
  if (e.require_approval && !guest.approved) return { ok: true, needsApproval: true };
  return { ok: true };
}

/** Add guest ids without duplicates, never the host, and never above the limit. Removed guests may be re-invited. */
export function mergeGuests(existing, ids, hostId) {
  const rows = existing.map((g) => ({ ...g }));
  const added = [];
  for (const raw of ids) {
    const id = String(raw);
    if (id === String(hostId)) continue;
    const row = rows.find((g) => String(g.user_id) === id);
    if (row) { if (row.invitation_status === 'removed') { row.invitation_status = 'pending'; row.approved = false; added.push(id); } continue; }
    if (rows.filter((g) => g.invitation_status !== 'removed').length >= MAX_GUESTS) break;
    rows.push({ user_id: id, invitation_status: 'pending', approved: false, joined_at: null });
    added.push(id);
  }
  return { rows, added };
}

/** Which events does the user see under a filter tab? tab: all | scheduled | pending */
export function filterEvents(events, userId, tab, now = Date.now()) {
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const mine = events.map((e) => {
    const g = e.guests?.find((x) => String(x.user_id) === String(userId));
    const host = String(e.host_user_id) === String(userId);
    return { e, host, g };
  }).filter(({ e, host, g }) => (host || (g && g.invitation_status !== 'removed')) && ms(e.end_datetime) >= dayStart.getTime());
  const pick = tab === 'pending'
    ? mine.filter(({ host, g, e }) => !host && g.invitation_status === 'pending' && e.status !== 'cancelled' && ms(e.end_datetime) > now)
    : tab === 'scheduled'
      ? mine.filter(({ host, g, e }) => e.status !== 'cancelled' && (host || g.invitation_status === 'accepted'))
      : mine;
  return pick.map((x) => x.e).sort((a, b) => ms(a.start_datetime) - ms(b.start_datetime));
}

/** The calls to show under "Upcoming" on the Calls page: mine, not cancelled, not over, soonest first. */
export const upcomingFor = (events, userId, now = Date.now(), limit = 3) =>
  filterEvents(events, userId, 'scheduled', now).filter((e) => ms(e.end_datetime) > now).slice(0, limit);

const sameDay = (a, b) => a.toDateString() === b.toDateString();
const t12 = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const timeRange = (e) => `${t12(new Date(e.start_datetime))} – ${t12(new Date(e.end_datetime))}`;
export function dayWord(iso, now = new Date()) {
  const d = new Date(iso), tm = new Date(now); tm.setDate(now.getDate() + 1);
  return sameDay(d, now) ? 'Today' : sameDay(d, tm) ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
export const whenLabel = (e) => `${dayWord(e.start_datetime)}, ${timeRange(e)}`;
export const longDate = (iso) => { const d = new Date(iso); return `${sameDay(d, new Date()) ? 'Today, ' : d.toLocaleDateString(undefined, { weekday: 'short' }) + ', '}${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`; };

/** Cryptographically random, URL-safe id for meeting rooms. */
export function randomId(bytes = 12) {
  const a = new Uint8Array(bytes);
  (globalThis.crypto || { getRandomValues: (x) => x.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(a);
  return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, bytes * 2 - 2);
}
export const meetingLink = (origin, meetingId) => `${origin}/calls/join/${meetingId}`;

/** iCalendar text so "Add to calendar" works with any calendar app. */
export function toICS(e, url = '') {
  const f = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SendMeU//Calls//EN', 'BEGIN:VEVENT', `UID:${e.id}@sendmeu`, `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(e.start_datetime)}`, `DTEND:${f(e.end_datetime)}`, `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc([e.description, url].filter(Boolean).join('\n'))}`, url ? `URL:${url}` : '',
    ...(e.reminder_minutes > 0 ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${e.reminder_minutes}M`, 'END:VALARM'] : []), 'END:VEVENT', 'END:VCALENDAR']
    .filter(Boolean).join('\r\n');
}
