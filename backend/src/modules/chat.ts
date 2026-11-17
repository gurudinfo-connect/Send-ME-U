import { Router, Request } from 'express';
import { z } from 'zod';
import { randomId } from '../lib/crypto';
import { prisma, Prisma } from '../lib/db';
import { HttpError, bad, forbidden, notFound } from '../lib/errors';
import { idParam, page, q, uuid, validate, wrap } from '../lib/http';
import { inQuietHours, notify, sendPush } from '../lib/notify';
import { isOnline, onlineSet } from '../lib/presence';
import { emitToConversation, emitToUser, emitToUsers } from '../lib/realtime';
import { removeObject, saveUpload, toUrl } from '../lib/storage';
import { requireAuth } from '../middleware/auth';
import { sendLimiter, uploadLimiter } from '../middleware/rateLimit';
import { upload } from '../middleware/upload';
import { blockedIds, card, directKey, isBlockedBetween } from './common';
import { assertConversationAccessible, hasPrivateAccess, lockedConversationIds, setLocked } from './private';
import { broadcastStreak, recordActivity } from './streaks';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const FOREVER = new Date('9999-12-31T00:00:00Z');
const EDIT_WINDOW_MS = 15 * 60_000;
const DELETE_EVERYONE_MS = 48 * 3_600_000;
const T2L: Record<string, string> = { TEXT: 'text', IMAGE: 'image', VIDEO: 'video', VOICE: 'voice', DOCUMENT: 'doc', GIF: 'gif', STICKER: 'sticker', STORY: 'story', LOVE_NOTE: 'text', SYSTEM: 'system' };
const mmss = (ms?: number | null) => (ms == null ? undefined : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`);
const live = (): Prisma.MessageWhereInput => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] });

// ───────────────────────────── DTOs ─────────────────────────────

const messageInclude = {
  attachments: true, reactions: true, receipts: true, stars: true,
  replyTo: { select: { id: true, text: true, type: true, senderId: true, deletedAt: true } },
  story: { select: { id: true, mediaUrl: true, thumbUrl: true, type: true, textContent: true, bgColor: true, userId: true } },
} as const;
type FullMessage = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function previewText(m: { type: string; text?: string | null; deletedAt?: Date | null; attachments?: { fileName?: string | null }[] }) {
  if (m.deletedAt) return 'This message was deleted';
  switch (m.type) {
    case 'IMAGE': return m.text ? `📷 ${m.text}` : '📷 Photo';
    case 'VIDEO': return '🎥 Video';
    case 'VOICE': return '🎤 Voice message';
    case 'DOCUMENT': return `📄 ${m.attachments?.[0]?.fileName || 'Document'}`;
    case 'GIF': return 'GIF';
    case 'STICKER': return 'Sticker';
    case 'STORY': return m.text || 'Story reply';
    default: return m.text || '';
  }
}

/** viewer-relative message. status: sent < delivered < read, computed from the *other* members' receipts. */
export function messageDto(m: FullMessage, me: string, memberIds: string[]) {
  const mine = m.senderId === me;
  const others = memberIds.filter((u) => u !== m.senderId);
  let status: 'sent' | 'delivered' | 'read' = 'sent';
  if (mine && others.length) {
    const rec = others.map((u) => m.receipts.find((r) => r.userId === u));
    if (rec.every((r) => r?.readAt)) status = 'read';
    else if (rec.every((r) => r?.deliveredAt || r?.readAt)) status = 'delivered';
  }
  const deleted = !!m.deletedAt;
  const att = deleted ? [] : m.attachments;
  const first = att[0];
  const myReaction = m.reactions.find((r) => r.userId === me)?.emoji;
  const grouped = Object.values(m.reactions.reduce<Record<string, { emoji: string; userIds: string[] }>>((acc, r) => { (acc[r.emoji] ||= { emoji: r.emoji, userIds: [] }).userIds.push(r.userId); return acc; }, {}))
    .map((g) => ({ ...g, count: g.userIds.length }));
  return {
    id: m.id, conversationId: m.conversationId, senderId: m.senderId, from: mine ? 'me' : 'them', type: deleted ? 'text' : T2L[m.type] || 'text',
    kind: m.type === 'LOVE_NOTE' ? 'love_note' : m.storyKind || undefined,
    text: deleted ? '' : m.text ?? '', deleted, at: m.createdAt, createdAt: m.createdAt, status: mine ? status : undefined,
    src: first ? toUrl(first.url) : undefined, poster: first?.thumbUrl ? toUrl(first.thumbUrl) : undefined, duration: mmss(first?.durationMs),
    hasPlay: first?.kind === 'video' ? true : undefined,
    attachments: att.map((a) => ({ id: a.id, kind: a.kind, url: toUrl(a.url), thumbUrl: toUrl(a.thumbUrl), mime: a.mime, size: a.sizeBytes, width: a.width, height: a.height, durationMs: a.durationMs, fileName: a.fileName })),
    emoji: m.emoji || undefined,
    story: deleted ? undefined : m.story ? { id: m.story.id, src: toUrl(m.story.thumbUrl || m.story.mediaUrl), type: m.story.type.toLowerCase(), text: m.story.textContent } : (m.storySnapshot as any) || undefined,
    reaction: myReaction ?? m.reactions[0]?.emoji, reactions: grouped,
    replyTo: m.replyTo ? { id: m.replyTo.id, from: m.replyTo.senderId === me ? 'me' : 'them', type: T2L[m.replyTo.type] || 'text', text: m.replyTo.deletedAt ? 'This message was deleted' : previewText(m.replyTo as any) } : undefined,
    forwarded: !!m.forwardedFromId, edited: !!m.editedAt, pinned: !!m.pinnedAt, starred: m.stars.some((s) => s.userId === me), expiresAt: m.expiresAt ?? undefined,
  };
}

async function membersOf(conversationId: string) {
  return (await prisma.conversationMember.findMany({ where: { conversationId, leftAt: null }, select: { userId: true } })).map((m) => m.userId);
}

export async function requireMember(userId: string, conversationId: string) {
  const m = await prisma.conversationMember.findFirst({ where: { conversationId, userId, leftAt: null }, include: { conversation: { include: { group: true } } } });
  if (!m) throw notFound('Conversation not found'); // non-members cannot tell whether it exists
  return m;
}

// ───────────────────────────── conversation list ─────────────────────────────

export async function listConversations(me: string, opts: { onlyLocked?: boolean; q?: string; archived?: boolean } = {}) {
  const locked = await lockedConversationIds(me);
  const memberships = await prisma.conversationMember.findMany({
    where: {
      userId: me, leftAt: null,
      ...(opts.onlyLocked ? { conversationId: { in: locked } } : { conversationId: { notIn: locked } }),
      ...(opts.archived === undefined ? {} : opts.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
    },
    include: { conversation: { include: { group: true, members: { where: { leftAt: null }, include: { user: { include: { profile: true, settings: { select: { showOnlineStatus: true, showLastSeen: true } } } } } } } } },
  });
  if (!memberships.length) return [];
  const ids = memberships.map((m) => m.conversationId);
  const [lasts, unread, online, hidden, couples] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (m."conversationId") m.id FROM messages m
      WHERE m."conversationId" IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))}) AND (m."expiresAt" IS NULL OR m."expiresAt" > now())
        AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d."messageId" = m.id AND d."userId" = ${me}::uuid)
      ORDER BY m."conversationId", m."createdAt" DESC, m.id DESC`,
    prisma.$queryRaw<{ cid: string; n: number }[]>`
      SELECT m."conversationId" AS cid, count(*)::int AS n FROM messages m
      JOIN conversation_members cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${me}::uuid
      WHERE m."conversationId" IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))}) AND m."senderId" IS DISTINCT FROM ${me}::uuid AND m."deletedAt" IS NULL
        AND m."createdAt" > cm."lastReadAt" AND m.type <> 'SYSTEM' AND (m."expiresAt" IS NULL OR m."expiresAt" > now())
      GROUP BY m."conversationId"`,
    onlineSet(memberships.flatMap((m) => m.conversation.members.map((x) => x.userId))),
    blockedIds(me),
    prisma.coupleConnection.findMany({ where: { conversationId: { in: ids }, status: 'ACTIVE' }, select: { conversationId: true } }),
  ]);
  const lastMsgs = await prisma.message.findMany({ where: { id: { in: lasts.map((l) => l.id) } }, include: { attachments: { select: { fileName: true } } } });
  const L = new Map(lastMsgs.map((m) => [m.conversationId, m])); const U = new Map(unread.map((u) => [u.cid, u.n]));
  const hiddenSet = new Set(hidden); const coupleSet = new Set(couples.map((c) => c.conversationId));

  const out = memberships.map((m) => {
    const c = m.conversation; const last = L.get(c.id);
    const other = c.type !== 'GROUP' ? c.members.find((x) => x.userId !== me)?.user : undefined;
    const isGroup = c.type === 'GROUP';
    const muted = !!m.mutedUntil && m.mutedUntil > new Date();
    return {
      id: c.id, type: c.type.toLowerCase(), kind: isGroup ? 'groups' : 'messages',
      friendId: other?.id, name: isGroup ? c.group?.name : m.contactName || other?.fullName || 'Chat', fullName: other?.fullName, handle: other ? `@${other.username}` : undefined,
      about: isGroup ? c.group?.about : other?.profile?.about || other?.profile?.bio || '', phone: m.contactPhone || other?.phone || undefined, location: other?.profile?.location || undefined,
      joined: other ? other.createdAt : c.createdAt, heart: coupleSet.has(c.id), favorite: m.favorite,
      avatar: toUrl(isGroup ? c.group?.avatarUrl : other?.profile?.avatarThumbUrl || other?.profile?.avatarUrl),
      last: last ? previewText(last as any) : '', time: (last?.createdAt ?? c.createdAt), lastMessageAt: c.lastMessageAt, lastFrom: last ? (last.senderId === me ? 'me' : 'them') : undefined,
      unread: muted ? U.get(c.id) ?? 0 : U.get(c.id) ?? 0, locked: opts.onlyLocked ? true : false, pinned: !!m.pinnedAt, pinnedAt: m.pinnedAt, archived: !!m.archivedAt, muted,
      mutedUntil: muted && m.mutedUntil!.getTime() < FOREVER.getTime() ? m.mutedUntil : null, wallpaper: m.wallpaper ?? undefined, disappearAfterSec: c.disappearAfterSec,
      online: other ? other.settings?.showOnlineStatus !== false && online.has(other.id) : false, memberIds: c.members.map((x) => x.userId), created: c.createdAt,
      role: m.role.toLowerCase(), blockedByMe: other ? hiddenSet.has(other.id) : false, onlyAdminsPost: c.group?.onlyAdminsPost,
    };
  });
  const term = opts.q?.trim().toLowerCase();
  const filtered = term ? out.filter((c) => `${c.name} ${c.handle ?? ''} ${c.last}`.toLowerCase().includes(term)) : out;
  return filtered.sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (b.pinned && a.pinned ? +new Date(a.pinnedAt!) - +new Date(b.pinnedAt!) : 0) || +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt));
}

chatRouter.get('/', validate({ query: z.object({ q: z.string().max(60).optional(), archived: z.enum(['true', 'false']).optional() }) }), wrap(async (req, res) => {
  const { q: term, archived } = q<{ q?: string; archived?: string }>(req);
  res.json(await listConversations(req.user.id, { q: term, archived: archived === undefined ? undefined : archived === 'true' }));
}));

// ───────────────────────────── create ─────────────────────────────

async function findOrCreateDirect(me: string, other: string) {
  if (me === other) throw bad('You cannot chat with yourself');
  const u = await prisma.user.findFirst({ where: { id: other, status: 'ACTIVE' }, select: { id: true } });
  if (!u) throw notFound('User not found');
  if (await isBlockedBetween(me, other)) throw new HttpError(403, 'You can’t message this person');
  const key = directKey(me, other);
  const existing = await prisma.conversation.findUnique({ where: { directKey: key } });
  if (existing) {
    await prisma.conversationMember.updateMany({ where: { conversationId: existing.id, userId: { in: [me, other] }, leftAt: { not: null } }, data: { leftAt: null } });
    return existing.id;
  }
  try {
    const c = await prisma.conversation.create({ data: { type: 'DIRECT', directKey: key, createdById: me, members: { create: [{ userId: me }, { userId: other }] } } });
    return c.id;
  } catch (e: any) { // two people starting a chat at the same moment: the unique key makes the loser reuse the winner's row
    if (e.code === 'P2002') return (await prisma.conversation.findUniqueOrThrow({ where: { directKey: key } })).id;
    throw e;
  }
}
export const ensureDirectConversation = findOrCreateDirect;

async function oneConversation(me: string, id: string, req?: Request) {
  const locked = (await lockedConversationIds(me)).includes(id);
  const all = await listConversations(me, { onlyLocked: locked });
  void req;
  return all.find((c) => c.id === id);
}

const createBody = z.object({
  userId: uuid.optional(), userIds: z.array(uuid).max(255).optional(), group: z.boolean().optional(), type: z.enum(['direct', 'group']).optional(),
  name: z.string().trim().max(60).optional(), about: z.string().max(300).optional(), avatar: z.string().optional(),
});
async function createConversation(req: Request) {
  const b = req.body as z.infer<typeof createBody>; const me = req.user.id;
  if (b.group || b.type === 'group') {
    const ids = [...new Set(b.userIds ?? [])].filter((i) => i !== me);
    if (ids.length < 1) throw bad('Choose at least one person for the group');
    if (!b.name) throw bad('Give the group a name');
    const users = await prisma.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true } });
    const blocked = new Set(await blockedIds(me));
    const okIds = users.map((u) => u.id).filter((i) => !blocked.has(i));
    if (!okIds.length) throw bad('None of those people can be added');
    const c = await prisma.conversation.create({
      data: {
        type: 'GROUP', createdById: me,
        group: { create: { name: b.name, about: b.about ?? '', inviteCode: randomId(14), createdById: me, members: { create: [{ userId: me, role: 'OWNER' }, ...okIds.map((userId) => ({ userId, addedById: me }))] } } },
        members: { create: [{ userId: me, role: 'OWNER' }, ...okIds.map((userId) => ({ userId }))] },
      },
    });
    await systemMessage(c.id, `${(await prisma.user.findUniqueOrThrow({ where: { id: me } })).fullName} created the group “${b.name}”`);
    for (const uid of okIds) await notify({ userId: uid, actorId: me, type: 'GROUP_INVITE', title: 'Added to a group', body: `You were added to ${b.name}`, data: { conversationId: c.id } });
    emitToUsers([me, ...okIds], 'conversation:new', { id: c.id });
    return c.id;
  }
  if (!b.userId) throw bad('Choose someone to chat with');
  return findOrCreateDirect(me, b.userId);
}
chatRouter.post('/', validate({ body: createBody }), wrap(async (req, res) => { const id = await createConversation(req); res.status(201).json(await oneConversation(req.user.id, id)); }));
chatRouter.post('/direct', validate({ body: z.object({ userId: uuid }) }), wrap(async (req, res) => { res.json(await oneConversation(req.user.id, await findOrCreateDirect(req.user.id, req.body.userId))); }));

// read-all must be before /:id
chatRouter.patch('/read-all', wrap(async (req, res) => {
  const locked = await lockedConversationIds(req.user.id);
  await prisma.conversationMember.updateMany({ where: { userId: req.user.id, leftAt: null, conversationId: { notIn: locked } }, data: { lastReadAt: new Date() } });
  res.json({ ok: true });
}));

chatRouter.get('/:id', validate({ params: idParam }), wrap(async (req, res) => {
  await requireMember(req.user.id, req.params.id);
  await assertConversationAccessible(req, req.params.id);
  res.json(await oneConversation(req.user.id, req.params.id));
}));

// ───────────────────────────── per-user chat preferences ─────────────────────────────

const prefBody = z.object({
  pinned: z.boolean().optional(), archived: z.boolean().optional(), favorite: z.boolean().optional(), wallpaper: z.string().max(300).nullable().optional(),
  muted: z.union([z.boolean(), z.string().datetime()]).optional(), contactName: z.string().max(60).nullable().optional(), contactPhone: z.string().max(25).nullable().optional(),
  disappearAfterSec: z.number().int().min(5).max(31536000).nullable().optional(),
});
chatRouter.patch('/:id', validate({ params: idParam, body: prefBody }), wrap(async (req, res) => {
  const me = req.user.id; const id = req.params.id; const b = req.body as z.infer<typeof prefBody>;
  const m = await requireMember(me, id);
  await assertConversationAccessible(req, id);
  const data: Prisma.ConversationMemberUpdateInput = {};
  if (b.pinned !== undefined) {
    if (b.pinned) { const n = await prisma.conversationMember.count({ where: { userId: me, pinnedAt: { not: null } } }); if (n >= 3 && !m.pinnedAt) throw bad('You can pin up to 3 chats'); }
    data.pinnedAt = b.pinned ? m.pinnedAt ?? new Date() : null;
  }
  if (b.archived !== undefined) data.archivedAt = b.archived ? new Date() : null;
  if (b.favorite !== undefined) data.favorite = b.favorite;
  if (b.wallpaper !== undefined) data.wallpaper = b.wallpaper;
  if (b.muted !== undefined) data.mutedUntil = b.muted === false ? null : b.muted === true ? FOREVER : new Date(b.muted);
  if (b.contactName !== undefined) data.contactName = b.contactName;
  if (b.contactPhone !== undefined) data.contactPhone = b.contactPhone;
  if (Object.keys(data).length) await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: me } }, data });
  if (b.disappearAfterSec !== undefined) {
    if (m.conversation.type === 'GROUP' && m.role === 'MEMBER') throw forbidden('Only group admins can change disappearing messages');
    await prisma.conversation.update({ where: { id }, data: { disappearAfterSec: b.disappearAfterSec } });
    const name = (await prisma.user.findUniqueOrThrow({ where: { id: me } })).fullName;
    await systemMessage(id, b.disappearAfterSec ? `${name} turned on disappearing messages` : `${name} turned off disappearing messages`);
  }
  res.json(await oneConversation(me, id));
}));

chatRouter.patch('/:id/lock', validate({ params: idParam, body: z.object({ locked: z.boolean() }) }), wrap(async (req, res) => {
  await setLocked(req, req.params.id, req.body.locked);
  res.json(await oneConversation(req.user.id, req.params.id));
}));

// "delete chat" = clear it for me (the other person keeps their copy); groups: leave
chatRouter.delete('/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const m = await requireMember(req.user.id, req.params.id);
  await assertConversationAccessible(req, req.params.id);
  if (m.conversation.type === 'GROUP') { await leaveGroup(req.user.id, req.params.id); return res.json({ ok: true, left: true }); }
  await clearFor(req.user.id, req.params.id);
  res.json({ ok: true });
}));
chatRouter.post('/:id/clear', validate({ params: idParam }), wrap(async (req, res) => {
  await requireMember(req.user.id, req.params.id); await assertConversationAccessible(req, req.params.id);
  await clearFor(req.user.id, req.params.id); res.json({ ok: true });
}));
async function clearFor(me: string, conversationId: string) {
  await prisma.$executeRaw`INSERT INTO message_deletions ("messageId","userId") SELECT id, ${me}::uuid FROM messages WHERE "conversationId" = ${conversationId}::uuid ON CONFLICT DO NOTHING`;
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: me } }, data: { lastReadAt: new Date() } });
}

// ───────────────────────────── messages: list ─────────────────────────────

const listQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(30), before: z.string().datetime().optional() });
chatRouter.get('/:id/messages', validate({ params: idParam, query: listQuery }), wrap(async (req, res) => {
  const { page: pg, limit, before } = q<z.infer<typeof listQuery>>(req); const me = req.user.id; const id = req.params.id;
  await requireMember(me, id); await assertConversationAccessible(req, id);
  const where: Prisma.MessageWhereInput = { conversationId: id, deletions: { none: { userId: me } }, ...live(), ...(before ? { createdAt: { lt: new Date(before) } } : {}) };
  const rows = await prisma.message.findMany({ where, include: messageInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, skip: before ? 0 : (pg - 1) * limit });
  const hasMore = rows.length > limit; const items = rows.slice(0, limit).reverse();
  const members = await membersOf(id);
  res.json({ items: items.map((m) => messageDto(m, me, members)), hasMore, nextBefore: items[0]?.createdAt ?? null });
}));
chatRouter.get('/:id/messages/search', validate({ params: idParam, query: z.object({ q: z.string().trim().min(1).max(100) }) }), wrap(async (req, res) => {
  const me = req.user.id; const id = req.params.id;
  await requireMember(me, id); await assertConversationAccessible(req, id);
  const rows = await prisma.message.findMany({ where: { conversationId: id, deletedAt: null, text: { contains: q<{ q: string }>(req).q, mode: 'insensitive' }, deletions: { none: { userId: me } }, ...live() }, include: messageInclude, orderBy: { createdAt: 'desc' }, take: 50 });
  const members = await membersOf(id);
  res.json(rows.map((m) => messageDto(m, me, members)));
}));
chatRouter.get('/:id/pinned', validate({ params: idParam }), wrap(async (req, res) => {
  const me = req.user.id; const id = req.params.id;
  await requireMember(me, id); await assertConversationAccessible(req, id);
  const rows = await prisma.message.findMany({ where: { conversationId: id, pinnedAt: { not: null }, deletedAt: null, deletions: { none: { userId: me } } }, include: messageInclude, orderBy: { pinnedAt: 'desc' }, take: 20 });
  const members = await membersOf(id);
  res.json(rows.map((m) => messageDto(m, me, members)));
}));
chatRouter.get('/:id/media', validate({ params: idParam }), wrap(async (req, res) => { // "Media, links and docs"
  const me = req.user.id; const id = req.params.id;
  await requireMember(me, id); await assertConversationAccessible(req, id);
  const rows = await prisma.message.findMany({ where: { conversationId: id, deletedAt: null, type: { in: ['IMAGE', 'VIDEO', 'DOCUMENT', 'GIF'] }, deletions: { none: { userId: me } }, ...live() }, include: messageInclude, orderBy: { createdAt: 'desc' }, take: 100 });
  const members = await membersOf(id);
  res.json(rows.map((m) => messageDto(m, me, members)));
}));

// ───────────────────────────── messages: send ─────────────────────────────

async function systemMessage(conversationId: string, text: string) {
  const m = await prisma.message.create({ data: { conversationId, type: 'SYSTEM', text }, include: messageInclude });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: m.createdAt } });
  const members = await membersOf(conversationId);
  for (const uid of members) emitToUser(uid, 'message:new', messageDto(m, uid, members));
}

interface SendInput {
  conversationId: string; senderId: string; type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'VOICE' | 'DOCUMENT' | 'GIF' | 'STICKER' | 'STORY' | 'LOVE_NOTE';
  text?: string | null; clientId?: string; replyToId?: string | null; forwardedFromId?: string | null; storyId?: string | null; storyKind?: string | null; emoji?: string | null;
  storySnapshot?: unknown; attachments?: Prisma.MessageAttachmentCreateWithoutMessageInput[]; skipBlockCheck?: boolean;
}
/** The one place a message is created: validation, persistence, streak, delivery marking, fan-out, push. */
export async function sendMessage(input: SendInput) {
  const { conversationId, senderId } = input;
  const mem = await prisma.conversationMember.findFirst({ where: { conversationId, userId: senderId, leftAt: null }, include: { conversation: { include: { group: true, members: { where: { leftAt: null }, select: { userId: true } } } } } });
  if (!mem) throw notFound('Conversation not found');
  const conv = mem.conversation; const memberIds = conv.members.map((m) => m.userId);
  if (conv.type === 'GROUP' && conv.group?.onlyAdminsPost && mem.role === 'MEMBER') throw forbidden('Only admins can send messages in this group');
  if (conv.type !== 'GROUP' && !input.skipBlockCheck) {
    const other = memberIds.find((u) => u !== senderId);
    if (other && (await isBlockedBetween(senderId, other))) throw new HttpError(403, 'You can’t message this person');
    const o = other ? await prisma.user.findUnique({ where: { id: other }, select: { status: true } }) : null;
    if (o && o.status !== 'ACTIVE') throw new HttpError(403, 'This account is unavailable');
  }
  if (input.replyToId) {
    const r = await prisma.message.findFirst({ where: { id: input.replyToId, conversationId }, select: { id: true } });
    if (!r) throw bad('The message you are replying to no longer exists');
  }
  if (input.type === 'TEXT' || input.type === 'LOVE_NOTE') {
    const t = (input.text ?? '').trim();
    if (!t) throw bad('Write a message first');
    if (t.length > 8000) throw bad('Messages can be up to 8000 characters');
    input.text = t;
  }
  if (input.clientId) { // idempotent retry: same clientId from the same sender returns the original message
    const dup = await prisma.message.findFirst({ where: { conversationId, senderId, clientId: input.clientId }, include: messageInclude });
    if (dup) return { message: dup, memberIds, duplicate: true };
  }
  const now = new Date();
  const online = await onlineSet(memberIds.filter((u) => u !== senderId));
  let streak: Awaited<ReturnType<typeof recordActivity>> = null;
  const msg = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId, senderId, type: input.type as any, text: input.text ?? null, clientId: input.clientId, replyToId: input.replyToId, forwardedFromId: input.forwardedFromId,
        storyId: input.storyId, storyKind: input.storyKind, emoji: input.emoji, storySnapshot: input.storySnapshot as any, createdAt: now,
        expiresAt: conv.disappearAfterSec ? new Date(now.getTime() + conv.disappearAfterSec * 1000) : null,
        attachments: input.attachments?.length ? { create: input.attachments } : undefined,
        // receipts for everyone else; people who are online right now are marked delivered immediately
        receipts: { create: memberIds.filter((u) => u !== senderId).map((userId) => ({ userId, deliveredAt: online.has(userId) ? now : null })) },
      },
      include: messageInclude,
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
    await tx.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: senderId } }, data: { lastReadAt: now, archivedAt: null } });
    await tx.conversationMember.updateMany({ where: { conversationId, userId: { not: senderId }, archivedAt: { not: null } }, data: { archivedAt: null } }); // new message un-archives
    const kind = ({ TEXT: 'text', IMAGE: 'image', VIDEO: 'video', VOICE: 'voice' } as Record<string, string>)[input.type];
    if (kind) streak = await recordActivity(tx, { conversationId, userId: senderId, messageId: created.id, kind: kind as any, text: input.text });
    return created;
  });
  return { message: msg, memberIds, duplicate: false, streak: streak as Awaited<ReturnType<typeof recordActivity>>, online };
}

async function afterSend(r: Awaited<ReturnType<typeof sendMessage>>, senderId: string) {
  if (r.duplicate) return;
  const { message, memberIds } = r;
  for (const uid of memberIds) emitToUser(uid, 'message:new', messageDto(message, uid, memberIds));
  const sender = await prisma.user.findUnique({ where: { id: senderId }, select: { fullName: true } });
  const conv = await prisma.conversation.findUnique({ where: { id: message.conversationId }, include: { group: true } });
  const title = conv?.type === 'GROUP' ? `${sender?.fullName} @ ${conv.group?.name}` : sender?.fullName || 'New message';
  const offline = memberIds.filter((u) => u !== senderId && !r.online?.has(u));
  const rows = offline.length ? await prisma.conversationMember.findMany({ where: { conversationId: message.conversationId, userId: { in: offline } }, include: { user: { select: { settings: true } } } }) : [];
  for (const m of rows) {
    const s = m.user.settings;
    if ((m.mutedUntil && m.mutedUntil > new Date()) || (s && (!s.pushEnabled || !s.notifyMessages || inQuietHours(s)))) continue;
    if (await isBlockedBetween(m.userId, senderId)) continue;
    void sendPush(m.userId, title, s?.hideNotificationPreviews ? 'New message' : previewText(message as any), { type: 'MESSAGE', conversationId: message.conversationId, messageId: message.id });
  }
  if (r.streak) await broadcastStreak(message.conversationId, r.streak);
  // tell the sender which messages are already delivered
  if (r.online && r.online.size) emitToUser(senderId, 'message:status', { id: message.id, conversationId: message.conversationId, status: memberIds.filter((u) => u !== senderId).every((u) => r.online!.has(u)) ? 'delivered' : 'sent' });
}

const sendBody = z.object({
  type: z.enum(['text', 'love_note', 'sticker', 'gif']).default('text'), text: z.string().max(8000).optional(), replyToId: uuid.nullish(), clientId: z.string().min(8).max(64).optional(),
  gifUrl: z.string().url().max(500).optional(),
});
chatRouter.post('/:id/messages', sendLimiter, validate({ params: idParam, body: sendBody }), wrap(async (req, res) => {
  await assertConversationAccessible(req, req.params.id);
  const b = req.body as z.infer<typeof sendBody>;
  const type = b.type === 'love_note' ? 'LOVE_NOTE' : b.type === 'sticker' ? 'STICKER' : b.type === 'gif' ? 'GIF' : 'TEXT';
  if (type === 'LOVE_NOTE') { const c = await prisma.conversation.findUnique({ where: { id: req.params.id }, select: { type: true } }); if (c?.type !== 'COUPLE') throw bad('Love notes are for couple chats'); }
  const attachments = b.type === 'gif' && b.gifUrl ? [{ kind: 'gif', storageKey: b.gifUrl, url: b.gifUrl, mime: 'image/gif', sizeBytes: 0 }] : undefined;
  const r = await sendMessage({ conversationId: req.params.id, senderId: req.user.id, type: type as any, text: b.text ?? (type === 'STICKER' ? undefined : undefined), replyToId: b.replyToId, clientId: b.clientId, attachments });
  await afterSend(r, req.user.id);
  const members = r.memberIds;
  res.status(r.duplicate ? 200 : 201).json(messageDto(r.message, req.user.id, members));
}));

chatRouter.post('/:id/media', uploadLimiter, sendLimiter, upload.single('file'), wrap(async (req, res) => {
  const id = req.params.id; z.string().uuid().parse(id);
  await requireMember(req.user.id, id); await assertConversationAccessible(req, id);
  if (!req.file) throw bad('Choose a file to send');
  const hint = String(req.body.type || '');
  const accept = hint === 'voice' ? ['voice'] : hint === 'document' || hint === 'doc' ? ['document'] : ['image', 'video', 'gif', 'document', 'voice'];
  const saved = await saveUpload(req.file, { folder: 'chat', accept: accept as any, thumb: 480 });
  const durationMs = saved.durationMs ?? (req.body.durationMs ? Math.min(Number(req.body.durationMs) || 0, 3_600_000) : undefined);
  const typeMap = { image: 'IMAGE', video: 'VIDEO', voice: 'VOICE', document: 'DOCUMENT', gif: 'GIF' } as const;
  const r = await sendMessage({
    conversationId: id, senderId: req.user.id, type: typeMap[saved.kind], text: String(req.body.caption || '').slice(0, 1000) || null, replyToId: req.body.replyToId || undefined, clientId: req.body.clientId || undefined,
    attachments: [{ kind: saved.kind, storageKey: saved.key, url: saved.key, thumbUrl: saved.thumbKey, mime: saved.mime, sizeBytes: saved.size, width: saved.width, height: saved.height, durationMs, fileName: saved.fileName }],
  });
  await afterSend(r, req.user.id);
  res.status(201).json(messageDto(r.message, req.user.id, r.memberIds));
}));

// ───────────────────────────── read / delivered ─────────────────────────────

export async function markRead(me: string, conversationId: string) {
  const mem = await prisma.conversationMember.findFirst({ where: { conversationId, userId: me, leftAt: null } });
  if (!mem) return { ids: [] as string[] };
  const settings = await prisma.userSettings.findUnique({ where: { userId: me }, select: { readReceipts: true } });
  const now = new Date();
  const unread = await prisma.message.findMany({ where: { conversationId, senderId: { not: me }, receipts: { some: { userId: me, readAt: null } } }, select: { id: true, senderId: true }, take: 500 });
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: me } }, data: { lastReadAt: now } });
  if (!unread.length) return { ids: [] };
  const ids = unread.map((m) => m.id);
  if (settings?.readReceipts !== false) { // with read receipts off the sender only ever sees "delivered"
    await prisma.messageReadReceipt.updateMany({ where: { messageId: { in: ids }, userId: me, readAt: null }, data: { readAt: now, deliveredAt: now } });
    const bySender = new Map<string, string[]>();
    for (const m of unread) if (m.senderId) (bySender.get(m.senderId) ?? bySender.set(m.senderId, []).get(m.senderId)!).push(m.id);
    for (const [sender, mids] of bySender) for (const mid of mids) emitToUser(sender, 'message:status', { id: mid, conversationId, status: 'read', by: me });
  } else {
    await prisma.messageReadReceipt.updateMany({ where: { messageId: { in: ids }, userId: me, deliveredAt: null }, data: { deliveredAt: now } });
  }
  emitToUser(me, 'conversation:read', { conversationId });
  return { ids };
}
chatRouter.post('/:id/read', validate({ params: idParam }), wrap(async (req, res) => {
  await requireMember(req.user.id, req.params.id); await assertConversationAccessible(req, req.params.id);
  const r = await markRead(req.user.id, req.params.id);
  res.json({ ok: true, count: r.ids.length });
}));

/** On socket connect: everything waiting for this user becomes "delivered". */
export async function markDeliveredFor(userId: string) {
  const now = new Date();
  const pending = await prisma.messageReadReceipt.findMany({ where: { userId, deliveredAt: null, readAt: null }, select: { messageId: true, message: { select: { senderId: true, conversationId: true } } }, take: 1000 });
  if (!pending.length) return;
  await prisma.messageReadReceipt.updateMany({ where: { userId, messageId: { in: pending.map((p) => p.messageId) }, deliveredAt: null }, data: { deliveredAt: now } });
  for (const p of pending) if (p.message.senderId) emitToUser(p.message.senderId, 'message:status', { id: p.messageId, conversationId: p.message.conversationId, status: 'delivered', by: userId });
}

// ───────────────────────────── reactions, pins ─────────────────────────────

async function loadMessage(me: string, mid: string, cid?: string) {
  const m = await prisma.message.findUnique({ where: { id: mid } });
  if (!m || (cid && m.conversationId !== cid)) throw notFound('Message not found');
  await requireMember(me, m.conversationId);
  return m;
}
const emojiBody = z.object({ emoji: z.string().min(1).max(16) });
async function react(req: Request, mid: string, cid?: string) {
  const m = await loadMessage(req.user.id, mid, cid);
  await assertConversationAccessible(req, m.conversationId);
  if (m.deletedAt) throw bad('That message was deleted');
  const mine = await prisma.messageReaction.findUnique({ where: { messageId_userId: { messageId: mid, userId: req.user.id } } });
  let emoji: string | null = req.body.emoji;
  if (mine && mine.emoji === emoji) { await prisma.messageReaction.delete({ where: { messageId_userId: { messageId: mid, userId: req.user.id } } }); emoji = null; }
  else await prisma.messageReaction.upsert({ where: { messageId_userId: { messageId: mid, userId: req.user.id } }, create: { messageId: mid, userId: req.user.id, emoji: emoji! }, update: { emoji: emoji! } });
  const members = await membersOf(m.conversationId);
  emitToUsers(members, 'message:reaction', { messageId: mid, conversationId: m.conversationId, emoji, userId: req.user.id });
  if (emoji && m.senderId && m.senderId !== req.user.id) void notifyReaction(m.senderId, req.user.id, emoji, m.conversationId);
  return { messageId: mid, emoji };
}
async function notifyReaction(to: string, from: string, emoji: string, conversationId: string) {
  const u = await prisma.user.findUnique({ where: { id: from }, select: { fullName: true } });
  await sendPush(to, u?.fullName || 'Someone', `Reacted ${emoji} to your message`, { type: 'MESSAGE', conversationId });
}
chatRouter.post('/:cid/messages/:mid/reactions', validate({ params: z.object({ cid: uuid, mid: uuid }), body: emojiBody }), wrap(async (req, res) => { res.json(await react(req, req.params.mid, req.params.cid)); }));
chatRouter.post('/:cid/messages/:mid/pin', validate({ params: z.object({ cid: uuid, mid: uuid }) }), wrap(async (req, res) => {
  const m = await loadMessage(req.user.id, req.params.mid, req.params.cid);
  await assertConversationAccessible(req, m.conversationId);
  const count = await prisma.message.count({ where: { conversationId: m.conversationId, pinnedAt: { not: null } } });
  if (count >= 3 && !m.pinnedAt) throw bad('You can pin up to 3 messages');
  await prisma.message.update({ where: { id: m.id }, data: { pinnedAt: m.pinnedAt ?? new Date(), pinnedById: req.user.id } });
  emitToConversation(m.conversationId, 'message:pinned', { messageId: m.id, conversationId: m.conversationId, pinned: true });
  res.json({ pinned: true });
}));
chatRouter.delete('/:cid/messages/:mid/pin', validate({ params: z.object({ cid: uuid, mid: uuid }) }), wrap(async (req, res) => {
  const m = await loadMessage(req.user.id, req.params.mid, req.params.cid);
  await assertConversationAccessible(req, m.conversationId);
  await prisma.message.update({ where: { id: m.id }, data: { pinnedAt: null, pinnedById: null } });
  emitToConversation(m.conversationId, 'message:pinned', { messageId: m.id, conversationId: m.conversationId, pinned: false });
  res.json({ pinned: false });
}));

// ───────────────────────────── /messages/* (edit, delete, forward, star, react) ─────────────────────────────

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

messagesRouter.get('/starred', wrap(async (req, res) => {
  const locked = await lockedConversationIds(req.user.id);
  const rows = await prisma.message.findMany({ where: { stars: { some: { userId: req.user.id } }, deletedAt: null, conversationId: { notIn: locked } }, include: { ...messageInclude, conversation: { select: { type: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  const out = [];
  for (const m of rows) { const mem = await membersOf(m.conversationId); if (mem.includes(req.user.id)) out.push(messageDto(m, req.user.id, mem)); }
  res.json(out);
}));
messagesRouter.get('/search', validate({ query: z.object({ q: z.string().trim().min(2).max(100) }) }), wrap(async (req, res) => {
  const me = req.user.id; const locked = await lockedConversationIds(me);
  const rows = await prisma.message.findMany({ where: { deletedAt: null, text: { contains: q<{ q: string }>(req).q, mode: 'insensitive' }, conversation: { members: { some: { userId: me, leftAt: null } } }, conversationId: { notIn: locked }, deletions: { none: { userId: me } }, ...live() }, include: messageInclude, orderBy: { createdAt: 'desc' }, take: 40 });
  res.json(rows.map((m) => messageDto(m, me, [])));
}));
messagesRouter.post('/:id/reactions', validate({ params: idParam, body: emojiBody }), wrap(async (req, res) => { res.json(await react(req, req.params.id)); }));

messagesRouter.put('/:id', validate({ params: idParam, body: z.object({ text: z.string().trim().min(1).max(8000) }) }), wrap(async (req, res) => {
  const m = await loadMessage(req.user.id, req.params.id);
  await assertConversationAccessible(req, m.conversationId);
  if (m.senderId !== req.user.id) throw forbidden('You can only edit your own messages');
  if (m.type !== 'TEXT' || m.deletedAt) throw bad('Only text messages can be edited');
  if (Date.now() - m.createdAt.getTime() > EDIT_WINDOW_MS) throw bad('You can edit a message for 15 minutes after sending it');
  const u = await prisma.message.update({ where: { id: m.id }, data: { text: req.body.text, editedAt: new Date() }, include: messageInclude });
  const members = await membersOf(m.conversationId);
  for (const uid of members) emitToUser(uid, 'message:edited', messageDto(u, uid, members));
  res.json(messageDto(u, req.user.id, members));
}));

export async function unreferenced(keys: (string | null)[]) {
  for (const k of keys.filter(Boolean) as string[]) {
    const n = await prisma.messageAttachment.count({ where: { OR: [{ storageKey: k }, { thumbUrl: k }, { url: k }] } });
    if (n === 0) await removeObject(k);
  }
}
messagesRouter.delete('/:id', validate({ params: idParam, query: z.object({ scope: z.enum(['me', 'everyone']).default('me') }) }), wrap(async (req, res) => {
  const m = await loadMessage(req.user.id, req.params.id);
  await assertConversationAccessible(req, m.conversationId);
  const scope = q<{ scope: string }>(req).scope;
  if (scope === 'me') {
    await prisma.messageDeletion.upsert({ where: { messageId_userId: { messageId: m.id, userId: req.user.id } }, create: { messageId: m.id, userId: req.user.id }, update: {} });
    return res.json({ ok: true, scope });
  }
  const mem = await requireMember(req.user.id, m.conversationId);
  const groupAdmin = mem.conversation.type === 'GROUP' && mem.role !== 'MEMBER';
  if (m.senderId !== req.user.id && !groupAdmin) throw forbidden('You can only delete your own messages for everyone');
  if (m.senderId === req.user.id && Date.now() - m.createdAt.getTime() > DELETE_EVERYONE_MS) throw bad('You can delete for everyone within 48 hours of sending');
  const atts = await prisma.messageAttachment.findMany({ where: { messageId: m.id } });
  await prisma.$transaction([
    prisma.message.update({ where: { id: m.id }, data: { deletedAt: new Date(), text: null, pinnedAt: null, pinnedById: null } }),
    prisma.messageAttachment.deleteMany({ where: { messageId: m.id } }),
    prisma.messageReaction.deleteMany({ where: { messageId: m.id } }),
  ]);
  await unreferenced(atts.flatMap((a) => [a.storageKey, a.thumbUrl]));
  emitToConversation(m.conversationId, 'message:deleted', { id: m.id, conversationId: m.conversationId, scope: 'everyone' });
  res.json({ ok: true, scope });
}));

messagesRouter.post('/:id/star', validate({ params: idParam }), wrap(async (req, res) => {
  const m = await loadMessage(req.user.id, req.params.id);
  await prisma.starredMessage.upsert({ where: { messageId_userId: { messageId: m.id, userId: req.user.id } }, create: { messageId: m.id, userId: req.user.id }, update: {} });
  res.json({ starred: true });
}));
messagesRouter.delete('/:id/star', validate({ params: idParam }), wrap(async (req, res) => { await prisma.starredMessage.deleteMany({ where: { messageId: req.params.id, userId: req.user.id } }); res.json({ starred: false }); }));

messagesRouter.post('/:id/forward', sendLimiter, validate({ params: idParam, body: z.object({ conversationIds: z.array(uuid).min(1).max(10) }) }), wrap(async (req, res) => {
  const m = await prisma.message.findUnique({ where: { id: req.params.id }, include: { attachments: true } });
  if (!m || m.deletedAt) throw notFound('Message not found');
  await requireMember(req.user.id, m.conversationId); await assertConversationAccessible(req, m.conversationId);
  if (m.type === 'SYSTEM' || m.type === 'LOVE_NOTE') throw bad('This message cannot be forwarded');
  const sent = [];
  for (const cid of new Set(req.body.conversationIds as string[])) {
    await assertConversationAccessible(req, cid);
    const r = await sendMessage({
      conversationId: cid, senderId: req.user.id, type: m.type as any, text: m.text, forwardedFromId: m.id,
      attachments: m.attachments.map((a) => ({ kind: a.kind, storageKey: a.storageKey, url: a.url, thumbUrl: a.thumbUrl, mime: a.mime, sizeBytes: a.sizeBytes, width: a.width, height: a.height, durationMs: a.durationMs, fileName: a.fileName })),
    });
    await afterSend(r, req.user.id); sent.push({ conversationId: cid, id: r.message.id });
  }
  res.status(201).json({ ok: true, sent });
}));

// ───────────────────────────── groups ─────────────────────────────

async function leaveGroup(userId: string, conversationId: string) {
  const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { group: true } });
  const mem = await prisma.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId, userId } } });
  await prisma.$transaction([
    prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { leftAt: new Date(), pinnedAt: null } }),
    prisma.groupMember.deleteMany({ where: { groupId: conv.group!.id, userId } }),
    prisma.privateChat.deleteMany({ where: { userId, conversationId } }),
  ]);
  if (mem.role === 'OWNER') { // hand ownership to the longest-standing admin, else the oldest member
    const next = await prisma.conversationMember.findFirst({ where: { conversationId, leftAt: null }, orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }] });
    if (next) await prisma.$transaction([
      prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: next.userId } }, data: { role: 'OWNER' } }),
      prisma.groupMember.updateMany({ where: { groupId: conv.group!.id, userId: next.userId }, data: { role: 'OWNER' } }),
    ]);
  }
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await systemMessage(conversationId, `${u.fullName} left`);
  emitToUser(userId, 'conversation:removed', { id: conversationId });
}
const needAdmin = async (me: string, id: string) => {
  const m = await requireMember(me, id);
  if (m.conversation.type !== 'GROUP') throw bad('This is not a group');
  if (m.role === 'MEMBER') throw forbidden('Only group admins can do that');
  return m;
};
chatRouter.get('/:id/members', validate({ params: idParam }), wrap(async (req, res) => {
  const mem = await requireMember(req.user.id, req.params.id); await assertConversationAccessible(req, req.params.id);
  const rows = await prisma.conversationMember.findMany({ where: { conversationId: req.params.id, leftAt: null }, include: { user: { include: { profile: true } } }, orderBy: { joinedAt: 'asc' } });
  const on = await onlineSet(rows.map((r) => r.userId));
  res.json({ inviteCode: mem.role !== 'MEMBER' ? mem.conversation.group?.inviteCode : undefined, members: rows.map((r) => ({ ...card(r.user), role: r.role.toLowerCase(), online: on.has(r.userId), joinedAt: r.joinedAt })) });
}));
chatRouter.patch('/:id/group', validate({ params: idParam, body: z.object({ name: z.string().trim().min(1).max(60).optional(), about: z.string().max(300).optional(), onlyAdminsPost: z.boolean().optional() }) }), wrap(async (req, res) => {
  const m = await needAdmin(req.user.id, req.params.id);
  await prisma.group.update({ where: { id: m.conversation.group!.id }, data: req.body });
  emitToConversation(req.params.id, 'conversation:updated', { id: req.params.id });
  res.json(await oneConversation(req.user.id, req.params.id));
}));
chatRouter.post('/:id/group/avatar', uploadLimiter, upload.single('avatar'), wrap(async (req, res) => {
  const m = await needAdmin(req.user.id, req.params.id);
  if (!req.file) throw bad('Choose a picture');
  const saved = await saveUpload(req.file, { folder: 'groups', accept: ['image'], thumb: 160, maxDim: 1024 });
  const old = m.conversation.group!.avatarUrl;
  await prisma.group.update({ where: { id: m.conversation.group!.id }, data: { avatarUrl: saved.key } });
  await removeObject(old);
  res.json(await oneConversation(req.user.id, req.params.id));
}));
chatRouter.post('/:id/members', validate({ params: idParam, body: z.object({ userIds: z.array(uuid).min(1).max(100) }) }), wrap(async (req, res) => {
  const m = await needAdmin(req.user.id, req.params.id);
  const blocked = new Set(await blockedIds(req.user.id));
  const users = await prisma.user.findMany({ where: { id: { in: req.body.userIds }, status: 'ACTIVE' }, select: { id: true, fullName: true } });
  const added: string[] = [];
  for (const u of users) {
    if (blocked.has(u.id)) continue;
    const cur = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: req.params.id, userId: u.id } } });
    if (cur && !cur.leftAt) continue;
    await prisma.$transaction([
      prisma.conversationMember.upsert({ where: { conversationId_userId: { conversationId: req.params.id, userId: u.id } }, create: { conversationId: req.params.id, userId: u.id }, update: { leftAt: null, role: 'MEMBER', joinedAt: new Date(), lastReadAt: new Date() } }),
      prisma.groupMember.upsert({ where: { groupId_userId: { groupId: m.conversation.group!.id, userId: u.id } }, create: { groupId: m.conversation.group!.id, userId: u.id, addedById: req.user.id }, update: { role: 'MEMBER' } }),
    ]);
    added.push(u.id);
    await notify({ userId: u.id, actorId: req.user.id, type: 'GROUP_INVITE', title: 'Added to a group', body: `You were added to ${m.conversation.group!.name}`, data: { conversationId: req.params.id } });
    await systemMessage(req.params.id, `${u.fullName} was added`);
    emitToUser(u.id, 'conversation:new', { id: req.params.id });
  }
  res.json({ added });
}));
chatRouter.delete('/:id/members/:uid', validate({ params: z.object({ id: uuid, uid: uuid }) }), wrap(async (req, res) => {
  if (req.params.uid === req.user.id) { await requireMember(req.user.id, req.params.id); await leaveGroup(req.user.id, req.params.id); return res.json({ ok: true }); }
  const me = await needAdmin(req.user.id, req.params.id);
  const target = await prisma.conversationMember.findFirst({ where: { conversationId: req.params.id, userId: req.params.uid, leftAt: null }, include: { user: true } });
  if (!target) throw notFound('Member not found');
  if (target.role === 'OWNER' || (target.role === 'ADMIN' && me.role !== 'OWNER')) throw forbidden('You cannot remove this member');
  await prisma.$transaction([
    prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: req.params.id, userId: target.userId } }, data: { leftAt: new Date() } }),
    prisma.groupMember.deleteMany({ where: { groupId: me.conversation.group!.id, userId: target.userId } }),
    prisma.privateChat.deleteMany({ where: { userId: target.userId, conversationId: req.params.id } }),
  ]);
  await systemMessage(req.params.id, `${target.user.fullName} was removed`);
  emitToUser(target.userId, 'conversation:removed', { id: req.params.id });
  res.json({ ok: true });
}));
chatRouter.put('/:id/members/:uid/role', validate({ params: z.object({ id: uuid, uid: uuid }), body: z.object({ role: z.enum(['member', 'admin']) }) }), wrap(async (req, res) => {
  const me = await needAdmin(req.user.id, req.params.id);
  if (me.role !== 'OWNER') throw forbidden('Only the group owner can change roles');
  const role = req.body.role === 'admin' ? 'ADMIN' : 'MEMBER';
  const t = await prisma.conversationMember.findFirst({ where: { conversationId: req.params.id, userId: req.params.uid, leftAt: null } });
  if (!t || t.role === 'OWNER') throw bad('That role cannot be changed');
  await prisma.$transaction([
    prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: req.params.id, userId: req.params.uid } }, data: { role } }),
    prisma.groupMember.updateMany({ where: { groupId: me.conversation.group!.id, userId: req.params.uid }, data: { role } }),
  ]);
  res.json({ ok: true, role: req.body.role });
}));
chatRouter.post('/:id/invite-code/reset', validate({ params: idParam }), wrap(async (req, res) => {
  const m = await needAdmin(req.user.id, req.params.id);
  const g = await prisma.group.update({ where: { id: m.conversation.group!.id }, data: { inviteCode: randomId(14) } });
  res.json({ inviteCode: g.inviteCode });
}));

export const groupsRouter = Router();
groupsRouter.use(requireAuth);
groupsRouter.post('/join', validate({ body: z.object({ code: z.string().min(8).max(40) }) }), wrap(async (req, res) => {
  const g = await prisma.group.findUnique({ where: { inviteCode: req.body.code }, include: { conversation: true } });
  if (!g) throw notFound('That invite link is not valid any more');
  const cur = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: g.conversationId, userId: req.user.id } } });
  if (!cur || cur.leftAt) {
    await prisma.$transaction([
      prisma.conversationMember.upsert({ where: { conversationId_userId: { conversationId: g.conversationId, userId: req.user.id } }, create: { conversationId: g.conversationId, userId: req.user.id }, update: { leftAt: null, role: 'MEMBER', joinedAt: new Date(), lastReadAt: new Date() } }),
      prisma.groupMember.upsert({ where: { groupId_userId: { groupId: g.id, userId: req.user.id } }, create: { groupId: g.id, userId: req.user.id }, update: {} }),
    ]);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
    await systemMessage(g.conversationId, `${u.fullName} joined using the invite link`);
  }
  res.json(await oneConversation(req.user.id, g.conversationId));
}));

void page; void isOnline; void hasPrivateAccess;
