import { io } from 'socket.io-client';
import { tokenStore, USE_MOCK } from './api';
import { coupleBus } from './coupleService';
import { callEventBus } from '../callEvents/eventService';

const URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
let socket = null;

export function connectSocket() {
  if (USE_MOCK || socket?.connected) return socket;
  socket = io(URL, { auth: { token: tokenStore.get() }, transports: ['websocket'], reconnection: true });
  return socket;
}
export const getSocket = () => socket;
export function disconnectSocket() { socket?.disconnect(); socket = null; }

// Events: message:new, message:status, typing:start, typing:stop, message:reaction
export const emitTyping = (cid, on) => socket?.emit(on ? 'typing:start' : 'typing:stop', { conversationId: cid });
export const joinRoom = (cid) => socket?.emit('conversation:join', { conversationId: cid });
export const leaveRoom = (cid) => socket?.emit('conversation:leave', { conversationId: cid });

// Couple events. Demo mode listens to the local bus; a real server emits the same names into the couple's private room.
export const COUPLE_EVENTS = ['appointment:created', 'appointment:updated', 'appointment:cancelled', 'availability:updated',
  'location:started', 'location:update', 'location:stopped', 'location:request', 'notification:new'];
export function subscribeCouple(handler) {
  if (USE_MOCK) {
    const f = (e) => handler(e.detail.name, e.detail.payload);
    coupleBus.addEventListener('couple:event', f);
    return () => coupleBus.removeEventListener('couple:event', f);
  }
  const s = connectSocket(); if (!s) return () => {};
  const subs = COUPLE_EVENTS.map((n) => { const h = (p) => handler(n, p); s.on(n, h); return [n, h]; });
  const onConnect = () => handler('socket:reconnected', {}); // refetch after a dropped connection
  s.io.on('reconnect', onConnect);
  return () => { subs.forEach(([n, h]) => s.off(n, h)); s.io.off('reconnect', onConnect); };
}

// Scheduled-call events. Handler names: notification:new {text,kind,event_id} | events:changed | join:approved {event_id}.
// Demo mode listens to the local bus; the real server emits notification:new, callevent:changed and callevent:join_approved to the user's room.
export function subscribeCallEvents(handler) {
  if (USE_MOCK) {
    const f = (e) => handler(e.detail.name, e.detail.payload);
    callEventBus.addEventListener('callevent', f);
    return () => callEventBus.removeEventListener('callevent', f);
  }
  const s = connectSocket(); if (!s) return () => {};
  const map = { 'notification:new': 'notification:new', 'callevent:changed': 'events:changed', 'callevent:join_approved': 'join:approved' };
  const subs = Object.entries(map).map(([n, out]) => { const h = (p) => handler(out, p); s.on(n, h); return [n, h]; });
  return () => subs.forEach(([n, h]) => s.off(n, h));
}
