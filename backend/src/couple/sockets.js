// Socket.IO side of the couple features. Clients connect with { auth: { token } } (same as chat, see src/services/socket.js).
//
//   const { io, notifyUsers } = attachCoupleSockets(httpServer, { verifyToken, pool, corsOrigin });
//   app.use('/api/v1/couple', coupleRouter({ pool, auth, notifyUsers }));
//
// Each connected user joins a private room "user:<id>". Events are sent to specific users only: a private appointment never
// reaches the partner's room, and location events carry no coordinates (the partner re-fetches through the authorised REST call).
import { Server } from 'socket.io';

export const COUPLE_EVENTS = ['appointment:created', 'appointment:updated', 'appointment:cancelled', 'availability:updated',
  'location:started', 'location:update', 'location:stopped', 'location:request', 'notification:new'];

export function attachCoupleSockets(httpServer, { verifyToken, pool, corsOrigin, existingIo = null }) {
  const io = existingIo || new Server(httpServer, { cors: { origin: corsOrigin, credentials: true } });

  io.use(async (socket, next) => {
    try {
      const user = await verifyToken(socket.handshake.auth?.token);   // must throw / return null for a bad or expired token
      if (!user?.id) return next(new Error('unauthorized'));
      socket.data.userId = String(user.id);
      next();
    } catch { next(new Error('unauthorized')); }
  });
  io.on('connection', (socket) => { socket.join(`user:${socket.data.userId}`); });

  const notifyUsers = (userIds, event, payload = {}) => {
    for (const id of new Set(userIds.filter(Boolean).map(String))) io.to(`user:${id}`).emit(event, payload);
  };

  // Housekeeping: end sessions that ran out and delete positions. Reads enforce expiry too, so this only keeps the table tidy
  // and tells both partners promptly. Wrap in a leader lock if you run several server instances (pg_try_advisory_lock).
  const timer = setInterval(async () => {
    try {
      const { rows } = await pool.query('SELECT * FROM end_expired_location_sessions()');
      for (const r of rows) {
        const { rows: c } = await pool.query('SELECT user_a, user_b FROM couples WHERE id = $1', [r.couple_id]);
        if (c[0]) notifyUsers([c[0].user_a, c[0].user_b], 'location:stopped', { reason: 'expired' });
      }
    } catch (e) { console.error('[couple] janitor failed', e.message); }
  }, 60_000);
  timer.unref?.();

  return { io, notifyUsers, close: () => clearInterval(timer) };
}
