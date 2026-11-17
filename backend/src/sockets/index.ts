import type { Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { z } from 'zod';
import { corsOrigins, env } from '../config/env';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { addSocket, onlineSet, removeSocket, touch } from '../lib/presence';
import { convRoom, emitToUser, emitToUsers, setIo, userRoom } from '../lib/realtime';
import { redis } from '../lib/redis';
import { authenticate, AuthUser } from '../middleware/auth';
import { answerCall, closeCall, signalPeers } from '../modules/calls';
import { markDeliveredFor, markRead } from '../modules/chat';
import { verifyPrivateToken } from '../modules/private';

interface Ctx { user: AuthUser; token: string; buckets: Map<string, { n: number; t: number }> }
const ctxOf = (s: Socket) => s.data.ctx as Ctx;

/** Tiny per-socket token bucket: `limit` events per `windowMs`. Excess events are dropped silently (typing) or refused (signalling). */
function allow(s: Socket, key: string, limit: number, windowMs: number) {
  const b = ctxOf(s).buckets; const now = Date.now(); const e = b.get(key);
  if (!e || now - e.t > windowMs) { b.set(key, { n: 1, t: now }); return true; }
  return ++e.n <= limit;
}
type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
const ack = (cb: unknown): Ack => (typeof cb === 'function' ? (cb as Ack) : () => {});
const fail = (cb: Ack, error: string) => cb({ ok: false, error });
const idSchema = z.object({ conversationId: z.string().uuid(), privateToken: z.string().max(2000).optional() });
const callIdSchema = z.object({ callId: z.string().uuid() });
const signalSchema = z.object({ callId: z.string().uuid(), type: z.enum(['offer', 'answer', 'candidate', 'renegotiate', 'media']), data: z.unknown() });

export function initSockets(http: HttpServer) {
  const io = new Server(http, {
    cors: { origin: corsOrigins, credentials: true },
    maxHttpBufferSize: 64 * 1024, // signalling and typing only; media travels over HTTP
    pingInterval: 25_000, pingTimeout: 20_000,
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: false },
  });
  if (redis) {
    try { const sub = redis.duplicate(); io.adapter(createAdapter(redis, sub)); } catch (e: any) { logger.warn({ err: e.message }, 'socket.io redis adapter unavailable, single-instance mode'); }
  }
  setIo(io);

  // Authentication happens in the handshake, with the same session check as HTTP (revoked / suspended -> refused).
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token ?? (socket.handshake.headers.authorization || '').replace(/^Bearer /, '');
      if (!raw || typeof raw !== 'string') return next(new Error('unauthorized'));
      socket.data.ctx = { user: await authenticate(raw), token: raw, buckets: new Map() } as Ctx;
      next();
    } catch (e: any) { next(new Error(e?.code === 'account_inactive' ? 'account_inactive' : 'unauthorized')); }
  });

  io.on('connection', async (socket) => {
    const { user } = ctxOf(socket);
    socket.join(userRoom(user.id));
    // a revoked session (logout elsewhere, suspension, password change) drops the socket within a minute
    const guard = setInterval(async () => {
      void touch(user.id);
      const s = await prisma.userSession.findUnique({ where: { id: user.sessionId }, select: { revokedAt: true, expiresAt: true, user: { select: { status: true } } } }).catch(() => undefined);
      if (s === null || (s && (s.revokedAt || s.expiresAt < new Date() || s.user.status !== 'ACTIVE'))) { socket.emit('session:revoked', {}); socket.disconnect(true); }
    }, 60_000);
    guard.unref();

    // ── rooms: only conversations you are a member of; Private Space chats need a valid unlock token
    socket.on('conversation:join', async (raw: unknown, cb?: unknown) => {
      const a = ack(cb);
      try {
        const p = idSchema.safeParse(raw); if (!p.success) return fail(a, 'Invalid conversation');
        if (!allow(socket, 'join', 60, 60_000)) return fail(a, 'Slow down');
        const m = await prisma.conversationMember.findFirst({ where: { conversationId: p.data.conversationId, userId: user.id, leftAt: null }, select: { userId: true } });
        if (!m) return fail(a, 'Conversation not found');
        const locked = await prisma.privateChat.findUnique({ where: { userId_conversationId: { userId: user.id, conversationId: p.data.conversationId } } });
        if (locked && !verifyPrivateToken(p.data.privateToken, user.id, user.sessionId)) return fail(a, 'locked');
        await socket.join(convRoom(p.data.conversationId));
        a({ ok: true });
      } catch (e: any) { logger.warn({ err: e.message }, 'conversation:join'); fail(a, 'Could not join'); }
    });
    socket.on('conversation:leave', (raw: unknown, cb?: unknown) => {
      const p = idSchema.safeParse(raw); if (p.success) socket.leave(convRoom(p.data.conversationId));
      ack(cb)({ ok: true });
    });

    // ── typing: relayed only to people already in the room (so membership was verified at join)
    const typing = (on: boolean) => async (raw: unknown) => {
      const p = idSchema.safeParse(raw); if (!p.success) return;
      if (!socket.rooms.has(convRoom(p.data.conversationId))) return;
      if (on && !allow(socket, 'typing', 10, 10_000)) return;
      socket.to(convRoom(p.data.conversationId)).emit('typing', { conversationId: p.data.conversationId, userId: user.id, typing: on });
    };
    socket.on('typing:start', typing(true));
    socket.on('typing:stop', typing(false));

    socket.on('message:read', async (raw: unknown, cb?: unknown) => {
      const a = ack(cb);
      try {
        const p = idSchema.safeParse(raw); if (!p.success) return fail(a, 'Invalid conversation');
        if (!socket.rooms.has(convRoom(p.data.conversationId))) return fail(a, 'Join the conversation first'); // also enforces the private lock
        if (!allow(socket, 'read', 30, 10_000)) return fail(a, 'Slow down');
        const r = await markRead(user.id, p.data.conversationId); a({ ok: true, count: r.ids.length });
      } catch { fail(a, 'Could not mark as read'); }
    });

    // ── presence: respects the other person's "show online status" setting
    socket.on('presence:get', async (raw: unknown, cb?: unknown) => {
      const a = ack(cb);
      const p = z.object({ userIds: z.array(z.string().uuid()).max(100) }).safeParse(raw); if (!p.success) return fail(a, 'Invalid request');
      if (!allow(socket, 'presence', 20, 60_000)) return fail(a, 'Slow down');
      const hidden = new Set((await prisma.userSettings.findMany({ where: { userId: { in: p.data.userIds }, showOnlineStatus: false }, select: { userId: true } })).map((x) => x.userId));
      const blocks = await prisma.blockedUser.findMany({ where: { OR: [{ blockerId: user.id, blockedId: { in: p.data.userIds } }, { blockedId: user.id, blockerId: { in: p.data.userIds } }] }, select: { blockerId: true, blockedId: true } });
      const blocked = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
      const visible = p.data.userIds.filter((id) => !hidden.has(id) && !blocked.has(id));
      const on = await onlineSet(visible);
      a({ ok: true, online: visible.filter((id) => on.has(id)) });
    });

    // ── WebRTC signalling. The server never inspects SDP/ICE; it only checks that the call is live and you are in it.
    socket.on('call:answer', async (raw: unknown, cb?: unknown) => {
      const a = ack(cb);
      try { const p = callIdSchema.safeParse(raw); if (!p.success) return fail(a, 'Invalid call'); await answerCall(p.data.callId, user.id); a({ ok: true }); }
      catch (e: any) { fail(a, e.message || 'Could not answer'); }
    });
    for (const [ev, reason] of [['call:reject', 'rejected'], ['call:end', 'hangup'], ['call:busy', 'busy'], ['call:failed', 'failed']] as const) {
      socket.on(ev, async (raw: unknown, cb?: unknown) => {
        const a = ack(cb);
        try { const p = callIdSchema.safeParse(raw); if (!p.success) return fail(a, 'Invalid call'); await closeCall(p.data.callId, user.id, reason); a({ ok: true }); }
        catch (e: any) { fail(a, e.message || 'Could not end the call'); }
      });
    }
    socket.on('call:signal', async (raw: unknown, cb?: unknown) => {
      const a = ack(cb);
      try {
        const p = signalSchema.safeParse(raw); if (!p.success) return fail(a, 'Invalid signal');
        if (JSON.stringify(p.data.data ?? null).length > 32_000) return fail(a, 'Signal too large');
        if (!allow(socket, 'signal', 120, 10_000)) return fail(a, 'Slow down');
        const peers = await signalPeers(p.data.callId, user.id);
        if (!peers.length) return fail(a, 'This call is not active');
        emitToUsers(peers, 'call:signal', { callId: p.data.callId, from: user.id, type: p.data.type, data: p.data.data });
        a({ ok: true });
      } catch { fail(a, 'Signalling failed'); }
    });

    socket.on('disconnect', async () => {
      clearInterval(guard);
      const last = await removeSocket(user.id, socket.id);
      if (!last) return;
      void prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
      void broadcastPresence(user.id, false);
      // dropping off in the middle of a call hangs it up after a short grace period (the app may just be reconnecting)
      setTimeout(async () => {
        if ((await onlineSet([user.id])).has(user.id)) return;
        const live = await prisma.call.findMany({ where: { status: { in: ['RINGING', 'ONGOING'] }, participants: { some: { userId: user.id, leftAt: null } } }, select: { id: true, status: true, callerId: true } });
        for (const c of live) if (c.status === 'ONGOING' || c.callerId === user.id) await closeCall(c.id, user.id, 'failed').catch(() => {});
      }, 15_000).unref();
    });
    // Listeners above are all registered synchronously: nothing awaited before them, or early client events would be lost.
    void (async () => {
      const first = (await onlineSet([user.id])).has(user.id) === false;
      await addSocket(user.id, socket.id);
      void prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
      void markDeliveredFor(user.id).catch((e) => logger.warn({ err: e.message }, 'markDeliveredFor failed'));
      if (first) void broadcastPresence(user.id, true);
    })();

  });

  logger.info({ redisAdapter: !!redis }, 'socket.io ready');
  return io;
}

/** Tell people who chat with this user directly that they came online / went offline (if the user shares presence). */
async function broadcastPresence(userId: string, online: boolean) {
  try {
    const s = await prisma.userSettings.findUnique({ where: { userId }, select: { showOnlineStatus: true, showLastSeen: true } });
    if (s && !s.showOnlineStatus) return;
    const peers = await prisma.conversationMember.findMany({ where: { leftAt: null, conversation: { type: 'DIRECT', members: { some: { userId, leftAt: null } } }, userId: { not: userId } }, select: { userId: true }, take: 500 });
    const ids = peers.map((p) => p.userId);
    if (!ids.length) return;
    const blocked = await prisma.blockedUser.findMany({ where: { OR: [{ blockerId: userId, blockedId: { in: ids } }, { blockedId: userId, blockerId: { in: ids } }] }, select: { blockerId: true, blockedId: true } });
    const hide = new Set(blocked.flatMap((b) => [b.blockerId, b.blockedId]));
    const payload = { userId, online, lastSeenAt: s?.showLastSeen === false ? null : new Date().toISOString() };
    for (const id of ids) if (!hide.has(id)) emitToUser(id, 'presence:update', payload);
  } catch (e: any) { logger.debug({ err: e.message }, 'presence broadcast failed'); }
}
void env;
