// Express routes for scheduled calls. Mount at /api/v1/call-events (the existing /events routes belong to the couple calendar):
//   app.use('/api/v1/call-events', callEventsRouter({ pool, auth, notifyUsers }));
// `auth` must set req.user.id from a verified token. `notifyUsers(userIds, event, payload)` pushes a Socket.IO event (see sockets.js).
// Validation and join rules are the SAME pure functions the frontend demo uses (src/callEvents/logic.js).
import express from 'express';
import crypto from 'node:crypto';
import { validateEvent, reminderAt, joinDecision, mergeGuests, eventState, reminderLabel } from '../../../src/callEvents/logic.js';

const HttpError = (status, message) => Object.assign(new Error(message), { status });
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const idOf = (v) => { if (!/^\d{1,18}$/.test(String(v))) throw HttpError(400, 'Invalid id'); return String(v); };
const newMeetingId = () => crypto.randomBytes(15).toString('hex'); // 30 chars of [0-9a-f], 120 bits

export function callEventsRouter({ pool, auth, notifyUsers = () => {}, publicOrigin = process.env.PUBLIC_APP_URL || 'http://localhost:5173' }) {
  const r = express.Router();
  r.use(express.json({ limit: '400kb' })); // the event image travels as a small data URL
  r.use(auth);

  const first = (n) => (n || 'Someone').split(/[ _]/)[0];
  const nameOf = async (db, id) => first((await db.query('SELECT name FROM users WHERE id = $1', [id])).rows[0]?.name);
  const notify = async (db, userId, kind, text, eventId) => {
    await db.query('INSERT INTO call_event_notifications (user_id, event_id, kind, text) VALUES ($1,$2,$3,$4)', [userId, eventId, kind, text]);
    notifyUsers([userId], 'notification:new', { kind, text, event_id: String(eventId) });
  };
  const changed = (ids) => notifyUsers(ids, 'callevent:changed', {});

  const setReminder = async (db, ev, userId) => {
    const at = reminderAt(ev.start_datetime, ev.reminder_minutes);
    if (!at) return db.query('DELETE FROM event_reminders WHERE event_id = $1 AND user_id = $2', [ev.id, userId]);
    await db.query(`INSERT INTO event_reminders (event_id, user_id, reminder_datetime) VALUES ($1,$2,$3)
      ON CONFLICT (event_id, user_id) DO UPDATE SET reminder_datetime = EXCLUDED.reminder_datetime, delivery_status = 'pending'`, [ev.id, userId, at]);
  };

  // One event as the signed-in user sees it (same shape as the demo service).
  const load = async (db, where, param, viewer) => {
    const { rows } = await db.query(`SELECT e.*, u.name AS host_name, u.avatar_url AS host_avatar FROM scheduled_events e JOIN users u ON u.id = e.host_user_id WHERE ${where}`, [param]);
    const e = rows[0]; if (!e) throw HttpError(404, 'Event not found');
    const g = (await db.query(`SELECT g.*, u.name, u.avatar_url AS avatar FROM scheduled_event_guests g JOIN users u ON u.id = g.user_id WHERE g.event_id = $1 ORDER BY g.created_at`, [e.id])).rows;
    return shape(e, g, viewer);
  };
  const shape = (e, guestRows, viewer) => {
    const id = String(e.id); const hostId = String(e.host_user_id);
    const guests = guestRows.filter((x) => x.invitation_status !== 'removed').map((x) => ({ user_id: String(x.user_id), name: x.name, avatar: x.avatar, invitation_status: x.invitation_status, approved: x.approved, join_requested: x.join_requested, joined_at: x.joined_at }));
    const mine = guestRows.find((x) => String(x.user_id) === String(viewer));
    const raw = { ...e, id, host_user_id: hostId, start_datetime: new Date(e.start_datetime).toISOString(), end_datetime: new Date(e.end_datetime).toISOString() };
    const isHost = hostId === String(viewer);
    return {
      id, host_user_id: hostId, host: { id: hostId, name: e.host_name, avatar: e.host_avatar }, title: e.title, description: e.description, event_image: e.event_image,
      start_datetime: raw.start_datetime, end_datetime: raw.end_datetime, call_type: e.call_type, meeting_id: e.meeting_id, meeting_link: `${publicOrigin}/calls/join/${e.meeting_id}`,
      require_approval: e.require_approval, reminder_minutes: e.reminder_minutes, status: e.status, created_at: e.created_at, updated_at: e.updated_at,
      state: eventState(raw), guests,
      me: { host: isHost, status: isHost ? 'accepted' : mine?.invitation_status || null, approved: !!mine?.approved, join_requested: !!mine?.join_requested },
      join: joinDecision(raw, viewer, mine && { invitation_status: mine.invitation_status, approved: mine.approved }),
    };
  };
  const hostOnly = (ev) => { if (!ev.me.host) throw HttpError(403, 'Only the host can do that'); };
  const openOnly = (ev) => { if (ev.state === 'cancelled') throw HttpError(409, 'This event was cancelled'); if (ev.state === 'ended') throw HttpError(409, 'This event has ended'); };
  const tx = async (fn) => {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  };
  const existingUsers = async (db, ids) => (ids.length ? (await db.query('SELECT id FROM users WHERE id = ANY($1::bigint[])', [ids.filter((x) => /^\d{1,18}$/.test(String(x)))])).rows.map((x) => String(x.id)) : []);

  // GET /  - everything relevant to me (hosted or invited), from the start of today
  r.get('/', asyncH(async (req, res) => {
    const me = req.user.id;
    const { rows } = await pool.query(`SELECT e.id FROM scheduled_events e LEFT JOIN scheduled_event_guests g ON g.event_id = e.id AND g.user_id = $1
      WHERE (e.host_user_id = $1 OR (g.id IS NOT NULL AND g.invitation_status <> 'removed')) AND e.end_datetime >= date_trunc('day', now()) ORDER BY e.start_datetime LIMIT 200`, [me]);
    res.json({ data: await Promise.all(rows.map((x) => load(pool, 'e.id = $1', x.id, me))) });
  }));

  // GET /link/:meetingId - opening an invitation link (any signed-in user may view the invitation; they respond through /respond)
  r.get('/link/:meetingId', asyncH(async (req, res) => {
    if (!/^[a-z0-9]{10,40}$/.test(req.params.meetingId)) throw HttpError(404, 'This invitation link is not valid');
    res.json({ data: await load(pool, 'e.meeting_id = $1', req.params.meetingId, req.user.id).catch((e) => { throw e.status === 404 ? HttpError(404, 'This invitation link is not valid') : e; }) });
  }));

  r.post('/', asyncH(async (req, res) => {
    const v = validateEvent(req.body); if (!v.ok) throw HttpError(400, v.error);
    const me = req.user.id;
    const out = await tx(async (db) => {
      let mid = /^[a-z0-9]{10,40}$/.test(req.body.meeting_id || '') ? req.body.meeting_id : newMeetingId();
      if ((await db.query('SELECT 1 FROM scheduled_events WHERE meeting_id = $1', [mid])).rowCount) mid = newMeetingId();
      const x = v.value;
      const { rows } = await db.query(`INSERT INTO scheduled_events (host_user_id,title,description,event_image,start_datetime,end_datetime,call_type,meeting_id,require_approval,reminder_minutes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [me, x.title, x.description, x.event_image, x.start_datetime, x.end_datetime, x.call_type, mid, x.require_approval, x.reminder_minutes]);
      const ev = rows[0];
      const ids = await existingUsers(db, (req.body.guest_ids || []).map(String));
      const { added } = mergeGuests([], ids, me);
      for (const gid of added) await db.query(`INSERT INTO scheduled_event_guests (event_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ev.id, gid]);
      await setReminder(db, ev, me);
      const host = await nameOf(db, me);
      for (const gid of added) await notify(db, gid, 'event:invite', `${host} invited you to “${ev.title}”`, ev.id);
      return { ev, added };
    });
    changed([req.user.id, ...out.added]);
    res.status(201).json({ data: await load(pool, 'e.id = $1', out.ev.id, me) });
  }));

  r.get('/:eventId', asyncH(async (req, res) => {
    const ev = await load(pool, 'e.id = $1', idOf(req.params.eventId), req.user.id);
    if (!ev.me.host && !ev.me.status) throw HttpError(403, 'You are not invited to this call'); // strangers use /link/:meetingId
    res.json({ data: ev });
  }));

  // PUT /:eventId - host edits. Keeps the id and meeting link. `guest_ids` (optional) is the full wanted guest list.
  r.put('/:eventId', asyncH(async (req, res) => {
    const id = idOf(req.params.eventId); const me = req.user.id;
    const out = await tx(async (db) => {
      await db.query('SELECT id FROM scheduled_events WHERE id = $1 FOR UPDATE', [id]);
      const cur = await load(db, 'e.id = $1', id, me); hostOnly(cur); openOnly(cur);
      const v = validateEvent({ ...cur, ...req.body }); if (!v.ok) throw HttpError(400, v.error);
      const x = v.value;
      await db.query(`UPDATE scheduled_events SET title=$2, description=$3, event_image=$4, start_datetime=$5, end_datetime=$6, call_type=$7, require_approval=$8, reminder_minutes=$9, updated_at=now() WHERE id=$1`,
        [id, x.title, x.description, x.event_image, x.start_datetime, x.end_datetime, x.call_type, x.require_approval, x.reminder_minutes]);
      let added = [];
      if (Array.isArray(req.body.guest_ids)) {
        const want = await existingUsers(db, req.body.guest_ids.map(String));
        const rows = (await db.query('SELECT * FROM scheduled_event_guests WHERE event_id = $1', [id])).rows.map((g) => ({ ...g, user_id: String(g.user_id) }));
        await db.query(`UPDATE scheduled_event_guests SET invitation_status='removed', updated_at=now() WHERE event_id=$1 AND NOT (user_id = ANY($2::bigint[]))`, [id, want]);
        const m = mergeGuests(rows.map((g) => (want.includes(g.user_id) ? g : { ...g, invitation_status: 'removed' })), want, me);
        added = m.added;
        for (const gid of added) await db.query(`INSERT INTO scheduled_event_guests (event_id,user_id) VALUES ($1,$2) ON CONFLICT (event_id,user_id) DO UPDATE SET invitation_status='pending', approved=false, updated_at=now()`, [id, gid]);
      }
      const ev = (await db.query('SELECT * FROM scheduled_events WHERE id = $1', [id])).rows[0];
      await db.query('DELETE FROM event_reminders WHERE event_id = $1', [id]);
      await setReminder(db, ev, me);
      const going = (await db.query(`SELECT user_id FROM scheduled_event_guests WHERE event_id=$1 AND invitation_status='accepted'`, [id])).rows.map((g) => String(g.user_id));
      for (const gid of going) await setReminder(db, ev, gid);
      const host = await nameOf(db, me);
      for (const gid of added) await notify(db, gid, 'event:invite', `${host} invited you to “${ev.title}”`, id);
      const others = (await db.query(`SELECT user_id FROM scheduled_event_guests WHERE event_id=$1 AND invitation_status IN ('pending','accepted')`, [id])).rows.map((g) => String(g.user_id)).filter((g) => !added.includes(g));
      for (const gid of others) await notify(db, gid, 'event:updated', `“${ev.title}” was updated`, id);
      return { others, added };
    });
    changed([me, ...out.others, ...out.added]);
    res.json({ data: await load(pool, 'e.id = $1', id, me) });
  }));

  // DELETE /:eventId - cancel (the row stays so guests see "cancelled")
  r.delete('/:eventId', asyncH(async (req, res) => {
    const id = idOf(req.params.eventId); const me = req.user.id;
    const ids = await tx(async (db) => {
      const cur = await load(db, 'e.id = $1', id, me); hostOnly(cur);
      if (cur.status === 'cancelled') return [];
      await db.query(`UPDATE scheduled_events SET status='cancelled', updated_at=now() WHERE id=$1`, [id]);
      await db.query('DELETE FROM event_reminders WHERE event_id = $1', [id]);
      const who = cur.guests.map((g) => g.user_id);
      for (const gid of who) await notify(db, gid, 'event:cancelled', `“${cur.title}” was cancelled`, id);
      return who;
    });
    changed([me, ...ids]);
    res.json({ data: await load(pool, 'e.id = $1', id, me) });
  }));

  r.post('/:eventId/guests', asyncH(async (req, res) => {
    const id = idOf(req.params.eventId); const me = req.user.id;
    const out = await tx(async (db) => {
      const cur = await load(db, 'e.id = $1', id, me); hostOnly(cur); openOnly(cur);
      const want = await existingUsers(db, (req.body.guestIds || []).map(String));
      const rows = (await db.query('SELECT * FROM scheduled_event_guests WHERE event_id = $1', [id])).rows.map((g) => ({ ...g, user_id: String(g.user_id) }));
      const { added } = mergeGuests(rows, want, me); // never twice, never the host
      for (const gid of added) await db.query(`INSERT INTO scheduled_event_guests (event_id,user_id) VALUES ($1,$2) ON CONFLICT (event_id,user_id) DO UPDATE SET invitation_status='pending', approved=false, updated_at=now()`, [id, gid]);
      const host = await nameOf(db, me);
      for (const gid of added) await notify(db, gid, 'event:invite', `${host} invited you to “${cur.title}”`, id);
      return added;
    });
    changed([me, ...out]);
    res.json({ data: { ...(await load(pool, 'e.id = $1', id, me)), added: out } });
  }));

  r.delete('/:eventId/guests/:userId', asyncH(async (req, res) => {
    const id = idOf(req.params.eventId); const uid = idOf(req.params.userId);
    const cur = await load(pool, 'e.id = $1', id, req.user.id); hostOnly(cur);
    const { rowCount } = await pool.query(`UPDATE scheduled_event_guests SET invitation_status='removed', updated_at=now() WHERE event_id=$1 AND user_id=$2 AND invitation_status <> 'removed'`, [id, uid]);
    if (!rowCount) throw HttpError(404, 'That person is not invited');
    changed([req.user.id, uid]);
    res.json({ data: await load(pool, 'e.id = $1', id, req.user.id) });
  }));

  // POST /:eventId/respond { status: accepted | declined } - invited guests, and people who opened the invitation link
  r.post('/:eventId/respond', asyncH(async (req, res) => {
    const id = idOf(req.params.eventId); const me = req.user.id; const status = req.body.status;
    if (!['accepted', 'declined'].includes(status)) throw HttpError(400, 'Choose accept or decline');
    const host = await tx(async (db) => {
      const cur = await load(db, 'e.id = $1', id, me);
      if (cur.me.host) throw HttpError(400, 'You are the host of this event');
      openOnly(cur);
      const { rows } = await db.query('SELECT invitation_status FROM scheduled_event_guests WHERE event_id=$1 AND user_id=$2', [id, me]);
      if (rows[0]?.invitation_status === 'removed') throw HttpError(403, 'You are no longer invited to this call');
      await db.query(`INSERT INTO scheduled_event_guests (event_id,user_id,invitation_status,via_link) VALUES ($1,$2,$3,$4)
        ON CONFLICT (event_id,user_id) DO UPDATE SET invitation_status = EXCLUDED.invitation_status, updated_at = now()`, [id, me, status, !rows[0]]);
      const ev = (await db.query('SELECT * FROM scheduled_events WHERE id = $1', [id])).rows[0];
      if (status === 'accepted') await setReminder(db, ev, me); else await db.query('DELETE FROM event_reminders WHERE event_id=$1 AND user_id=$2', [id, me]);
      await notify(db, cur.host_user_id, 'event:response', `${await nameOf(db, me)} ${status} “${cur.title}”`, id);
      return cur.host_user_id;
    });
    changed([me, host]);
    res.json({ data: await load(pool, 'e.id = $1', id, me) });
  }));

  r.get('/:eventId/participants', asyncH(async (req, res) => {
    const ev = await load(pool, 'e.id = $1', idOf(req.params.eventId), req.user.id);
    if (!ev.me.host && !ev.me.status) throw HttpError(403, 'You are not invited to this call');
    res.json({ data: {
      going: [{ ...ev.host, creator: true }, ...ev.guests.filter((g) => g.invitation_status === 'accepted')],
      not_responded: ev.guests.filter((g) => g.invitation_status === 'pending'),
      declined: ev.guests.filter((g) => g.invitation_status === 'declined'),
      requests: ev.me.host ? ev.guests.filter((g) => g.join_requested) : [],
    } });
  }));

  // POST /:eventId/join - the authorisation step before the room. Checks: event exists, not cancelled/ended, invited, window open, approval.
  r.post('/:eventId/join', asyncH(async (req, res) => {
    const id = idOf(req.params.eventId); const me = req.user.id;
    const ev = await load(pool, 'e.id = $1', id, me);
    if (!ev.join.ok) throw HttpError(ev.join.early ? 425 : 403, ev.join.reason);
    if (ev.join.needsApproval) {
      const { rows } = await pool.query(`UPDATE scheduled_event_guests SET join_requested = true, updated_at = now() WHERE event_id=$1 AND user_id=$2 AND join_requested = false RETURNING 1`, [id, me]);
      if (rows.length) { await notify(pool, ev.host_user_id, 'event:request', `${await nameOf(pool, me)} asked to join “${ev.title}”`, id); changed([ev.host_user_id]); }
      return res.json({ data: { status: 'pending', event: ev } });
    }
    if (!ev.me.host) await pool.query(`UPDATE scheduled_event_guests SET joined_at = now(), join_requested = false WHERE event_id=$1 AND user_id=$2`, [id, me]);
    res.json({ data: { status: 'ok', room: { meeting_id: ev.meeting_id, call_type: ev.call_type, title: ev.title }, event: ev } });
  }));
  r.post('/:eventId/leave', asyncH(async (req, res) => {
    await pool.query(`UPDATE scheduled_event_guests SET left_at = now() WHERE event_id=$1 AND user_id=$2`, [idOf(req.params.eventId), req.user.id]);
    res.json({ data: { ok: true } });
  }));

  // POST /:eventId/requests/:userId { approve } - host lets a guest in (or not)
  r.post('/:eventId/requests/:userId', asyncH(async (req, res) => {
    const id = idOf(req.params.eventId); const uid = idOf(req.params.userId);
    const cur = await load(pool, 'e.id = $1', id, req.user.id); hostOnly(cur);
    const approve = !!req.body.approve;
    const { rowCount } = await pool.query(`UPDATE scheduled_event_guests SET approved=$3, join_requested=false, updated_at=now() WHERE event_id=$1 AND user_id=$2 AND join_requested`, [id, uid, approve]);
    if (!rowCount) throw HttpError(404, 'There is no join request from that person');
    if (approve) notifyUsers([uid], 'callevent:join_approved', { event_id: id });
    changed([req.user.id, uid]);
    res.json({ data: await load(pool, 'e.id = $1', id, req.user.id) });
  }));

  // POST /:eventId/reminders { minutes } - my own reminder for this event (hosts change the default by editing the event)
  r.post('/:eventId/reminders', asyncH(async (req, res) => {
    const id = idOf(req.params.eventId); const me = req.user.id; const minutes = Number(req.body.minutes);
    if (![0, 5, 15, 30, 60, 1440].includes(minutes)) throw HttpError(400, 'Choose a valid reminder');
    const ev = await load(pool, 'e.id = $1', id, me); openOnly(ev);
    if (!ev.me.host && ev.me.status !== 'accepted') throw HttpError(403, 'Accept the invitation first');
    await setReminder(pool, { id, start_datetime: ev.start_datetime, reminder_minutes: minutes }, me);
    res.json({ data: { ok: true, reminder: reminderLabel(minutes) } });
  }));

  // eslint-disable-next-line no-unused-vars
  r.use((err, _req, res, _next) => { if (!err.status) console.error('[call-events]', err); res.status(err.status || 500).json({ message: err.status ? err.message : 'Something went wrong' }); });
  return r;
}
