import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as client, Socket } from 'socket.io-client';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/db';
import { redis } from '../src/lib/redis';
import { initSockets } from '../src/sockets';

process.env.NODE_ENV = 'test';
export const PASSWORD = 'Str0ng!Passw0rd';
let server: http.Server; let ioServer: ReturnType<typeof initSockets>; export let base = '';
export async function boot() {
  server = http.createServer(createApp()); ioServer = initSockets(server);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
export async function shutdown() { await ioServer.close(); server.closeAllConnections?.(); await prisma.$disconnect(); redis?.disconnect(); }

export interface Res<T = any> { status: number; body: T; headers: Headers }
export async function api<T = any>(method: string, path: string, token?: string | null, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> {
  const isForm = body instanceof FormData;
  const r = await fetch(`${base}/api/v1${path}`, { method, headers: { ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  const text = await r.text(); let parsed: any = text; try { parsed = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: parsed, headers: r.headers };
}
let n = 0;
export interface TUser { id: string; token: string; refreshToken: string; username: string; email: string }
export async function makeUser(label = 'u'): Promise<TUser> {
  const tag = `${label}${Date.now().toString(36)}${(n++).toString(36)}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const email = `${tag}@example.com`;
  const r = await api('POST', '/auth/register', null, { fullName: `Test ${label}`, username: tag, email, password: PASSWORD });
  if (r.status !== 201 && r.status !== 200) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
  return { id: r.body.user.id, token: r.body.accessToken, refreshToken: r.body.refreshToken, username: tag, email };
}
export const png = () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
export function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = client(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s)); s.on('connect_error', (e) => reject(e));
  });
}
export const once = <T = any>(s: Socket, ev: string, ms = 4000) => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms); s.once(ev, (d: T) => { clearTimeout(t); res(d); }); });
export const emitAck = <T = any>(s: Socket, ev: string, data: unknown) => new Promise<T>((res) => s.emit(ev, data, res));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
