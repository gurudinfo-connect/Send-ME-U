import { redis } from './redis';

// Presence = set of live socket ids per user. Redis when available (multi-instance), memory otherwise.
const mem = new Map<string, Set<string>>();
const key = (u: string) => `presence:${u}`;
const TTL = 120;

export async function addSocket(userId: string, sid: string) {
  if (redis) { try { await redis.sadd(key(userId), sid); await redis.expire(key(userId), TTL); return; } catch { /* fall through */ } }
  (mem.get(userId) ?? mem.set(userId, new Set()).get(userId)!).add(sid);
}
export async function removeSocket(userId: string, sid: string): Promise<boolean> {
  if (redis) { try { await redis.srem(key(userId), sid); return (await redis.scard(key(userId))) === 0; } catch { /* fall through */ } }
  const s = mem.get(userId); s?.delete(sid); if (s && !s.size) mem.delete(userId); return !s || s.size === 0;
}
export async function touch(userId: string) { if (redis) { try { await redis.expire(key(userId), TTL); } catch { /* ignore */ } } }
export async function isOnline(userId: string) {
  if (redis) { try { return (await redis.scard(key(userId))) > 0; } catch { /* fall through */ } }
  return (mem.get(userId)?.size ?? 0) > 0;
}
export async function onlineSet(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all([...new Set(ids)].map(async (id) => { if (await isOnline(id)) out.add(id); }));
  return out;
}
