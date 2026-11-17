import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, randomId, verifyPassword } from '../lib/crypto';
import { prisma, Prisma } from '../lib/db';
import { HttpError, bad, notFound } from '../lib/errors';
import { idParam, page, q, uuid, validate, wrap } from '../lib/http';
import { revokeAllSessions } from '../lib/auth';
import { notify } from '../lib/notify';
import { onlineSet } from '../lib/presence';
import { removeObject, saveUpload, toUrl } from '../lib/storage';
import { requireAuth } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { upload } from '../middleware/upload';
import { RESERVED, USERNAME_RE, audit, blockedIds, card, isBlockedBetween, isEmail, meDto, normEmail, normPhone, normUsername, userInclude } from './common';
import { setStreakBlocked } from './streaks';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const fmtCount = (n: number) => (n >= 1e6 ? `${(Math.round(n / 1e5) / 10).toString().replace(/\.0$/, '')}M` : n >= 1e3 ? `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}K` : String(n));
const mmss = (s?: number | null) => (s == null ? null : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

async function myDto(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userInclude });
  const [posts, friends, albums, couple] = await Promise.all([
    prisma.post.count({ where: { userId, deletedAt: null } }),
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM follows a JOIN follows b ON a."followerId" = b."followeeId" AND a."followeeId" = b."followerId" WHERE a."followerId" = ${userId}::uuid`,
    prisma.coupleMemory.groupBy({ by: ['album'], where: { ownerId: userId, deletedAt: null } }),
    prisma.coupleConnection.findFirst({ where: { status: 'ACTIVE', OR: [{ inviterId: userId }, { inviteeId: userId }] }, select: { inviterId: true, inviteeId: true } }),
  ]);
  const partnerId = couple ? (couple.inviterId === userId ? couple.inviteeId : couple.inviterId) : null;
  return meDto(u, { posts, friends: Number(friends[0]?.n ?? 0), albums: albums.length, partnerId });
}

// ── me ──
usersRouter.get('/me', wrap(async (req, res) => { res.json(await myDto(req.user.id)); }));

const profileBody = z.object({
  name: z.string().trim().min(2).max(60).optional(), fullName: z.string().trim().min(2).max(60).optional(),
  handle: z.string().trim().max(31).optional(), username: z.string().trim().max(31).optional(),
  about: z.string().max(200).optional(), bio: z.string().max(200).optional(),
  links: z.string().max(200).optional(), title: z.string().max(80).optional(), location: z.string().max(80).optional(),
  website: z.string().max(200).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), 'Website must start with http:// or https://').optional(),
  skills: z.array(z.string().max(30)).max(20).optional(), interests: z.array(z.string().max(30)).max(20).optional(),
  email: z.string().email().optional(), phone: z.string().regex(/^\+?[0-9\s()-]{8,18}$/).optional().or(z.literal('')),
  isPrivate: z.boolean().optional(), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
});
const updateMe = wrap(async (req, res) => {
  const b = req.body as z.infer<typeof profileBody>;
  const userData: Prisma.UserUpdateInput = {};
  const profileData: Prisma.UserProfileUpdateInput = {};
  if (b.name || b.fullName) userData.fullName = (b.fullName || b.name)!;
  const handle = b.username ?? b.handle;
  if (handle !== undefined) {
    const u = normUsername(handle);
    if (!USERNAME_RE.test(u) || RESERVED.has(u)) throw bad('Username: 3–30 letters, numbers, . or _');
    const taken = await prisma.user.findFirst({ where: { username: u, id: { not: req.user.id } }, select: { id: true } });
    if (taken) throw new HttpError(409, 'That username is taken', 'conflict');
    userData.username = u;
  }
  if (b.email) {
    const e = normEmail(b.email);
    if (await prisma.user.findFirst({ where: { email: e, id: { not: req.user.id } }, select: { id: true } })) throw new HttpError(409, 'That email is already in use', 'conflict');
    userData.email = e; userData.emailVerifiedAt = null; // a changed email must be verified again
  }
  if (b.phone !== undefined) {
    if (b.phone === '') { userData.phone = null; userData.phoneVerifiedAt = null; }
    else {
      const p = normPhone(b.phone);
      if (await prisma.user.findFirst({ where: { phone: p, id: { not: req.user.id } }, select: { id: true } })) throw new HttpError(409, 'That phone number is already in use', 'conflict');
      userData.phone = p; userData.phoneVerifiedAt = null;
    }
  }
  if (b.isPrivate !== undefined) userData.isPrivate = b.isPrivate;
  if (b.dateOfBirth) userData.dateOfBirth = new Date(`${b.dateOfBirth}T00:00:00Z`);
  for (const k of ['about', 'bio', 'links', 'title', 'location', 'website', 'skills', 'interests', 'latitude', 'longitude'] as const) if ((b as any)[k] !== undefined) (profileData as any)[k] = (b as any)[k];
  await prisma.user.update({ where: { id: req.user.id }, data: { ...userData, profile: { upsert: { create: profileData as any, update: profileData } } } });
  // approving a private account => nothing to do; going public auto-accepts pending requests
  if (b.isPrivate === false) {
    const pending = await prisma.followRequest.findMany({ where: { targetId: req.user.id } });
    if (pending.length) await prisma.$transaction([
      prisma.follow.createMany({ data: pending.map((r) => ({ followerId: r.requesterId, followeeId: req.user.id })), skipDuplicates: true }),
      prisma.followRequest.deleteMany({ where: { targetId: req.user.id } }),
    ]);
  }
  res.json(await myDto(req.user.id));
});
usersRouter.put('/me', validate({ body: profileBody }), updateMe);
usersRouter.put('/profile', validate({ body: profileBody }), updateMe); // spec alias
usersRouter.patch('/me', validate({ body: profileBody }), updateMe);

usersRouter.post('/me/avatar', uploadLimiter, upload.single('avatar'), wrap(async (req, res) => {
  if (!req.file) throw bad('Choose a picture');
  const saved = await saveUpload(req.file, { folder: 'avatars', accept: ['image'], thumb: 160, maxDim: 1024 });
  const old = await prisma.userProfile.findUnique({ where: { userId: req.user.id } });
  await prisma.userProfile.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, avatarUrl: saved.key, avatarThumbUrl: saved.thumbKey }, update: { avatarUrl: saved.key, avatarThumbUrl: saved.thumbKey } });
  await Promise.all([removeObject(old?.avatarUrl), removeObject(old?.avatarThumbUrl)]);
  res.json(await myDto(req.user.id));
}));
usersRouter.delete('/me/avatar', wrap(async (req, res) => {
  const old = await prisma.userProfile.findUnique({ where: { userId: req.user.id } });
  await prisma.userProfile.update({ where: { userId: req.user.id }, data: { avatarUrl: null, avatarThumbUrl: null } });
  await Promise.all([removeObject(old?.avatarUrl), removeObject(old?.avatarThumbUrl)]);
  res.json(await myDto(req.user.id));
}));

// ── settings ──
const settingsBody = z.object({
  showLastSeen: z.boolean(), showOnlineStatus: z.boolean(), readReceipts: z.boolean(), defaultStoryPrivacy: z.enum(['EVERYONE', 'FOLLOWERS', 'SELECTED', 'COUPLE']),
  pushEnabled: z.boolean(), notifyMessages: z.boolean(), notifyCalls: z.boolean(), notifyStories: z.boolean(), notifyFollows: z.boolean(), notifyCouple: z.boolean(),
  notifyCalendar: z.boolean(), notifyStreaks: z.boolean(), notifyGroups: z.boolean(), quietHoursEnabled: z.boolean(),
  quietStartMin: z.number().int().min(0).max(1439), quietEndMin: z.number().int().min(0).max(1439),
  timezone: z.string().max(60).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown timezone'),
  hideNotificationPreviews: z.boolean(),
}).partial();
const publicSettings = (s: any) => { const { pinHash, recoveryHash, pinFailedAttempts, pinLockedUntil, ...rest } = s; return { ...rest, privateSpacePinSet: !!pinHash }; };
usersRouter.get('/me/settings', wrap(async (req, res) => {
  const s = await prisma.userSettings.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id }, update: {} });
  res.json(publicSettings(s));
}));
usersRouter.put('/me/settings', validate({ body: settingsBody }), wrap(async (req, res) => {
  const s = await prisma.userSettings.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, ...req.body }, update: req.body });
  res.json(publicSettings(s));
}));

// ── push devices ──
usersRouter.post('/me/devices', validate({ body: z.object({ pushToken: z.string().min(10).max(300), platform: z.enum(['ios', 'android', 'web']), appVersion: z.string().max(30).optional() }) }), wrap(async (req, res) => {
  const d = await prisma.device.upsert({
    where: { pushToken: req.body.pushToken },
    create: { userId: req.user.id, sessionId: req.user.sessionId, ...req.body },
    update: { userId: req.user.id, sessionId: req.user.sessionId, platform: req.body.platform, appVersion: req.body.appVersion, lastSeenAt: new Date() }, // a token moves with the person who signs in on that phone
  });
  res.status(201).json({ id: d.id });
}));
usersRouter.delete('/me/devices/:token', wrap(async (req, res) => { await prisma.device.deleteMany({ where: { pushToken: String(req.params.token), userId: req.user.id } }); res.json({ ok: true }); }));

// ── account deletion: anonymise now, hard-delete after the grace period (see jobs) ──
usersRouter.delete('/me', validate({ body: z.object({ password: z.string().min(1).optional() }).optional() }), wrap(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
  if (req.body?.password !== undefined && !(await verifyPassword(user.passwordHash, req.body.password))) throw new HttpError(400, 'Password is incorrect', 'invalid_credentials');
  const tomb = randomId(10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { status: 'DELETED', deletedAt: new Date(), email: `deleted+${tomb}@deleted.sendmeu.invalid`, phone: null, username: `deleted_${tomb}`, fullName: 'Deleted user', passwordHash: await hashPassword(randomId(32)) } }),
    prisma.userProfile.updateMany({ where: { userId: user.id }, data: { bio: '', about: '', avatarUrl: null, avatarThumbUrl: null, coverUrl: null, title: null, location: null, website: null, links: null, skills: [], interests: [], latitude: null, longitude: null } }),
    prisma.device.deleteMany({ where: { userId: user.id } }),
    prisma.follow.deleteMany({ where: { OR: [{ followerId: user.id }, { followeeId: user.id }] } }),
    prisma.followRequest.deleteMany({ where: { OR: [{ requesterId: user.id }, { targetId: user.id }] } }),
    prisma.story.updateMany({ where: { userId: user.id }, data: { deletedAt: new Date() } }),
    prisma.liveLocation.deleteMany({ where: { userId: user.id } }),
    prisma.coupleConnection.updateMany({ where: { status: { in: ['ACTIVE', 'PENDING'] }, OR: [{ inviterId: user.id }, { inviteeId: user.id }] }, data: { status: 'ENDED', endedAt: new Date(), endedById: user.id } }),
  ]);
  await revokeAllSessions(user.id);
  await audit(user.id, 'account.delete', { type: 'user', id: user.id }, undefined, req.ip);
  res.json({ ok: true });
}));

// ── search / discover ──
async function personRows(me: string, users: any[]) {
  if (!users.length) return [];
  const ids = users.map((u) => u.id);
  const [following, followers, requests, onlineIds, counts, mutual] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: me, followeeId: { in: ids } }, select: { followeeId: true } }),
    prisma.follow.findMany({ where: { followeeId: me, followerId: { in: ids } }, select: { followerId: true } }),
    prisma.followRequest.findMany({ where: { requesterId: me, targetId: { in: ids } }, select: { targetId: true } }),
    onlineSet(ids),
    prisma.$queryRaw<{ id: string; followers: number; following: number }[]>`
      SELECT u.id, (SELECT count(*) FROM follows f WHERE f."followeeId" = u.id)::int AS followers, (SELECT count(*) FROM follows f WHERE f."followerId" = u.id)::int AS following
      FROM users u WHERE u.id IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))})`,
    prisma.$queryRaw<{ id: string; n: number }[]>`
      SELECT b."followeeId" AS id, count(*)::int AS n FROM follows a JOIN follows b ON a."followeeId" = b."followerId"
      WHERE a."followerId" = ${me}::uuid AND b."followeeId" IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))}) GROUP BY b."followeeId"`,
  ]);
  const F = new Set(following.map((x) => x.followeeId)); const R = new Set(followers.map((x) => x.followerId)); const Q = new Set(requests.map((x) => x.targetId));
  const C = new Map(counts.map((c) => [c.id, c])); const M = new Map(mutual.map((m) => [m.id, m.n]));
  return users.map((u) => ({
    ...card(u), bio: u.profile?.bio || u.profile?.about || '', mutual: M.get(u.id) ?? 0,
    followers: fmtCount(C.get(u.id)?.followers ?? 0), following: fmtCount(C.get(u.id)?.following ?? 0),
    online: u.settings?.showOnlineStatus === false ? false : onlineIds.has(u.id),
    isFollowing: F.has(u.id), follower: R.has(u.id), friend: F.has(u.id) && R.has(u.id), requested: !F.has(u.id) && Q.has(u.id),
    isPrivate: u.isPrivate, interests: u.profile?.interests ?? [], location: u.profile?.location ?? null, distance: null as string | null,
  }));
}
const searchQuery = z.object({ q: z.string().trim().max(60).optional(), interest: z.string().max(30).optional(), suggestions: z.coerce.boolean().optional() }).merge(page);

usersRouter.get('/search', validate({ query: searchQuery }), wrap(async (req, res) => {
  const { q: term, limit, offset } = q(req);
  if (!term) return res.json([]);
  const hidden = await blockedIds(req.user.id);
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE', id: { notIn: [req.user.id, ...hidden] }, OR: [{ username: { contains: normUsername(term), mode: 'insensitive' } }, { fullName: { contains: term, mode: 'insensitive' } }] },
    include: { profile: true, settings: { select: { showOnlineStatus: true } } }, orderBy: [{ fullName: 'asc' }], take: limit, skip: offset,
  });
  res.json(await personRows(req.user.id, users));
}));

export const discoverRouter = Router();
discoverRouter.use(requireAuth);
discoverRouter.get('/people', validate({ query: searchQuery }), wrap(async (req, res) => {
  const { q: term, interest, suggestions, limit, offset } = q(req);
  const hidden = await blockedIds(req.user.id);
  const dismissed = suggestions ? (await prisma.suggestionDismissal.findMany({ where: { userId: req.user.id }, select: { dismissedId: true } })).map((d) => d.dismissedId) : [];
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE', id: { notIn: [req.user.id, ...hidden, ...dismissed] },
      ...(interest ? { profile: { interests: { has: interest } } } : {}),
      ...(term ? { OR: [{ username: { contains: normUsername(term), mode: 'insensitive' } }, { fullName: { contains: term, mode: 'insensitive' } }] } : {}),
    },
    include: { profile: true, settings: { select: { showOnlineStatus: true } } },
    orderBy: [{ createdAt: 'desc' }], take: limit, skip: offset,
  });
  res.json(await personRows(req.user.id, users));
}));

// ── profile of another person ──
async function visibleTarget(me: string, id: string) {
  const target = await prisma.user.findFirst({ where: { id, status: 'ACTIVE' }, include: { profile: true, settings: { select: { showOnlineStatus: true } } } });
  if (!target) throw notFound('This profile could not be found');
  const theyBlockedMe = await prisma.blockedUser.findUnique({ where: { blockerId_blockedId: { blockerId: id, blockedId: me } } });
  if (theyBlockedMe) throw notFound('This profile could not be found');
  return target;
}
async function canViewContent(me: string, target: { id: string; isPrivate: boolean }) {
  if (me === target.id || !target.isPrivate) return true;
  return !!(await prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: me, followeeId: target.id } } }));
}

const profileOf = wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id;
  if (id === me) return res.json({ ...(await myDto(me)), isMe: true, canView: true });
  const target = await visibleTarget(me, id);
  const iBlocked = await prisma.blockedUser.findUnique({ where: { blockerId_blockedId: { blockerId: me, blockedId: id } } });
  if (iBlocked) return res.json({ id: target.id, name: target.fullName, handle: `@${target.username}`, avatar: toUrl(target.profile?.avatarUrl), blocked: true });
  const [row] = await personRows(me, [target]);
  const posts = await prisma.post.count({ where: { userId: id, deletedAt: null } });
  const p = target.profile;
  res.json({ ...row, posts, title: p?.title ?? null, location: p?.location ?? null, website: p?.website ?? null, skills: p?.skills ?? [], followersCount: undefined, canView: await canViewContent(me, target) });
});
usersRouter.get('/:id/profile', validate({ params: idParam }), profileOf);

// ── posts on a profile ──
export const postDto = (p: any, me: string, extra: { liked?: boolean; saved?: boolean }) => ({
  id: p.id, userId: p.userId, type: p.mediaType, src: p.mediaType === 'image' ? toUrl(p.mediaUrl) : null, poster: toUrl(p.posterUrl || (p.mediaType === 'image' ? p.mediaUrl : null)),
  video: p.mediaType === 'video' ? toUrl(p.mediaUrl) : undefined, duration: mmss(p.durationS), caption: p.caption, createdAt: p.createdAt,
  likes: p._count?.likes ?? 0, liked: !!extra.liked, saved: !!extra.saved, comments: p._count?.comments ?? 0,
  owner: card(p.user),
});
async function postsFor(me: string, where: Prisma.PostWhereInput, take = 60) {
  const posts = await prisma.post.findMany({ where: { deletedAt: null, ...where }, include: { user: { include: { profile: true } }, _count: { select: { likes: true, comments: true } } }, orderBy: { createdAt: 'desc' }, take });
  const ids = posts.map((p) => p.id);
  const [likes, saves] = await Promise.all([
    prisma.postLike.findMany({ where: { userId: me, postId: { in: ids } }, select: { postId: true } }),
    prisma.postSave.findMany({ where: { userId: me, postId: { in: ids } }, select: { postId: true } }),
  ]);
  const L = new Set(likes.map((l) => l.postId)); const S = new Set(saves.map((s) => s.postId));
  return posts.map((p) => postDto(p, me, { liked: L.has(p.id), saved: S.has(p.id) }));
}
usersRouter.get('/:id/posts', validate({ params: idParam, query: z.object({ tab: z.enum(['posts', 'reels', 'tagged']).default('posts') }) }), wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id; const tab = q<{ tab: string }>(req).tab;
  const target = id === me ? await prisma.user.findUniqueOrThrow({ where: { id } }) : await visibleTarget(me, id);
  if (!(await canViewContent(me, target))) return res.json({ locked: true, items: [] });
  const hidden = await blockedIds(me);
  const where: Prisma.PostWhereInput = tab === 'tagged'
    ? { tags: { some: { userId: id } }, userId: { notIn: [...hidden] }, user: { OR: [{ isPrivate: false }, { followers: { some: { followerId: me } } }, { id: me }] } }
    : { userId: id, mediaType: tab === 'reels' ? 'video' : 'image' };
  res.json({ locked: false, items: await postsFor(me, where) });
}));

// ── followers / following lists ──
async function personList(me: string, rows: { user: any }[]) {
  const ids = rows.map((r) => r.user.id);
  const [f, r] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: me, followeeId: { in: ids } }, select: { followeeId: true } }),
    prisma.followRequest.findMany({ where: { requesterId: me, targetId: { in: ids } }, select: { targetId: true } }),
  ]);
  const F = new Set(f.map((x) => x.followeeId)); const R = new Set(r.map((x) => x.targetId));
  return rows.map(({ user }) => ({ ...card(user), isMe: user.id === me, isFollowing: F.has(user.id), requested: !F.has(user.id) && R.has(user.id) }));
}
const listRoute = (dir: 'followers' | 'following') => wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id;
  const target = id === me ? await prisma.user.findUniqueOrThrow({ where: { id } }) : await visibleTarget(me, id);
  if (!(await canViewContent(me, target))) throw new HttpError(403, 'This account is private');
  const hidden = new Set(await blockedIds(me));
  const rows = dir === 'followers'
    ? await prisma.follow.findMany({ where: { followeeId: id }, include: { follower: { include: { profile: true } } }, orderBy: { createdAt: 'desc' }, take: 200 })
    : await prisma.follow.findMany({ where: { followerId: id }, include: { followee: { include: { profile: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  const users = rows.map((r: any) => ({ user: dir === 'followers' ? r.follower : r.followee })).filter((r) => r.user.status === 'ACTIVE' && !hidden.has(r.user.id));
  res.json(await personList(me, users));
});
usersRouter.get('/:id/followers', validate({ params: idParam }), listRoute('followers'));
usersRouter.get('/:id/following', validate({ params: idParam }), listRoute('following'));

// ── follow / unfollow / block ──
async function followState(me: string, id: string) {
  const [following, requested, followers] = await Promise.all([
    prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: me, followeeId: id } } }),
    prisma.followRequest.findUnique({ where: { requesterId_targetId: { requesterId: me, targetId: id } } }),
    prisma.follow.count({ where: { followeeId: id } }),
  ]);
  return { following: !!following, requested: !following && !!requested, followers: fmtCount(followers) };
}
const followFn = wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id;
  if (id === me) throw bad('You cannot follow yourself');
  const target = await visibleTarget(me, id);
  if (await prisma.blockedUser.findUnique({ where: { blockerId_blockedId: { blockerId: me, blockedId: id } } })) throw new HttpError(403, 'This profile isn’t available');
  const exists = await prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: me, followeeId: id } } });
  if (!exists) {
    const mine = await prisma.user.findUniqueOrThrow({ where: { id: me }, include: { profile: true } });
    if (target.isPrivate) {
      const r = await prisma.followRequest.upsert({ where: { requesterId_targetId: { requesterId: me, targetId: id } }, create: { requesterId: me, targetId: id }, update: {} });
      if (Date.now() - r.createdAt.getTime() < 2000) await notify({ userId: id, actorId: me, type: 'FOLLOW_REQUEST', title: 'Follow request', body: `${mine.fullName} wants to follow you`, data: { userId: me } });
    } else {
      await prisma.follow.create({ data: { followerId: me, followeeId: id } });
      await notify({ userId: id, actorId: me, type: 'FOLLOW', title: 'New follower', body: `${mine.fullName} started following you`, data: { userId: me } });
    }
  }
  res.json(await followState(me, id));
});
usersRouter.post('/:id/follow', validate({ params: idParam }), followFn);
usersRouter.delete('/:id/follow', validate({ params: idParam }), wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id;
  await prisma.$transaction([
    prisma.follow.deleteMany({ where: { followerId: me, followeeId: id } }),
    prisma.followRequest.deleteMany({ where: { requesterId: me, targetId: id } }),
  ]);
  res.json(await followState(me, id));
}));

usersRouter.post('/:id/block', validate({ params: idParam }), wrap(async (req, res) => {
  const id = req.params.id; const me = req.user.id;
  if (id === me) throw bad('You cannot block yourself');
  if (!(await prisma.user.findFirst({ where: { id, status: 'ACTIVE' }, select: { id: true } }))) throw notFound('User not found');
  await prisma.$transaction([
    prisma.blockedUser.upsert({ where: { blockerId_blockedId: { blockerId: me, blockedId: id } }, create: { blockerId: me, blockedId: id }, update: {} }),
    prisma.follow.deleteMany({ where: { OR: [{ followerId: me, followeeId: id }, { followerId: id, followeeId: me }] } }),
    prisma.followRequest.deleteMany({ where: { OR: [{ requesterId: me, targetId: id }, { requesterId: id, targetId: me }] } }),
  ]);
  await setStreakBlocked(me, id, true);
  await audit(me, 'user.block', { type: 'user', id });
  res.json({ blocked: true });
}));
usersRouter.delete('/:id/block', validate({ params: idParam }), wrap(async (req, res) => {
  await prisma.blockedUser.deleteMany({ where: { blockerId: req.user.id, blockedId: req.params.id } });
  if (!(await isBlockedBetween(req.user.id, req.params.id))) await setStreakBlocked(req.user.id, req.params.id, false);
  res.json({ blocked: false });
}));
usersRouter.get('/me/blocked', wrap(async (req, res) => {
  const rows = await prisma.blockedUser.findMany({ where: { blockerId: req.user.id }, include: { blocked: { include: { profile: true } } }, orderBy: { createdAt: 'desc' } });
  res.json(rows.map((r) => card(r.blocked)));
}));

// GET /users/:id (spec) — same payload as /users/:id/profile
usersRouter.get('/:id', validate({ params: idParam }), profileOf);

// ── top-level social routes (mounted at /api/v1) ──
export const socialRouter = Router();
socialRouter.use(requireAuth);
socialRouter.post('/friends/:id', validate({ params: idParam }), followFn);
socialRouter.delete('/suggestions/:id', validate({ params: idParam }), wrap(async (req, res) => {
  await prisma.suggestionDismissal.upsert({ where: { userId_dismissedId: { userId: req.user.id, dismissedId: req.params.id } }, create: { userId: req.user.id, dismissedId: req.params.id }, update: {} });
  res.json({ ok: true });
}));
socialRouter.get('/follow-requests', wrap(async (req, res) => {
  const rows = await prisma.followRequest.findMany({ where: { targetId: req.user.id }, include: { requester: { include: { profile: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(rows.map((r) => ({ ...card(r.requester), requestedAt: r.createdAt })));
}));
socialRouter.post('/follow-requests/:id/accept', validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.followRequest.findUnique({ where: { requesterId_targetId: { requesterId: req.params.id, targetId: req.user.id } } });
  if (!r) throw notFound('That request is no longer there');
  await prisma.$transaction([
    prisma.follow.upsert({ where: { followerId_followeeId: { followerId: r.requesterId, followeeId: req.user.id } }, create: { followerId: r.requesterId, followeeId: req.user.id }, update: {} }),
    prisma.followRequest.delete({ where: { requesterId_targetId: { requesterId: r.requesterId, targetId: req.user.id } } }),
  ]);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
  await notify({ userId: r.requesterId, actorId: req.user.id, type: 'FOLLOW', title: 'Request accepted', body: `${me.fullName} accepted your follow request`, data: { userId: me.id } });
  res.json({ ok: true });
}));
socialRouter.delete('/follow-requests/:id', validate({ params: idParam }), wrap(async (req, res) => {
  await prisma.followRequest.deleteMany({ where: { requesterId: req.params.id, targetId: req.user.id } });
  res.json({ ok: true });
}));

// ── posts: create / delete / like / save / comment ──
const postVisible = async (me: string, postId: string) => {
  const p = await prisma.post.findFirst({ where: { id: postId, deletedAt: null }, include: { user: true } });
  if (!p || p.user.status !== 'ACTIVE') throw notFound('This post is no longer available');
  if (p.userId !== me) {
    if (await isBlockedBetween(me, p.userId)) throw notFound('This post isn’t available');
    if (!(await canViewContent(me, p.user))) throw new HttpError(403, 'This account is private');
  }
  return p;
};
socialRouter.post('/posts', uploadLimiter, upload.fields([{ name: 'media', maxCount: 1 }, { name: 'poster', maxCount: 1 }]), wrap(async (req, res) => {
  const files = req.files as Record<string, Express.Multer.File[]>;
  const f = files?.media?.[0]; if (!f) throw bad('Choose a photo or video');
  const saved = await saveUpload(f, { folder: 'posts', accept: ['image', 'video'], thumb: 480 });
  let poster = saved.thumbKey;
  if (saved.kind === 'video' && files.poster?.[0]) poster = (await saveUpload(files.poster[0], { folder: 'posts', accept: ['image'], maxDim: 1080 })).key;
  const caption = String(req.body.caption || '').slice(0, 2200);
  const tagIds: string[] = [].concat(req.body.tags || []).map(String).filter((t) => z.string().uuid().safeParse(t).success && t !== req.user.id).slice(0, 10);
  const post = await prisma.post.create({ data: { userId: req.user.id, mediaType: saved.kind === 'video' ? 'video' : 'image', mediaUrl: saved.key, posterUrl: poster, durationS: Number(req.body.durationS) || null, caption, tags: { create: tagIds.map((userId) => ({ userId })) } }, include: { user: { include: { profile: true } }, _count: { select: { likes: true, comments: true } } } });
  res.status(201).json(postDto(post, req.user.id, {}));
}));
socialRouter.delete('/posts/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const r = await prisma.post.updateMany({ where: { id: req.params.id, userId: req.user.id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (!r.count) throw notFound('Post not found');
  res.json({ ok: true });
}));
const likeCount = (postId: string) => prisma.postLike.count({ where: { postId } });
socialRouter.post('/posts/:id/like', validate({ params: idParam }), wrap(async (req, res) => {
  const p = await postVisible(req.user.id, req.params.id);
  const had = await prisma.postLike.findUnique({ where: { postId_userId: { postId: p.id, userId: req.user.id } } });
  if (!had) await prisma.postLike.create({ data: { postId: p.id, userId: req.user.id } });
  res.json({ liked: true, likes: await likeCount(p.id) });
}));
socialRouter.delete('/posts/:id/like', validate({ params: idParam }), wrap(async (req, res) => {
  const p = await postVisible(req.user.id, req.params.id);
  await prisma.postLike.deleteMany({ where: { postId: p.id, userId: req.user.id } });
  res.json({ liked: false, likes: await likeCount(p.id) });
}));
socialRouter.post('/posts/:id/save', validate({ params: idParam }), wrap(async (req, res) => {
  const p = await postVisible(req.user.id, req.params.id);
  await prisma.postSave.upsert({ where: { postId_userId: { postId: p.id, userId: req.user.id } }, create: { postId: p.id, userId: req.user.id }, update: {} });
  res.json({ saved: true });
}));
socialRouter.delete('/posts/:id/save', validate({ params: idParam }), wrap(async (req, res) => {
  await prisma.postSave.deleteMany({ where: { postId: req.params.id, userId: req.user.id } });
  res.json({ saved: false });
}));
socialRouter.get('/posts/:id/comments', validate({ params: idParam }), wrap(async (req, res) => {
  const p = await postVisible(req.user.id, req.params.id);
  const hidden = await blockedIds(req.user.id);
  const rows = await prisma.postComment.findMany({ where: { postId: p.id, userId: { notIn: hidden } }, include: { user: { include: { profile: true } } }, orderBy: { createdAt: 'asc' }, take: 200 });
  res.json(rows.map((c) => ({ id: c.id, userId: c.userId, name: c.user.fullName, avatar: toUrl(c.user.profile?.avatarThumbUrl || c.user.profile?.avatarUrl), text: c.body, at: c.createdAt })));
}));
socialRouter.post('/posts/:id/comments', validate({ params: idParam, body: z.object({ text: z.string().trim().min(1, 'Write a comment first').max(500, 'Comments can be up to 500 characters') }) }), wrap(async (req, res) => {
  const p = await postVisible(req.user.id, req.params.id);
  const c = await prisma.postComment.create({ data: { postId: p.id, userId: req.user.id, body: req.body.text }, include: { user: { include: { profile: true } } } });
  if (p.userId !== req.user.id) await notify({ userId: p.userId, actorId: req.user.id, type: 'SYSTEM', title: 'New comment', body: `${c.user.fullName}: ${c.body.slice(0, 80)}`, data: { postId: p.id }, push: false });
  res.status(201).json({ id: c.id, userId: c.userId, name: c.user.fullName, avatar: toUrl(c.user.profile?.avatarThumbUrl || c.user.profile?.avatarUrl), text: c.body, at: c.createdAt });
}));
void uuid;
