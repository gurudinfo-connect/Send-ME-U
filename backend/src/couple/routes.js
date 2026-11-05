// Express routes for the couple calendar, shared availability and live location. Mount at /api/v1/couple.
//   app.use('/api/v1/couple', coupleRouter({ pool, auth, notifyUsers }));
// `auth` must set req.user.id from a verified token. `notifyUsers(userIds, event, payload)` pushes a Socket.IO event (see sockets.js).
// The booking/overlap/privacy rules are the SAME pure functions the frontend demo uses (src/couple/*.js).
import express from 'express';
import { validateRange, checkBooking, checkPersonal, mutualAvailability, busyFor, availableFor, viewAppointment, apptLabel, ms, iso } from '../../../src/couple/scheduling.js';
import { expiryFor, sessionActive, visibleLocation, validCoords } from '../../../src/couple/location.js';

const HttpError = (status, code, message) => Object.assign(new Error(message), { status, code });
const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function coupleRouter({ pool, auth, notifyUsers = () => {} }) {
  const r = express.Router();
  r.use(express.json({ limit: '10kb' }));
  r.use(auth);

  // Every request is scoped to the caller's own active couple. There is no couple id in any URL, so nobody can ask for another couple's data.
  r.use(asyncH(async (req, _res, next) => {
    const { rows } = await pool.query(
      `SELECT id, user_a, user_b FROM couples WHERE (user_a = $1 OR user_b = $1) AND COALESCE(status, 'active') = 'active' LIMIT 1`, [req.user.id]);
    if (!rows[0]) throw HttpError(403, 'not_linked', 'Link your partner first');
    const c = rows[0];
    req.couple = { id: c.id, me: String(req.user.id), partner: String(c.user_a) === String(req.user.id) ? String(c.user_b) : String(c.user_a) };
    next();
  }));

  // Serialises all writes of one couple, so two simultaneous bookings are checked one after the other. The exclusion constraints are the second line of defence.
  const withCoupleLock = async (coupleId, fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`couple:${coupleId}`]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.code === '23P01') throw HttpError(409, 'overlap', 'That time was just taken. Pick another slot.'); // exclusion_violation
      throw e;
    } finally { client.release(); }
  };

  const note = async (db, req, kind, text) => {
    await db.query(`INSERT INTO couple_notifications (user_id, couple_id, kind, text) VALUES ($1, $2, $3, $4)`, [req.couple.partner, req.couple.id, kind, text]);
    notifyUsers([req.couple.partner], 'notification:new', { kind, text });
  };
  const nameOf = async (db, id) => (await db.query(`SELECT COALESCE(NULLIF(split_part(name, ' ', 1), ''), 'Your partner') AS n FROM users WHERE id = $1`, [id])).rows[0]?.n ?? 'Your partner';

  const apptsIn = (db, coupleId, from, to) => db.query(
    `SELECT * FROM appointments WHERE couple_id = $1 AND status = 'confirmed' AND start_time < $3 AND end_time > $2 ORDER BY start_time`, [coupleId, from, to]).then((x) => x.rows);
  const availIn = (db, coupleId, from, to) => db.query(
    `SELECT * FROM availability WHERE couple_id = $1 AND start_time < $3 AND end_time > $2`, [coupleId, from, to]).then((x) => x.rows);
  const range = (q) => {
    const from = q.from ? new Date(q.from) : null, to = q.to ? new Date(q.to) : null;
    if (!from || !to || Number.isNaN(+from) || Number.isNaN(+to) || to <= from || to - from > 62 * 864e5) throw HttpError(400, 'bad_range', 'Send a valid from/to (at most 62 days)');
    return [from.toISOString(), to.toISOString()];
  };
  const out = (a, uid) => viewAppointment({ ...a, created_by: String(a.created_by), start_time: iso(a.start_time), end_time: iso(a.end_time) }, uid);

  // ------------------------------------------------------------ appointments
  r.get('/appointments', asyncH(async (req, res) => {
    const [from, to] = range(req.query);
    const rows = await apptsIn(pool, req.couple.id, from, to);
    res.json(rows.map((a) => out(a, req.couple.me)).filter(Boolean));   // partner's private rows are dropped, notes stripped for non-authors
  }));

  const fields = (b, existing = null) => {
    const visibility = b.visibility ? (b.visibility === 'private' ? 'private' : 'shared') : existing?.visibility || 'shared';
    const title = b.title !== undefined || !existing ? clean(b.title, 80) : existing.title;
    const location = b.location !== undefined || !existing ? clean(b.location, 120) : existing.location;
    if (!title) throw HttpError(400, 'title_required', 'Give it a name');
    if (visibility === 'shared' && !location) throw HttpError(400, 'location_required', 'Add a location so your partner knows where');
    const start = b.start_time ?? existing?.start_time, end = b.end_time ?? existing?.end_time;
    const v = validateRange(start, end, { now: Date.now() });
    if (!v.ok) throw HttpError(422, v.code, v.message);
    return { visibility, title, location, start: iso(start), end: iso(end) };
  };
  // The client's local-day window only decides which "available" declarations apply. That is a preference, not a security boundary:
  // busy time, private commitments and overlaps are always enforced regardless of the window.
  const windowOf = (b, start, end) => {
    const s = b.window?.start ? ms(b.window.start) : ms(start) - 12 * 36e5, e = b.window?.end ? ms(b.window.end) : ms(end) + 12 * 36e5;
    if (!(e > s) || e - s > 36e5 * 26 || s > ms(start) || e < ms(end)) throw HttpError(400, 'bad_window', 'Invalid planning window');
    return { start: s, end: e };
  };

  r.post('/appointments', asyncH(async (req, res) => {
    const f = fields(req.body);
    const created = await withCoupleLock(req.couple.id, async (db) => {
      const win = windowOf(req.body, f.start, f.end);
      const lo = new Date(Math.min(win.start, ms(f.start))).toISOString(), hi = new Date(Math.max(win.end, ms(f.end))).toISOString();
      const ctx = { appointments: await apptsIn(db, req.couple.id, lo, hi), availability: await availIn(db, req.couple.id, lo, hi) };
      const range_ = { start: ms(f.start), end: ms(f.end) };
      const verdict = f.visibility === 'shared'
        ? checkBooking({ range: range_, window: win, users: [req.couple.me, req.couple.partner], ...norm(ctx) })
        : checkPersonal({ range: range_, userId: req.couple.me, appointments: norm(ctx).appointments });
      if (!verdict.ok) throw HttpError(409, verdict.code, verdict.message);
      const { rows } = await db.query(
        `INSERT INTO appointments (couple_id, created_by, title, location, start_time, end_time, notes, visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.couple.id, req.couple.me, f.title, f.location, f.start, f.end, clean(req.body.notes, 500), f.visibility]);
      if (f.visibility === 'shared') await note(db, req, 'appointment', `${await nameOf(db, req.couple.me)} booked ${apptLabel(rows[0])}`);
      return rows[0];
    });
    notifyUsers([req.couple.me, ...(created.visibility === 'shared' ? [req.couple.partner] : [])], 'appointment:created', { id: created.id });
    res.status(201).json(out(created, req.couple.me));
  }));

  r.put('/appointments/:id', asyncH(async (req, res) => {
    const updated = await withCoupleLock(req.couple.id, async (db) => {
      const cur = (await db.query(`SELECT * FROM appointments WHERE id = $1 AND couple_id = $2 AND status = 'confirmed' FOR UPDATE`, [req.params.id, req.couple.id])).rows[0];
      if (!cur || out(cur, req.couple.me) === null) throw HttpError(404, 'not_found', 'That appointment no longer exists');
      if (req.body.rev != null && Number(req.body.rev) !== cur.rev) throw HttpError(409, 'stale', 'This was just changed. Showing the latest version.');
      const f = fields(req.body, cur);
      const win = windowOf(req.body, f.start, f.end);
      const lo = new Date(Math.min(win.start, ms(f.start))).toISOString(), hi = new Date(Math.max(win.end, ms(f.end))).toISOString();
      const ctx = norm({ appointments: await apptsIn(db, req.couple.id, lo, hi), availability: await availIn(db, req.couple.id, lo, hi) });
      const range_ = { start: ms(f.start), end: ms(f.end) };
      const verdict = f.visibility === 'shared'
        ? checkBooking({ range: range_, window: win, users: [req.couple.me, req.couple.partner], ignoreId: cur.id, ...ctx })
        : checkPersonal({ range: range_, userId: cur.created_by, ignoreId: cur.id, appointments: ctx.appointments });
      if (!verdict.ok) throw HttpError(409, verdict.code, verdict.message);
      const notes = String(cur.created_by) === req.couple.me && req.body.notes !== undefined ? clean(req.body.notes, 500) : cur.notes;   // notes stay with their author
      const { rows } = await db.query(
        `UPDATE appointments SET title=$3, location=$4, start_time=$5, end_time=$6, notes=$7, rev = rev + 1, updated_at = now() WHERE id=$1 AND couple_id=$2 RETURNING *`,
        [cur.id, req.couple.id, f.title, f.location, f.start, f.end, notes]);
      if (rows[0].visibility === 'shared') await note(db, req, 'appointment', `${await nameOf(db, req.couple.me)} changed ${apptLabel(rows[0])}`);
      return rows[0];
    });
    notifyUsers([req.couple.me, ...(updated.visibility === 'shared' ? [req.couple.partner] : [])], 'appointment:updated', { id: updated.id });
    res.json(out(updated, req.couple.me));
  }));

  r.delete('/appointments/:id', asyncH(async (req, res) => {
    const gone = await withCoupleLock(req.couple.id, async (db) => {
      const { rows } = await db.query(
        `UPDATE appointments SET status='cancelled', rev = rev + 1, updated_at = now()
          WHERE id = $1 AND couple_id = $2 AND status = 'confirmed' AND (visibility = 'shared' OR created_by = $3) RETURNING *`, [req.params.id, req.couple.id, req.couple.me]);
      if (!rows[0]) throw HttpError(404, 'not_found', 'That appointment no longer exists');
      if (rows[0].visibility === 'shared') await note(db, req, 'appointment', `${await nameOf(db, req.couple.me)} cancelled ${apptLabel(rows[0])}`);
      return rows[0];
    });
    notifyUsers([req.couple.me, ...(gone.visibility === 'shared' ? [req.couple.partner] : [])], 'appointment:cancelled', { id: gone.id });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ availability (own blocks only)
  const blockBody = (b) => {
    if (!['busy', 'available'].includes(b.availability_type)) throw HttpError(400, 'bad_type', 'Choose busy or available');
    const v = validateRange(b.start_time, b.end_time, { maxHours: 24 });
    if (!v.ok) throw HttpError(422, v.code, v.message);
    return [iso(b.start_time), iso(b.end_time), b.availability_type];
  };
  r.get('/availability', asyncH(async (req, res) => {
    const [from, to] = range(req.query);
    const { rows } = await pool.query(`SELECT * FROM availability WHERE user_id = $1 AND start_time < $3 AND end_time > $2 ORDER BY start_time`, [req.couple.me, from, to]);
    res.json(rows.map((x) => ({ ...x, start_time: iso(x.start_time), end_time: iso(x.end_time) })));
  }));
  r.post('/availability', asyncH(async (req, res) => {
    const [s, e, t] = blockBody(req.body);
    const { rows } = await pool.query(`INSERT INTO availability (user_id, couple_id, start_time, end_time, availability_type) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.couple.me, req.couple.id, s, e, t]);
    notifyUsers([req.couple.me, req.couple.partner], 'availability:updated', {});
    res.status(201).json(rows[0]);
  }));
  r.put('/availability/:id', asyncH(async (req, res) => {
    const [s, e, t] = blockBody(req.body);
    const { rows } = await pool.query(`UPDATE availability SET start_time=$3, end_time=$4, availability_type=$5, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`, [req.params.id, req.couple.me, s, e, t]);
    if (!rows[0]) throw HttpError(404, 'not_found', 'Block not found');
    notifyUsers([req.couple.me, req.couple.partner], 'availability:updated', {});
    res.json(rows[0]);
  }));
  r.delete('/availability/:id', asyncH(async (req, res) => {
    const { rowCount } = await pool.query(`DELETE FROM availability WHERE id=$1 AND user_id=$2`, [req.params.id, req.couple.me]);
    if (!rowCount) throw HttpError(404, 'not_found', 'Block not found');
    notifyUsers([req.couple.me, req.couple.partner], 'availability:updated', {});
    res.json({ ok: true });
  }));

  // Both people's free time and the overlap. Only free/busy shape is returned, never titles or notes.
  r.get('/slots', asyncH(async (req, res) => {
    const [from, to] = range(req.query);
    if (ms(to) - ms(from) > 36e5 * 26) throw HttpError(400, 'bad_range', 'Ask for one day at a time');
    const ctx = norm({ appointments: await apptsIn(pool, req.couple.id, from, to), availability: await availIn(pool, req.couple.id, from, to) });
    const ignoreId = req.query.ignoreId ? String(req.query.ignoreId) : null;
    const side = (u) => ({ available: availableFor(u, ctx.availability), busy: busyFor(u, { ...ctx, ignoreId }) });
    res.json(mutualAvailability({ from: ms(from), to: ms(to), slotMinutes: Number(req.query.minutes) || 30, notBefore: req.query.notBefore ? ms(req.query.notBefore) : null, me: side(req.couple.me), partner: side(req.couple.partner) }));
  }));

  // ------------------------------------------------------------ live location
  const sessionOf = async (db, uid) => (await db.query(`SELECT * FROM location_sharing_sessions WHERE user_id = $1 AND is_active`, [uid])).rows[0] || null;
  const locOf = async (db, uid) => (await db.query(`SELECT * FROM live_locations WHERE user_id = $1`, [uid])).rows[0] || null;
  const asLoc = (l) => l && ({ ...l, updated_at: iso(l.updated_at) });

  r.get('/location', asyncH(async (req, res) => {
    const { me, partner } = req.couple;
    for (const uid of [me, partner]) {            // reads enforce expiry themselves; the janitor is only housekeeping
      const s = await sessionOf(pool, uid), l = await locOf(pool, uid);
      if (s && !sessionActive(s, Date.now(), l?.updated_at)) { await pool.query(`UPDATE location_sharing_sessions SET is_active=FALSE, stopped_at=now() WHERE id=$1`, [s.id]); await pool.query(`DELETE FROM live_locations WHERE user_id=$1`, [uid]); }
    }
    const [mySession, myLoc, pSession, pLoc] = await Promise.all([sessionOf(pool, me), locOf(pool, me), sessionOf(pool, partner), locOf(pool, partner)]);
    res.json({
      session: mySession, me: asLoc(myLoc),
      partner: visibleLocation({ session: pSession, location: asLoc(pLoc) }),   // null unless the partner has an active session; flagged stale when old
      partnerSharing: sessionActive(pSession, Date.now(), pLoc?.updated_at),
      serverTime: new Date().toISOString(),
    });
  }));

  r.post('/location/session', asyncH(async (req, res) => {
    const exp = expiryFor(req.body.duration);
    if (exp === undefined) throw HttpError(400, 'bad_duration', 'Choose 15 minutes, 1 hour, 8 hours or until you turn it off');
    const session = await withCoupleLock(req.couple.id, async (db) => {
      await db.query(`UPDATE location_sharing_sessions SET is_active=FALSE, stopped_at=now() WHERE user_id=$1 AND is_active`, [req.couple.me]);
      const { rows } = await db.query(`INSERT INTO location_sharing_sessions (user_id, couple_id, expires_at) VALUES ($1,$2,$3) RETURNING *`, [req.couple.me, req.couple.id, exp]);
      await note(db, req, 'location', `${await nameOf(db, req.couple.me)} is sharing a live location with you`);
      return rows[0];
    });
    notifyUsers([req.couple.me, req.couple.partner], 'location:started', { expires_at: session.expires_at });
    res.status(201).json(session);
  }));

  r.delete('/location/session', asyncH(async (req, res) => {
    await pool.query(`UPDATE location_sharing_sessions SET is_active=FALSE, stopped_at=now() WHERE user_id=$1 AND is_active`, [req.couple.me]);
    await pool.query(`DELETE FROM live_locations WHERE user_id=$1`, [req.couple.me]);
    notifyUsers([req.couple.me, req.couple.partner], 'location:stopped', { reason: 'stopped' });
    res.json({ ok: true });
  }));

  r.put('/location', asyncH(async (req, res) => {
    const lat = Number(req.body.latitude), lng = Number(req.body.longitude), acc = req.body.accuracy == null ? null : Number(req.body.accuracy);
    if (!validCoords(lat, lng, acc)) throw HttpError(422, 'bad_coords', 'Those coordinates are not valid');
    const s = await sessionOf(pool, req.couple.me);
    if (!s || !sessionActive(s, Date.now(), (await locOf(pool, req.couple.me))?.updated_at)) throw HttpError(403, 'not_sharing', 'Location sharing is not turned on');
    // upsert, at most one write per 5 s per user (cheap rate limit)
    const { rows } = await pool.query(
      `INSERT INTO live_locations (user_id, couple_id, latitude, longitude, accuracy) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, accuracy = EXCLUDED.accuracy, updated_at = now()
       WHERE live_locations.updated_at < now() - interval '5 seconds' RETURNING *`, [req.couple.me, req.couple.id, lat, lng, acc]);
    if (!rows[0]) throw HttpError(429, 'too_fast', 'Slow down');
    notifyUsers([req.couple.partner], 'location:update', {});   // the partner re-fetches; coordinates never travel in the event
    res.json(asLoc(rows[0]));
  }));

  r.post('/location/request', asyncH(async (req, res) => {
    const { rows } = await pool.query(`SELECT 1 FROM couple_notifications WHERE user_id = $1 AND kind = 'location_request' AND created_at > now() - interval '10 minutes'`, [req.couple.partner]);
    if (rows[0]) throw HttpError(429, 'too_soon', 'You asked a moment ago. Give them a little time.');
    await note(pool, req, 'location_request', `${await nameOf(pool, req.couple.me)} asked if you can share your live location`);   // a request only; it never switches anything on
    notifyUsers([req.couple.partner], 'location:request', {});
    res.json({ sent: true });
  }));

  r.use((err, _req, res, _next) => {
    if (err.status) return res.status(err.status).json({ code: err.code, message: err.message });
    console.error('[couple]', err);
    res.status(500).json({ code: 'server_error', message: 'Something went wrong' });
  });
  return r;
}

// pg returns Date objects and bigint ids as strings; the shared rules compare ids and instants, so normalise once.
function norm({ appointments, availability }) {
  return {
    appointments: appointments.map((a) => ({ ...a, id: String(a.id), created_by: String(a.created_by), start_time: iso(a.start_time), end_time: iso(a.end_time) })),
    availability: availability.map((b) => ({ ...b, user_id: String(b.user_id), start_time: iso(b.start_time), end_time: iso(b.end_time) })),
  };
}
