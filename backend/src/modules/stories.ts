import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma } from '../lib/db';
import { HttpError, bad, forbidden, notFound } from '../lib/errors';
import { idParam, uuid, validate, wrap } from '../lib/http';
import { notify } from '../lib/notify';
import { emitToUser } from '../lib/realtime';
import { removeObject, saveUpload, toUrl } from '../lib/storage';
import { requireAuth } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { upload } from '../middleware/upload';
import { blockedIds, isBlockedBetween, MS } from './common';
import { ensureDirectConversation, sendMessage } from './chat';
import { messageDto } from './chat';

export const storiesRouter = Router();
storiesRouter.use(requireAuth);

const TTL_MS = 24 * MS.hour;
const L2T = { photo: 'PHOTO', video: 'VIDEO', text: 'TEXT' } as const;
const ago = (d: Date) => { const m = Math.floor((Date.now() - d.getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`; };
const active = (): Prisma.StoryWhereInput => ({ deletedAt: null, expiresAt: { gt: new Date() } });

type StoryRow = Prisma.StoryGetPayload<{ include: { viewers: { select: { viewerId: true } }; reactions: { select: { userId: true; emoji: true } } } }>;

/** The audience rules. Returns true when `viewerId` may see this story. */
async function canSee(viewerId: string, s: { userId: string; privacy: string; audienceIds: string[] }): Promise<boolean> {
  if (s.userId === viewerId) return true;
  if (await isBlockedBetween(viewerId, s.userId)) return false;
  const follows = !!(await prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: viewerId, followeeId: s.userId } } }));
  switch (s.privacy) {
    case 'EVERYONE': { const owner = await prisma.user.findUnique({ where: { id: s.userId }, select: { isPrivate: true } }); return !owner?.isPrivate || follows; }
    case 'FOLLOWERS': return follows;
    case 'SELECTED': return s.audienceIds.includes(viewerId);
    case 'COUPLE': return !!(await prisma.coupleConnection.findFirst({ where: { status: 'ACTIVE', OR: [{ inviterId: viewerId, inviteeId: s.userId }, { inviterId: s.userId, inviteeId: viewerId }] }, select: { id: true } }));
    default: return false;
  }
}

const itemDto = (s: StoryRow, me: string) => ({
  id: s.id, type: s.type.toLowerCase(), src: toUrl(s.mediaUrl), thumb: toUrl(s.thumbUrl), text: s.textContent ?? undefined, bg: s.bgColor ?? undefined, caption: s.caption ?? undefined,
  meta: s.meta ?? undefined, audio: toUrl(s.audioUrl), audioMeta: s.audioMeta ?? undefined, ago: ago(s.createdAt), createdAt: s.createdAt, expiresAt: s.expiresAt,
  privacy: s.privacy.toLowerCase(), seen: s.userId === me ? true : s.viewers.some((v) => v.viewerId === me), liked: s.reactions.some((r) => r.userId === me),
  reaction: s.reactions.find((r) => r.userId === me)?.emoji, ...(s.userId === me ? { viewCount: s.viewers.length, reactionCount: s.reactions.length } : {}),
});

async function feed(me: string) {
  const [following, partner, hidden] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: me }, select: { followeeId: true } }),
    prisma.coupleConnection.findFirst({ where: { status: 'ACTIVE', OR: [{ inviterId: me }, { inviteeId: me }] }, select: { inviterId: true, inviteeId: true } }),
    blockedIds(me),
  ]);
  const owners = new Set([me, ...following.map((f) => f.followeeId)]);
  if (partner) owners.add(partner.inviterId === me ? partner.inviteeId : partner.inviterId);
  for (const h of hidden) owners.delete(h);
  const rows = await prisma.story.findMany({
    where: { userId: { in: [...owners] }, ...active(), user: { status: 'ACTIVE' } },
    include: { viewers: { select: { viewerId: true } }, reactions: { select: { userId: true, emoji: true } }, user: { include: { profile: true } } }, orderBy: { createdAt: 'asc' },
  });
  const groups = new Map<string, { user: (typeof rows)[number]['user']; items: StoryRow[] }>();
  for (const r of rows) {
    if (!(await canSee(me, r))) continue;
    (groups.get(r.userId) ?? groups.set(r.userId, { user: r.user, items: [] }).get(r.userId)!).items.push(r);
  }
  const out = [...groups.values()].map(({ user, items }) => {
    const dto = items.map((i) => itemDto(i, me)); const mine = user.id === me; const last = items[items.length - 1];
    return { id: `s-${user.id}`, userId: user.id, name: mine ? 'My Story' : user.fullName, avatar: toUrl(user.profile?.avatarThumbUrl || user.profile?.avatarUrl), cover: dto[dto.length - 1]?.thumb || dto[dto.length - 1]?.src, bg: dto[0]?.thumb || dto[0]?.src, mine, seen: dto.every((d) => d.seen), items: dto, updatedAt: last.createdAt };
  });
  if (!out.some((g) => g.mine)) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: me }, include: { profile: true } });
    out.push({ id: `s-${me}`, userId: me, name: 'My Story', avatar: toUrl(u.profile?.avatarThumbUrl || u.profile?.avatarUrl), cover: null as string | null, bg: null as string | null, mine: true, seen: false, items: [] as any[], updatedAt: new Date(0) });
  }
  return out.sort((a, b) => Number(b.mine) - Number(a.mine) || Number(a.seen) - Number(b.seen) || +new Date(b.updatedAt) - +new Date(a.updatedAt));
}
storiesRouter.get('/', wrap(async (req, res) => { res.json(await feed(req.user.id)); }));

// ── drafts (before /:id) ──
const draftPayload = z.object({ caption: z.string().max(500).optional(), type: z.enum(['photo', 'video', 'text']).optional(), text: z.string().max(700).optional(), bg: z.string().max(40).optional(), privacy: z.enum(['everyone', 'followers', 'selected', 'couple']).optional(), audienceIds: z.array(uuid).max(500).optional(), meta: z.record(z.any()).optional() }).passthrough();
const parseJson = (v: unknown) => { if (typeof v !== 'string') return v ?? {}; try { return JSON.parse(v); } catch { throw bad('Invalid editor data'); } };
const draftDto = (d: any) => ({ id: d.id, media: toUrl(d.mediaUrl), payload: d.payload, updatedAt: d.updatedAt, createdAt: d.createdAt });
storiesRouter.get('/drafts', wrap(async (req, res) => { res.json((await prisma.storyDraft.findMany({ where: { userId: req.user.id }, orderBy: { updatedAt: 'desc' }, take: 20 })).map(draftDto)); }));
storiesRouter.post('/drafts', uploadLimiter, upload.single('media'), wrap(async (req, res) => {
  const payload = draftPayload.parse(parseJson(req.body.payload));
  if ((await prisma.storyDraft.count({ where: { userId: req.user.id } })) >= 20) throw bad('You can keep up to 20 drafts');
  let mediaUrl: string | undefined;
  if (req.file) mediaUrl = (await saveUpload(req.file, { folder: 'drafts', accept: ['image', 'video'], thumb: 480 })).key;
  const d = await prisma.storyDraft.create({ data: { userId: req.user.id, mediaUrl, mediaKey: mediaUrl, payload: payload as Prisma.InputJsonValue } });
  res.status(201).json(draftDto(d));
}));
storiesRouter.put('/drafts/:id', validate({ params: idParam }), upload.single('media'), wrap(async (req, res) => {
  const d = await prisma.storyDraft.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!d) throw notFound('Draft not found');
  const payload = req.body.payload !== undefined ? draftPayload.parse(parseJson(req.body.payload)) : (d.payload as any);
  let mediaUrl = d.mediaUrl;
  if (req.file) { mediaUrl = (await saveUpload(req.file, { folder: 'drafts', accept: ['image', 'video'], thumb: 480 })).key; await removeObject(d.mediaUrl); }
  res.json(draftDto(await prisma.storyDraft.update({ where: { id: d.id }, data: { payload: payload as Prisma.InputJsonValue, mediaUrl, mediaKey: mediaUrl } })));
}));
storiesRouter.delete('/drafts/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const d = await prisma.storyDraft.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (d) { await prisma.storyDraft.delete({ where: { id: d.id } }); await removeObject(d.mediaUrl); }
  res.json({ ok: true });
}));

// ── highlights (before /:id) ──
export const highlightsRouter = Router();
highlightsRouter.use(requireAuth);
const highlightDto = (h: any) => ({ id: h.id, title: h.title, cover: toUrl(h.coverUrl || h.items?.[0]?.thumbUrl || h.items?.[0]?.mediaUrl), items: (h.items || []).map((i: any) => ({ id: i.id, type: i.type.toLowerCase(), src: toUrl(i.mediaUrl), thumb: toUrl(i.thumbUrl), text: i.textContent ?? undefined, bg: i.bgColor ?? undefined, meta: i.meta ?? undefined })) });
highlightsRouter.get('/user/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const owner = await prisma.user.findFirst({ where: { id: req.params.id, status: 'ACTIVE' }, select: { id: true, isPrivate: true } });
  if (!owner || (await isBlockedBetween(req.user.id, owner.id))) throw notFound('Profile not found');
  if (owner.id !== req.user.id && owner.isPrivate && !(await prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: req.user.id, followeeId: owner.id } } }))) return res.json([]);
  res.json((await prisma.storyHighlight.findMany({ where: { userId: owner.id }, include: { items: { orderBy: { position: 'asc' } } }, orderBy: { createdAt: 'desc' } })).map(highlightDto));
}));
highlightsRouter.post('/', validate({ body: z.object({ title: z.string().trim().min(1).max(30), storyIds: z.array(uuid).min(1).max(50) }) }), wrap(async (req, res) => {
  const stories = await prisma.story.findMany({ where: { id: { in: req.body.storyIds }, userId: req.user.id } });
  if (!stories.length) throw bad('Choose some of your stories');
  const h = await prisma.storyHighlight.create({ data: { userId: req.user.id, title: req.body.title, items: { create: stories.map((s, i) => ({ position: i, type: s.type, mediaUrl: s.mediaUrl, thumbUrl: s.thumbUrl, textContent: s.textContent, bgColor: s.bgColor, meta: s.meta as any })) } }, include: { items: { orderBy: { position: 'asc' } } } });
  res.status(201).json(highlightDto(h));
}));
highlightsRouter.delete('/:id', validate({ params: idParam }), wrap(async (req, res) => { await prisma.storyHighlight.deleteMany({ where: { id: req.params.id, userId: req.user.id } }); res.json({ ok: true }); }));

// ── publish ──
const publishBody = z.object({
  type: z.enum(['photo', 'video', 'text']).optional(), caption: z.string().max(500).optional(), text: z.string().max(700).optional(), bg: z.string().max(40).optional(),
  privacy: z.enum(['everyone', 'followers', 'selected', 'couple']).optional(), audienceIds: z.any().optional(), mentionIds: z.any().optional(), meta: z.any().optional(), audioMeta: z.any().optional(),
  trimStart: z.coerce.number().min(0).max(3600).optional(), trimEnd: z.coerce.number().min(0).max(3600).optional(), draftId: uuid.optional(), audioUrl: z.string().max(500).optional(),
});
const uuidList = (v: unknown, max = 500): string[] => { const arr = typeof v === 'string' ? (parseJson(v) as any) : v; if (arr == null || arr === '') return []; if (!Array.isArray(arr)) throw bad('Invalid list'); return arr.map(String).filter((x) => z.string().uuid().safeParse(x).success).slice(0, max); };
storiesRouter.post('/', uploadLimiter, upload.fields([{ name: 'media', maxCount: 1 }, { name: 'file', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), wrap(async (req, res) => {
  const b = publishBody.parse(req.body); const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const me = req.user.id;
  const mediaFile = files?.media?.[0] || files?.file?.[0];
  const settings = await prisma.userSettings.findUnique({ where: { userId: me } });
  const privacy = (b.privacy ? b.privacy.toUpperCase() : settings?.defaultStoryPrivacy || 'FOLLOWERS') as any;
  const audienceIds = privacy === 'SELECTED' ? uuidList(b.audienceIds) : [];
  if (privacy === 'SELECTED' && !audienceIds.length) throw bad('Choose who can see this story');
  if (privacy === 'COUPLE' && !(await prisma.coupleConnection.findFirst({ where: { status: 'ACTIVE', OR: [{ inviterId: me }, { inviteeId: me }] } }))) throw bad('Connect with your partner to share couple-only stories');
  const meta = parseJson(b.meta); if (JSON.stringify(meta).length > 40_000) throw bad('Editor data is too large');
  let data: Prisma.StoryUncheckedCreateInput;
  const base = { userId: me, privacy, audienceIds, mentionIds: uuidList(b.mentionIds, 20), meta: meta as Prisma.InputJsonValue, caption: b.caption || null, expiresAt: new Date(Date.now() + TTL_MS) };
  if (!mediaFile) {
    if (b.type && b.type !== 'text') throw bad('Choose a photo or video');
    if (!b.text?.trim()) throw bad('Write something or choose a photo or video');
    data = { ...base, type: 'TEXT', textContent: b.text.trim(), bgColor: b.bg || '#7c3aed' };
  } else {
    const saved = await saveUpload(mediaFile, { folder: 'stories', accept: ['image', 'video'], thumb: 480, maxDim: 1920, maxVideoSec: 60, trim: { startSec: b.trimStart, endSec: b.trimEnd } });
    data = { ...base, type: saved.kind === 'video' ? 'VIDEO' : 'PHOTO', mediaUrl: saved.key, mediaKey: saved.key, thumbUrl: saved.thumbKey, mime: saved.mime };
  }
  const audio = files?.audio?.[0];
  if (audio) { const a = await saveUpload(audio, { folder: 'story-audio', accept: ['voice'] }); data.audioUrl = a.key; data.audioKey = a.key; data.audioMeta = (parseJson(b.audioMeta) as Prisma.InputJsonValue) ?? { title: audio.originalname }; }
  else if (b.audioUrl) data.audioUrl = b.audioUrl; // a licensed track URL supplied by the client/music provider
  const s = await prisma.story.create({ data, include: { viewers: { select: { viewerId: true } }, reactions: { select: { userId: true, emoji: true } } } });
  if (b.draftId) { const d = await prisma.storyDraft.findFirst({ where: { id: b.draftId, userId: me } }); if (d) { await prisma.storyDraft.delete({ where: { id: d.id } }); await removeObject(d.mediaUrl); } }
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: me } });
  for (const uid of s.mentionIds) if (await canSee(uid, s)) await notify({ userId: uid, actorId: me, type: 'STORY_REPLY', title: 'You were mentioned', body: `${owner.fullName} mentioned you in a story`, data: { storyId: s.id } });
  res.status(201).json({ ...(await feed(me)).find((g) => g.mine), created: itemDto(s, me) });
}));

// ── single story ──
async function loadVisible(me: string, id: string) {
  const s = await prisma.story.findFirst({ where: { id, ...active(), user: { status: 'ACTIVE' } }, include: { viewers: { select: { viewerId: true } }, reactions: { select: { userId: true, emoji: true } }, user: { include: { profile: true } } } });
  if (!s || !(await canSee(me, s))) throw notFound('This story is no longer available'); // never reveal that a hidden story exists
  return s;
}
storiesRouter.get('/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const s = await loadVisible(req.user.id, req.params.id);
  res.json({ ...itemDto(s, req.user.id), owner: { id: s.userId, name: s.user.fullName, avatar: toUrl(s.user.profile?.avatarThumbUrl || s.user.profile?.avatarUrl) } });
}));
storiesRouter.post('/:id/view', validate({ params: idParam }), wrap(async (req, res) => {
  const s = await loadVisible(req.user.id, req.params.id);
  if (s.userId !== req.user.id) {
    await prisma.storyViewer.upsert({ where: { storyId_viewerId: { storyId: s.id, viewerId: req.user.id } }, create: { storyId: s.id, viewerId: req.user.id }, update: {} });
  }
  res.json({ ok: true });
}));
storiesRouter.delete('/:id', validate({ params: idParam }), wrap(async (req, res) => {
  const s = await prisma.story.findFirst({ where: { id: req.params.id, userId: req.user.id, deletedAt: null } });
  if (!s) throw notFound('Story not found');
  await prisma.story.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
  await storyMediaCleanup([s.mediaKey, s.thumbUrl, s.audioKey]);
  res.json({ ok: true });
}));

/** Remove story files unless a memory, highlight, draft or chat message still points at them. */
export async function storyMediaCleanup(keys: (string | null)[]) {
  for (const k of keys.filter(Boolean) as string[]) {
    const [m, h, a, d, own] = await Promise.all([
      prisma.coupleMemory.count({ where: { OR: [{ mediaUrl: k }, { storageKey: k }, { thumbUrl: k }] } }),
      prisma.storyHighlightItem.count({ where: { OR: [{ mediaUrl: k }, { thumbUrl: k }] } }),
      prisma.messageAttachment.count({ where: { OR: [{ storageKey: k }, { thumbUrl: k }] } }),
      prisma.storyDraft.count({ where: { mediaUrl: k } }),
      prisma.story.count({ where: { deletedAt: null, expiresAt: { gt: new Date() }, OR: [{ mediaKey: k }, { thumbUrl: k }, { audioKey: k }] } }),
    ]);
    if (m + h + a + d + own === 0) await removeObject(k);
  }
}

// ── reactions & replies: both become messages in the owner's chat ──
async function storyToChat(me: string, s: Awaited<ReturnType<typeof loadVisible>>, kind: 'reaction' | 'reply', text: string | null, emoji: string | null) {
  const cid = await ensureDirectConversation(me, s.userId);
  const r = await sendMessage({ conversationId: cid, senderId: me, type: 'STORY', text, emoji, storyId: s.id, storyKind: kind, storySnapshot: { src: toUrl(s.thumbUrl || s.mediaUrl), type: s.type.toLowerCase(), owner: 'them' } });
  for (const uid of r.memberIds) emitToUser(uid, 'message:new', messageDto(r.message, uid, r.memberIds));
  return { cid, message: messageDto(r.message, me, r.memberIds) };
}
storiesRouter.post('/:id/react', validate({ params: idParam, body: z.object({ emoji: z.string().min(1).max(16).default('❤️') }) }), wrap(async (req, res) => {
  const s = await loadVisible(req.user.id, req.params.id);
  if (s.userId === req.user.id) throw bad('You cannot react to your own story');
  const had = await prisma.storyReaction.findUnique({ where: { storyId_userId: { storyId: s.id, userId: req.user.id } } });
  await prisma.$transaction([
    prisma.storyViewer.upsert({ where: { storyId_viewerId: { storyId: s.id, viewerId: req.user.id } }, create: { storyId: s.id, viewerId: req.user.id }, update: {} }),
    prisma.storyReaction.upsert({ where: { storyId_userId: { storyId: s.id, userId: req.user.id } }, create: { storyId: s.id, userId: req.user.id, emoji: req.body.emoji }, update: { emoji: req.body.emoji } }),
  ]);
  if (!had) { // a first reaction creates the chat message + a notification; changing the emoji does not spam
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
    await storyToChat(req.user.id, s, 'reaction', null, req.body.emoji);
    await notify({ userId: s.userId, actorId: req.user.id, type: 'STORY_REACTION', title: me.fullName, body: `Reacted ${req.body.emoji} to your story`, data: { storyId: s.id } });
  }
  res.json({ ok: true, liked: true, emoji: req.body.emoji });
}));
storiesRouter.delete('/:id/react', validate({ params: idParam }), wrap(async (req, res) => { await prisma.storyReaction.deleteMany({ where: { storyId: req.params.id, userId: req.user.id } }); res.json({ ok: true, liked: false }); }));
storiesRouter.post('/:id/reply', validate({ params: idParam, body: z.object({ text: z.string().trim().min(1, 'Write a reply first').max(1000) }) }), wrap(async (req, res) => {
  const s = await loadVisible(req.user.id, req.params.id);
  if (s.userId === req.user.id) throw bad('You cannot reply to your own story');
  await prisma.storyViewer.upsert({ where: { storyId_viewerId: { storyId: s.id, viewerId: req.user.id } }, create: { storyId: s.id, viewerId: req.user.id }, update: {} });
  const out = await storyToChat(req.user.id, s, 'reply', req.body.text, null);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
  await notify({ userId: s.userId, actorId: req.user.id, type: 'STORY_REPLY', title: me.fullName, body: `Replied to your story: ${req.body.text.slice(0, 80)}`, data: { storyId: s.id, conversationId: out.cid } });
  res.status(201).json({ ok: true, chatId: out.cid, message: out.message });
}));
storiesRouter.get('/:id/viewers', validate({ params: idParam }), wrap(async (req, res) => {
  const s = await prisma.story.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!s) throw forbidden('Only the story owner can see viewers');
  const [views, reactions, replies] = await Promise.all([
    prisma.storyViewer.findMany({ where: { storyId: s.id }, include: { viewer: { include: { profile: true } } }, orderBy: { viewedAt: 'desc' }, take: 500 }),
    prisma.storyReaction.findMany({ where: { storyId: s.id } }),
    prisma.message.findMany({ where: { storyId: s.id, storyKind: 'reply', deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { senderId: true, text: true, conversationId: true } }),
  ]);
  const R = new Map(reactions.map((r) => [r.userId, r.emoji])); const P = new Map<string, { text: string | null; conversationId: string }>();
  for (const r of replies) if (r.senderId && !P.has(r.senderId)) P.set(r.senderId, { text: r.text, conversationId: r.conversationId });
  const hidden = new Set(await blockedIds(req.user.id));
  const list = views.filter((v) => !hidden.has(v.viewerId)).map((v) => ({
    userId: v.viewerId, name: v.viewer.fullName, avatar: toUrl(v.viewer.profile?.avatarThumbUrl || v.viewer.profile?.avatarUrl), viewedAt: v.viewedAt, ago: ago(v.viewedAt),
    liked: R.has(v.viewerId), reaction: R.get(v.viewerId), reply: P.get(v.viewerId)?.text ?? undefined, chatId: P.get(v.viewerId)?.conversationId,
  }));
  res.json(list.sort((a, b) => Number(b.liked) - Number(a.liked)));
}));
// Save to personal Memories (outlives the 24-hour expiry)
storiesRouter.post('/:id/save', validate({ params: idParam }), wrap(async (req, res) => {
  const s = await prisma.story.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!s) throw notFound('Story not found');
  if (s.type === 'TEXT' || !s.mediaUrl) throw bad('Only photo and video stories can be saved to Memories');
  const m = await prisma.coupleMemory.create({ data: { ownerId: req.user.id, type: s.type === 'VIDEO' ? 'video' : 'photo', album: 'Stories', caption: s.caption ?? '', mediaUrl: s.mediaUrl, thumbUrl: s.thumbUrl, storageKey: s.mediaKey } });
  res.status(201).json({ ok: true, memoryId: m.id });
}));
