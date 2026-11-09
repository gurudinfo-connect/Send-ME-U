// Socket.IO side of scheduled calls. Reuses the io instance and per-user rooms from backend/src/couple/sockets.js:
//   const { io, notifyUsers } = attachCoupleSockets(httpServer, { verifyToken, pool, corsOrigin });
//   attachCallEventSockets(io, { pool });
//   app.use('/api/v1/call-events', callEventsRouter({ pool, auth, notifyUsers }));
//
// Room signalling (WebRTC): clients emit  room:join {meetingId}  (ack {ok,message})  then  room:signal {meetingId, type, from, to?, ...}.
// The server only RELAYS those messages to the other people in "room:<meetingId>"; audio and video go peer-to-peer, never through the server.
// A socket may enter a room only if the same rules as POST /:eventId/join allow this user in right now (invited, window open, approved).
import { joinDecision } from '../../../src/callEvents/logic.js';

export function attachCallEventSockets(io, { pool, reminderEveryMs = 30_000 }) {
  const canEnter = async (userId, meetingId) => {
    if (!/^[a-z0-9]{10,40}$/.test(String(meetingId))) return { ok: false, message: 'Invalid room' };
    const { rows } = await pool.query(
      `SELECT e.*, g.invitation_status, g.approved FROM scheduled_events e
         LEFT JOIN scheduled_event_guests g ON g.event_id = e.id AND g.user_id = $2 WHERE e.meeting_id = $1`, [meetingId, userId]);
    const e = rows[0]; if (!e) return { ok: false, message: 'This call does not exist' };
    const d = joinDecision({ ...e, start_datetime: new Date(e.start_datetime).toISOString(), end_datetime: new Date(e.end_datetime).toISOString() }, userId,
      e.invitation_status ? { invitation_status: e.invitation_status, approved: e.approved } : undefined);
    if (!d.ok) return { ok: false, message: d.reason };
    if (d.needsApproval) return { ok: false, message: 'The host has not let you in yet' };
    return { ok: true };
  };

  io.on('connection', (socket) => {
    const uid = socket.data.userId;
    socket.on('room:join', async ({ meetingId } = {}, ack = () => {}) => {
      try {
        const res = await canEnter(uid, meetingId);
        if (res.ok) socket.join(`room:${meetingId}`);
        ack(res);
      } catch (e) { console.error('[room:join]', e.message); ack({ ok: false, message: 'Could not join the call' }); }
    });
    socket.on('room:signal', ({ meetingId, ...msg } = {}) => {
      if (!socket.rooms.has(`room:${meetingId}`)) return;           // not admitted: drop silently
      if (JSON.stringify(msg).length > 20_000) return;               // SDP is a few KB; refuse anything silly
      if (typeof msg.from === 'string') socket.data.peerId = msg.from; // lets us announce a clean 'bye' if the tab just disappears
      socket.to(`room:${meetingId}`).emit('room:signal', msg);
    });
    const leave = ({ meetingId } = {}) => { if (socket.rooms.has(`room:${meetingId}`)) { socket.to(`room:${meetingId}`).emit('room:signal', { type: 'bye', from: socket.data.peerId }); socket.leave(`room:${meetingId}`); } };
    socket.on('room:leave', leave);
    socket.on('disconnecting', () => { for (const r of socket.rooms) if (r.startsWith('room:')) leave({ meetingId: r.slice(5) }); });
  });

  // Reminder scheduler: claims due reminders atomically (safe with several server instances), records a notification and pushes it.
  const tick = async () => {
    try {
      const { rows } = await pool.query(
        `WITH due AS (SELECT r.id FROM event_reminders r JOIN scheduled_events e ON e.id = r.event_id
            WHERE r.delivery_status = 'pending' AND r.reminder_datetime <= now() ORDER BY r.reminder_datetime LIMIT 200 FOR UPDATE OF r SKIP LOCKED)
         UPDATE event_reminders r SET delivery_status = CASE WHEN e.status = 'scheduled' AND e.start_datetime > now() THEN 'sent' ELSE 'skipped' END
           FROM due, scheduled_events e WHERE r.id = due.id AND e.id = r.event_id
         RETURNING r.user_id, r.delivery_status, e.id AS event_id, e.title, e.reminder_minutes`);
      for (const x of rows.filter((y) => y.delivery_status === 'sent')) {
        const text = `Starting soon: “${x.title}”`;
        await pool.query(`INSERT INTO call_event_notifications (user_id, event_id, kind, text) VALUES ($1,$2,'event:reminder',$3)`, [x.user_id, x.event_id, text]);
        io.to(`user:${x.user_id}`).emit('notification:new', { kind: 'event:reminder', text, event_id: String(x.event_id) });
        io.to(`user:${x.user_id}`).emit('callevent:changed', {});
      }
    } catch (e) { console.error('[call-events] reminder tick failed', e.message); }
  };
  const timer = setInterval(tick, reminderEveryMs); timer.unref?.();
  return { close: () => clearInterval(timer), tick };
}
