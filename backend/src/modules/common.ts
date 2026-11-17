import { prisma, Tx } from '../lib/db';
import { toUrl } from '../lib/storage';

export const normEmail = (s: string) => s.trim().toLowerCase();
export const normPhone = (s: string) => { const t = s.replace(/[\s()-]/g, ''); return t.startsWith('00') ? `+${t.slice(2)}` : t; };
export const normUsername = (s: string) => s.trim().replace(/^@/, '').toLowerCase();
export const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s);
export const USERNAME_RE = /^[a-z0-9._]{3,30}$/;
export const RESERVED = new Set(['admin', 'administrator', 'support', 'help', 'sendmeu', 'send.me.u', 'root', 'system', 'moderator', 'official']);

export const userInclude = { profile: true } as const;

type UserWithProfile = { id: string; fullName: string; username: string; verified?: boolean; profile?: { avatarUrl?: string | null; avatarThumbUrl?: string | null; bio?: string } | null };
/** Minimal public card used in lists, chat headers, viewers, etc. */
export const card = (u: UserWithProfile) => ({
  id: u.id, name: u.fullName, handle: `@${u.username}`, username: u.username, avatar: toUrl(u.profile?.avatarThumbUrl || u.profile?.avatarUrl), verified: !!u.verified,
});

export const meDto = (u: any, extra: Record<string, unknown> = {}) => ({
  id: u.id, name: u.fullName, fullName: u.fullName, handle: u.username, username: u.username, email: u.email, phone: u.phone ?? '',
  about: u.profile?.about ?? '', bio: u.profile?.bio ?? '', links: u.profile?.links ?? '', title: u.profile?.title ?? '', location: u.profile?.location ?? '',
  website: u.profile?.website ?? '', skills: u.profile?.skills ?? [], interests: u.profile?.interests ?? [],
  avatar: toUrl(u.profile?.avatarUrl), isPrivate: u.isPrivate, verified: u.verified, role: u.role,
  dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString().slice(0, 10) : null,
  emailVerified: !!u.emailVerifiedAt, phoneVerified: !!u.phoneVerifiedAt, createdAt: u.createdAt, ...extra,
});

/** Mutual block check: neither side may interact with, find or read the other. */
export async function isBlockedBetween(a: string, b: string, db: Tx | typeof prisma = prisma) {
  const r = await db.blockedUser.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }, select: { blockerId: true } });
  return !!r;
}
export async function blockedIds(userId: string): Promise<string[]> {
  const rows = await prisma.blockedUser.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } });
  return rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId));
}

export const directKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
export const fmtDate = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
export const toDate = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00.000Z`) : null);

export async function audit(actorId: string | null, action: string, target?: { type?: string; id?: string }, meta?: Record<string, unknown>, ip?: string) {
  try { await prisma.auditLog.create({ data: { actorId, action, targetType: target?.type, targetId: target?.id, meta: meta as any, ip } }); } catch { /* never block the request */ }
}
export const MS = { min: 60_000, hour: 3_600_000, day: 86_400_000 };
