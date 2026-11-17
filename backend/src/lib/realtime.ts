import type { Server } from 'socket.io';

let io: Server | null = null;
export const setIo = (s: Server) => { io = s; };
export const getIo = () => io;
export const userRoom = (id: string) => `user:${id}`;
export const convRoom = (id: string) => `conv:${id}`;
export const emitToUser = (userId: string, event: string, payload: unknown) => { io?.to(userRoom(userId)).emit(event, payload); };
export const emitToUsers = (ids: string[], event: string, payload: unknown) => { for (const id of new Set(ids)) emitToUser(id, event, payload); };
export const emitToConversation = (convId: string, event: string, payload: unknown) => { io?.to(convRoom(convId)).emit(event, payload); };
