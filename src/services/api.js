import axios from 'axios';
import * as mock from '../data/mock';
import { canViewContent, selectTab } from '../profile/relations';
import { streakService } from './streakService';
import { coupleService } from './coupleService';
import { callEventService } from '../callEvents/eventService';
import { randomId } from '../callEvents/logic';

export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1';
// Demo mode is ON unless explicitly turned off (VITE_USE_MOCK=false) - so a deploy without env vars still works instead of calling localhost
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
const TOKEN_KEY = 'smu_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY),
  set: (t, remember = true) => { (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t); },
  clear: () => { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); },
};

export const http = axios.create({ baseURL: API_BASE, timeout: 15000 });
http.interceptors.request.use((cfg) => {
  const t = tokenStore.get();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && tokenStore.get()) {
      tokenStore.clear();
      window.dispatchEvent(new Event('smu:unauthorized')); // token expired -> logout
    }
    return Promise.reject(err);
  },
);

export const errMsg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));

// In-memory demo state used when VITE_USE_MOCK=true
const db = {
  conversations: clone(mock.conversations), events: clone(mock.events), media: clone(mock.media),
  journal: clone(mock.journal), goals: clone(mock.goals), stories: mock.stories, people: clone(mock.people),
  channels: clone(mock.channels), activity: clone(mock.activity), calls: clone(mock.calls), scheduled: clone(mock.scheduledCalls), places: clone(mock.savedPlaces),
  messages: {}, me: { ...mock.me }, notifications: clone(mock.notifications), couple: clone(mock.couple),
  storyViewers: clone(mock.storyViewers),
};
// Relationships survive a page reload in demo mode: follow overrides, dismissed suggestions, blocked people
const REL_KEY = 'smu.rel';
let rel = { follow: {}, requested: {}, removed: [], blocked: [] };
try { const saved = JSON.parse(localStorage.getItem(REL_KEY) || 'null'); if (saved) rel = { ...rel, ...saved }; } catch { /* ignore */ }
const keepRel = () => { try { localStorage.setItem(REL_KEY, JSON.stringify(rel)); } catch { /* ignore */ } };
// Posts: the demo feed is generated once; my likes, saves and comments survive a reload
const POST_KEY = 'smu.posts';
let postState = { liked: {}, saved: {}, comments: {} };
try { const saved = JSON.parse(localStorage.getItem(POST_KEY) || 'null'); if (saved) postState = { ...postState, ...saved }; } catch { /* ignore */ }
const keepPosts = () => { try { localStorage.setItem(POST_KEY, JSON.stringify(postState)); } catch { /* ignore */ } };
let allPosts = null;
const feed = () => (allPosts ||= mock.buildPosts());
const personOf = (id) => db.people.find((x) => x.id === id);
// may I see this person's posts? (public, or I follow them)
const canSeeOwner = (ownerId) => { const o = personOf(ownerId); return !o || canViewContent({ isPrivate: o.isPrivate, isFollowing: isFol(o) }); };
const postView = (p) => {
  const o = personOf(p.userId);
  const extra = postState.comments[p.id] || [];
  const liked = p.id in postState.liked ? postState.liked[p.id] : false;
  return { id: p.id, userId: p.userId, type: p.type, src: p.src, poster: p.poster, duration: p.duration, caption: p.caption, createdAt: p.createdAt,
    likes: p.likes + (liked ? 1 : 0), liked, saved: !!postState.saved[p.id], comments: p.comments.length + extra.length,
    owner: { id: o.id, name: o.name, handle: o.handle, avatar: o.avatar, verified: !!o.verified } };
};
const findPost = (id) => {
  const p = feed().find((x) => x.id === id);
  if (!p) throw { message: 'This post is no longer available' };
  if (rel.blocked.includes(p.userId)) throw { message: 'This post isn’t available' };
  if (!canSeeOwner(p.userId)) throw { message: 'This account is private' };
  return p;
};
// people in someone's followers / following list — derived from the demo people graph
const idxOf = (id) => db.people.findIndex((x) => x.id === id);
const graph = (id, mod) => db.people.filter((p) => p.id !== id && !rel.blocked.includes(p.id) && (idxOf(p.id) + idxOf(id)) % mod === 0);
const parseCnt = (v) => (/k$/i.test(String(v)) ? Math.round(parseFloat(v) * 1000) : parseInt(String(v).replace(/,/g, ''), 10) || 0);
const fmtCnt = (n) => (n >= 1000 ? `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}K` : String(n));
const isFol = (p) => (p.id in rel.follow ? rel.follow[p.id] : !!p.isFollowing);
// a person as the current user sees them: live follow state and follower count
const relView = (p) => ({ ...p, isFollowing: isFol(p), requested: !isFol(p) && !!rel.requested[p.id], followers: fmtCnt(parseCnt(p.followers) + (isFol(p) ? 1 : 0) - (p.isFollowing ? 1 : 0)) });
const findPerson = (id) => {
  if (id === db.me.id) throw { message: 'That is you' };
  const p = db.people.find((x) => x.id === id);
  if (!p) throw { message: 'User not found' };
  return p;
};
const uid = () => Math.random().toString(36).slice(2, 9);
// saved places survive a page reload in demo mode
const PLACES_KEY = 'smu.places';
try { const saved = JSON.parse(localStorage.getItem(PLACES_KEY) || 'null'); if (Array.isArray(saved)) db.places = saved; } catch { /* ignore */ }
const keepPlaces = () => { try { localStorage.setItem(PLACES_KEY, JSON.stringify(db.places)); } catch { /* ignore */ } };


// ---- story <-> chat bridge ------------------------------------------------
// Every like / reply on a story becomes a message in that person's chat (type 'story'),
// so it shows up in the right conversation with a thumbnail of the story.
const findStoryItem = (itemId) => { for (const s of db.stories) { const it = s.items.find((i) => i.id === itemId); if (it) return { story: s, item: it }; } return null; };
const chatFor = (userId, fallback = {}) => {
  let c = db.conversations.find((x) => x.type === 'direct' && x.friendId === userId);
  if (!c) {
    const p = db.people.find((x) => x.id === userId);
    c = { id: uid(), friendId: userId, type: 'direct', name: (p?.name || fallback.name || 'Friend').split(' ')[0], fullName: p?.name || fallback.name, avatar: p?.avatar || fallback.avatar, last: '', time: 'now', unread: 0, kind: 'messages' };
    db.conversations.unshift(c);
  }
  return c;
};
// from: 'me' (I reacted to their story) | 'them' (they reacted to mine)
function pushStoryMsg({ userId, name, avatar, from, kind, text, emoji, item, owner, at }) {
  const c = chatFor(userId, { name, avatar });
  const m = { id: uid(), from, type: 'story', kind, text, emoji, at: at || new Date().toISOString(), status: from === 'me' ? 'sent' : 'read',
    story: { itemId: item.id, src: item.src, owner } };
  (db.messages[c.id] ||= mock.messagesFor(c.id)).push(m);
  c.last = kind === 'reaction' ? `${from === 'me' ? 'You reacted' : 'Reacted'} ${emoji} to a story` : `${from === 'me' ? 'You: ' : ''}${text}`;
  c.time = 'now'; if (from === 'them') c.unread = (c.unread || 0) + 1;
  return m;
}
// demo: the people who already liked / replied to my story have their messages waiting in chat
function seedStoryChats() {
  const mine = db.stories[0];
  for (const item of mine.items) for (const v of (db.storyViewers[item.id] || [])) {
    if (v.liked) pushStoryMsg({ userId: v.userId, name: v.name, avatar: v.avatar, from: 'them', kind: 'reaction', emoji: v.reaction || '❤️', item, owner: 'mine' });
    if (v.reply) pushStoryMsg({ userId: v.userId, name: v.name, avatar: v.avatar, from: 'them', kind: 'reply', text: v.reply, item, owner: 'mine' });
  }
}
if (USE_MOCK) seedStoryChats();

// Every call hits the REST API; with VITE_USE_MOCK=true it resolves from demo data.
async function call(realFn, mockFn) {
  if (USE_MOCK) { await wait(); return mockFn(); }
  const { data } = await realFn();
  return data?.data ?? data;
}
const form = (obj) => { const f = new FormData(); Object.entries(obj).forEach(([k, v]) => v != null && f.append(k, v)); return f; };
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export const api = {
  // auth
  login: (b) => call(() => http.post('/auth/login', b), () => {
    if (b.password === 'wrong') throw { message: 'Invalid credentials' };
    return { token: 'demo-token', user: db.me };
  }),
  signup: (b) => call(() => http.post('/auth/register', b), () => ({ token: 'demo-token', user: { ...db.me, name: b.name } })),
  forgot: (b) => call(() => http.post('/auth/forgot-password', b), () => ({ ok: true })),
  reset: (b) => call(() => http.post('/auth/reset-password', b), () => ({ ok: true })),
  me: () => call(() => http.get('/users/me'), () => db.me),
  deleteMe: () => call(() => http.delete('/users/me'), () => ({ ok: true })),
  updateMe: (b) => call(() => http.put('/users/me', b), () => Object.assign(db.me, b)),
  uploadAvatar: (file) => call(() => http.post('/users/me/avatar', form({ avatar: file }), multipart), () => { db.me.avatar = URL.createObjectURL(file); return db.me; }),
  // chats
  conversations: (params) => call(() => http.get('/conversations', { params }), () => {
    const q = (params?.q || '').toLowerCase();
    return db.conversations.filter((c) => c.name.toLowerCase().includes(q));
  }),
  createConversation: (b) => call(() => http.post('/conversations', b), () => {
    const c = { id: uid(), type: b.group ? 'group' : 'direct', name: b.name, avatar: b.avatar, last: 'Say hi 👋', time: 'now', unread: 0, kind: b.group ? 'groups' : 'messages' };
    db.conversations.unshift(c); return c;
  }),
  conversation: (id) => call(() => http.get(`/conversations/${id}`), () => db.conversations.find((c) => c.id === id)),
  messages: (id, page = 1) => call(() => http.get(`/conversations/${id}/messages`, { params: { page, limit: 20 } }), () => {
    db.messages[id] ||= mock.messagesFor(id);
    return { items: page === 1 ? db.messages[id] : [], hasMore: false };
  }),
  sendMessage: (id, b) => call(() => http.post(`/conversations/${id}/messages`, b), () => {
    const m = { id: uid(), from: 'me', at: new Date().toISOString(), status: 'sent', ...b };
    (db.messages[id] ||= mock.messagesFor(id)).push(m); streakService.record(id, { id: m.id, userId: 'u0', kind: b.type || 'text', text: b.text }); return m;
  }),
  sendMedia: (id, file, type) => call(() => http.post(`/conversations/${id}/media`, form({ file, type }), multipart), () => {
    const m = { id: uid(), from: 'me', at: new Date().toISOString(), status: 'sent', type, src: URL.createObjectURL(file), duration: type === 'voice' ? '0:05' : undefined };
    (db.messages[id] ||= mock.messagesFor(id)).push(m); streakService.record(id, { id: m.id, userId: 'u0', kind: type }); return m;
  }),
  react: (cid, mid, emoji) => call(() => http.post(`/conversations/${cid}/messages/${mid}/reactions`, { emoji }), () => {
    const m = db.messages[cid]?.find((x) => x.id === mid); if (m) m.reaction = emoji; return m;
  }),
  // streaks (server derives them from sent messages; the demo service does the same locally)
  streaks: () => call(() => http.get('/streaks'), () => streakService.list()),
  streak: (id) => call(() => http.get(`/streaks/${id}`), () => streakService.get(id)),
  streakContribution: (id) => call(() => http.get(`/streaks/${id}/contribution`), () => streakService.contribution(id)),
  recordStreakActivity: (id, b) => call(() => http.post(`/streaks/${id}/activity`, b), () => streakService.record(id, b)), // demo only: a real server records on message send
  recoverStreak: (id) => call(() => http.post(`/streaks/${id}/recover`), () => { const r = streakService.recover(id); if (!r.ok) throw { message: 'This streak can no longer be recovered' }; return r.summary; }),
  streakPrefs: () => call(() => http.get('/streaks/preferences'), () => streakService.prefs()),
  setStreakPrefs: (b) => call(() => http.put('/streaks/preferences', b), () => streakService.setPrefs(b)),
  // discover
  // params.suggestions: the Timeline "People you know" list, which also hides people the user dismissed. Blocked people never show.
  people: (params) => call(() => http.get('/discover/people', { params }), () => {
    const c = params?.interest;
    return db.people.filter((p) => !rel.blocked.includes(p.id) && !(params?.suggestions && rel.removed.includes(p.id)) && (!c || p.interests.includes(c))).map(relView);
  }),
  userProfile: (id) => call(() => http.get(`/users/${id}/profile`), () => {
    const p = personOf(id);
    if (!p) throw { message: 'This profile could not be found' };
    // a profile I blocked shows only who it is, with a way to unblock; nothing else is exposed
    if (rel.blocked.includes(id)) return { id: p.id, name: p.name, handle: p.handle, avatar: p.avatar, blocked: true };
    const v = relView(p);
    return { ...v, posts: feed().filter((x) => x.userId === id).length, canView: canViewContent({ isPrivate: p.isPrivate, isFollowing: v.isFollowing }) };
  }),
  // tab: posts | reels | tagged. A private account's content is locked until the follow request is accepted.
  userPosts: (id, tab = 'posts') => call(() => http.get(`/users/${id}/posts`, { params: { tab } }), () => {
    const p = personOf(id);
    if (!p) throw { message: 'This profile could not be found' };
    if (rel.blocked.includes(id)) throw { message: 'This profile isn’t available' };
    if (!canSeeOwner(id)) return { locked: true, items: [] };
    return { locked: false, items: selectTab(feed(), tab, id, (o) => !rel.blocked.includes(o) && canSeeOwner(o)).map(postView) };
  }),
  userFollowers: (id) => call(() => http.get(`/users/${id}/followers`), () => {
    const p = personOf(id); if (!p) throw { message: 'This profile could not be found' };
    if (!canSeeOwner(id)) throw { message: 'This account is private' };
    const list = graph(id, 2).map(relView);
    return isFol(p) ? [{ ...db.me, isMe: true }, ...list] : list;
  }),
  userFollowing: (id) => call(() => http.get(`/users/${id}/following`), () => {
    const p = personOf(id); if (!p) throw { message: 'This profile could not be found' };
    if (!canSeeOwner(id)) throw { message: 'This account is private' };
    const list = graph(id, 3).map(relView);
    return p.follower ? [{ ...db.me, isMe: true }, ...list] : list;
  }),
  // idempotent: following someone twice never creates a second relationship. A private account gets a request instead.
  follow: (id) => call(() => http.post(`/users/${id}/follow`), () => {
    const p = findPerson(id);
    if (rel.blocked.includes(id)) throw { message: 'This profile isn’t available' };
    if (p.isPrivate && !isFol(p)) { rel.requested[id] = true; keepRel(); return { following: false, requested: true, followers: relView(p).followers }; }
    rel.follow[id] = true; delete rel.requested[id]; keepRel();
    return { following: true, requested: false, followers: relView(p).followers };
  }),
  // also cancels a pending request
  unfollow: (id) => call(() => http.delete(`/users/${id}/follow`), () => {
    const p = findPerson(id); rel.follow[id] = false; delete rel.requested[id]; keepRel();
    return { following: false, requested: false, followers: relView(p).followers };
  }),
  // hides one person from "People you know"; the account and any follow relationship are untouched
  dismissSuggestion: (id) => call(() => http.delete(`/suggestions/${id}`), () => {
    findPerson(id); if (!rel.removed.includes(id)) rel.removed.push(id); keepRel(); return { ok: true };
  }),
  blockUser: (id) => call(() => http.post(`/users/${id}/block`), () => {
    findPerson(id); if (!rel.blocked.includes(id)) rel.blocked.push(id);
    rel.follow[id] = false; delete rel.requested[id]; keepRel(); return { blocked: true };
  }),
  unblockUser: (id) => call(() => http.delete(`/users/${id}/block`), () => {
    findPerson(id); rel.blocked = rel.blocked.filter((x) => x !== id); keepRel(); return { blocked: false };
  }),
  // follow requests I have received (server only: the demo has no incoming requests)
  followRequests: () => call(() => http.get('/follow-requests'), () => []),
  respondFollowRequest: (id, accept) => call(() => (accept ? http.post(`/follow-requests/${id}/accept`) : http.delete(`/follow-requests/${id}`)), () => ({ ok: true })),
  // post interactions
  likePost: (id) => call(() => http.post(`/posts/${id}/like`), () => { const p = findPost(id); postState.liked[id] = true; keepPosts(); return { liked: true, likes: postView(p).likes }; }),
  unlikePost: (id) => call(() => http.delete(`/posts/${id}/like`), () => { const p = findPost(id); postState.liked[id] = false; keepPosts(); return { liked: false, likes: postView(p).likes }; }),
  savePost: (id) => call(() => http.post(`/posts/${id}/save`), () => { findPost(id); postState.saved[id] = true; keepPosts(); return { saved: true }; }),
  unsavePost: (id) => call(() => http.delete(`/posts/${id}/save`), () => { findPost(id); delete postState.saved[id]; keepPosts(); return { saved: false }; }),
  postComments: (id) => call(() => http.get(`/posts/${id}/comments`), () => {
    const p = findPost(id);
    return [...p.comments, ...(postState.comments[id] || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
  }),
  commentPost: (id, text) => call(() => http.post(`/posts/${id}/comments`, { text }), () => {
    findPost(id);
    const t = String(text || '').trim();
    if (!t) throw { message: 'Write a comment first' };
    if (t.length > 500) throw { message: 'Comments can be up to 500 characters' };
    const c = { id: uid(), userId: db.me.id, name: db.me.name, avatar: db.me.avatar, text: t, at: new Date().toISOString() };
    (postState.comments[id] ||= []).push(c); keepPosts(); return c;
  }),
  directChat: (id) => call(() => http.post('/conversations/direct', { userId: id }), () => { findPerson(id); return chatFor(id); }),
  addFriend: (id) => call(() => http.post(`/friends/${id}`), () => ({ requested: true })),
  // stories
  stories: () => call(() => http.get('/stories'), () => db.stories),
  // p = { file, caption, mentions, filter, transform, overlay:{strokes,items}, audio:{blob,name,artist,start}, audience:{id,ids} }
  // Media is uploaded untouched; edits (filter / crop / drawing / text / stickers) travel as JSON so the viewer renders them at any size.
  createStory: (p) => call(() => {
    const f = form({ media: p.file, caption: p.caption, audio: p.audio?.blob, meta: JSON.stringify({ mentions: p.mentions, filter: p.filter, transform: p.transform, overlay: p.overlay, audience: p.audience, audioMeta: p.audio && { name: p.audio.name, artist: p.audio.artist, start: p.audio.start } }) });
    return http.post('/stories', f, multipart);
  }, () => {
    const mine = db.stories[0];
    const it = { id: uid(), src: URL.createObjectURL(p.file), type: p.file.type.startsWith('video') ? 'video' : 'image', ago: 'now', caption: p.caption, mentions: p.mentions, filter: p.filter, transform: p.transform, overlay: p.overlay,
      audio: p.audio ? { src: p.audio.src, name: p.audio.name, artist: p.audio.artist, start: p.audio.start } : null, audience: p.audience };
    mine.items.push(it); db.storyViewers[it.id] = []; return mine;
  }),
  // the server stores the reaction/reply AND drops a message into the conversation with the story's owner
  reactStory: (id, emoji) => call(() => http.post(`/stories/${id}/react`, { emoji }), () => {
    const f = findStoryItem(id); if (!f) return { ok: true };
    pushStoryMsg({ userId: f.story.userId, name: f.story.name.replace(/\s*🎤/, ''), avatar: f.story.avatar, from: 'me', kind: 'reaction', emoji, item: f.item, owner: 'theirs' });
    return { ok: true };
  }),
  unreactStory: (id) => call(() => http.delete(`/stories/${id}/react`), () => ({ ok: true })),
  replyStory: (id, text) => call(() => http.post(`/stories/${id}/reply`, { text }), () => {
    const f = findStoryItem(id); if (!f) return { ok: true };
    pushStoryMsg({ userId: f.story.userId, name: f.story.name.replace(/\s*🎤/, ''), avatar: f.story.avatar, from: 'me', kind: 'reply', text, item: f.item, owner: 'theirs' });
    return { ok: true };
  }),
  // who saw / liked / replied to one of my story items
  storyViewers: (id) => call(() => http.get(`/stories/${id}/viewers`), () => (db.storyViewers[id] || []).map((v) => ({ ...v, chatId: chatFor(v.userId, v).id })).sort((a, b) => Number(b.liked) - Number(a.liked))),
  // couple
  couple: () => call(() => http.get('/couple'), () => db.couple),
  invitePartner: (b) => call(() => http.post('/couple/invite', b), () => ({ sent: true })),
  journal: () => call(() => http.get('/couple/journal'), () => db.journal),
  addJournal: (b) => call(() => http.post('/couple/journal', b), () => { const j = { id: uid(), date: new Date().toISOString().slice(0, 10), ...b }; db.journal.unshift(j); return j; }),
  deleteJournal: (id) => call(() => http.delete(`/couple/journal/${id}`), () => { db.journal = db.journal.filter((j) => j.id !== id); return { ok: true }; }),
  goals: () => call(() => http.get('/couple/goals'), () => db.goals),
  addGoal: (b) => call(() => http.post('/couple/goals', b), () => { const g = { id: uid(), done: false, ...b }; db.goals.push(g); return g; }),
  toggleGoal: (id) => call(() => http.patch(`/couple/goals/${id}/toggle`), () => { const g = db.goals.find((x) => x.id === id); g.done = !g.done; return g; }),
  deleteGoal: (id) => call(() => http.delete(`/couple/goals/${id}`), () => { db.goals = db.goals.filter((g) => g.id !== id); return { ok: true }; }),
  // couple calendar, shared availability, live location (server rules: backend/src/couple, shared logic: src/couple)
  coupleAppointments: (params) => call(() => http.get('/couple/appointments', { params }), () => coupleService.appointments(params)),
  createAppointment: (b) => call(() => http.post('/couple/appointments', b), () => coupleService.createAppointment(b)),
  updateAppointment: (id, b) => call(() => http.put(`/couple/appointments/${id}`, b), () => coupleService.updateAppointment(id, b)),
  cancelAppointment: (id) => call(() => http.delete(`/couple/appointments/${id}`), () => coupleService.cancelAppointment(id)),
  availability: (params) => call(() => http.get('/couple/availability', { params }), () => coupleService.availability(params)),
  addAvailability: (b) => call(() => http.post('/couple/availability', b), () => coupleService.addAvailability(b)),
  updateAvailability: (id, b) => call(() => http.put(`/couple/availability/${id}`, b), () => coupleService.updateAvailability(id, b)),
  deleteAvailability: (id) => call(() => http.delete(`/couple/availability/${id}`), () => coupleService.deleteAvailability(id)),
  coupleSlots: (params) => call(() => http.get('/couple/slots', { params }), () => coupleService.slots(params)),
  locationState: () => call(() => http.get('/couple/location'), () => coupleService.locationState()),
  startLocation: (b) => call(() => http.post('/couple/location/session', b), () => coupleService.startLocation(b)),
  stopLocation: () => call(() => http.delete('/couple/location/session'), () => coupleService.stopLocation()),
  pushLocation: (b) => call(() => http.put('/couple/location', b), () => coupleService.pushLocation(b)),
  requestLocation: () => call(() => http.post('/couple/location/request'), () => coupleService.requestLocation()),
  // events
  events: () => call(() => http.get('/events'), () => db.events),
  saveEvent: (b) => call(() => (b.id ? http.put(`/events/${b.id}`, b) : http.post('/events', b)), () => {
    if (b.id) { Object.assign(db.events.find((e) => e.id === b.id), b); return b; }
    const e = { id: uid(), ...b }; db.events.push(e); return e;
  }),
  deleteEvent: (id) => call(() => http.delete(`/events/${id}`), () => { db.events = db.events.filter((e) => e.id !== id); return { ok: true }; }),
  // memories
  media: (params) => call(() => http.get('/memories', { params }), () => {
    const q = (params?.q || '').toLowerCase();
    return db.media.filter((m) => (!params?.type || m.type === params.type) && (!params?.album || m.album === params.album) && (m.album.toLowerCase().includes(q)));
  }),
  uploadMedia: (file, album) => call(() => http.post('/memories', form({ file, album }), multipart), () => {
    const isVideo = file.type.startsWith('video');
    const m = { id: uid(), type: isVideo ? 'video' : 'photo', album: album || 'Trips', src: URL.createObjectURL(file), duration: isVideo ? '0:10' : undefined, date: new Date().toISOString().slice(0, 10) };
    db.media.unshift(m); return m;
  }),
  deleteMedia: (id) => call(() => http.delete(`/memories/${id}`), () => { db.media = db.media.filter((m) => m.id !== id); return { ok: true }; }),
  // daily / timeline / calls / private space
  channels: () => call(() => http.get('/channels'), () => db.channels),
  createChannel: (b) => call(() => http.post('/channels', b), () => {
    const c = { id: uid(), icon: null, last: 'Channel created', time: 'now', unread: 0, ...b }; db.channels.unshift(c); return c;
  }),
  activity: () => call(() => http.get('/timeline/activity'), () => db.activity),
  calls: () => call(() => http.get('/calls'), () => db.calls),
  scheduledCalls: () => call(() => http.get('/calls/scheduled'), () => [...db.scheduled].sort((a, b) => new Date(a.at) - new Date(b.at))),
  scheduleCall: (b) => call(() => http.post('/calls/scheduled', b), () => { const c = { id: uid(), ...b }; db.scheduled.push(c); return c; }),
  cancelScheduledCall: (id) => call(() => http.delete(`/calls/scheduled/${id}`), () => { db.scheduled = db.scheduled.filter((c) => c.id !== id); return { ok: true }; }),
  clearCalls: () => call(() => http.delete('/calls'), () => { db.calls = []; return { ok: true }; }),
  placeCall: (b) => call(() => http.post('/calls', b), () => {
    const c = { id: uid(), fav: false, dir: 'out', when: 'Today, ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), ...b };
    db.calls.unshift(c); return c;
  }),
  markAllRead: () => call(() => http.patch('/conversations/read-all'), () => { db.conversations.forEach((c) => { if (!c.locked && c.type !== 'couple') c.unread = 0; }); return { ok: true }; }),
  lockChat: (id, locked) => call(() => http.patch(`/conversations/${id}/lock`, { locked }), () => { const c = db.conversations.find((x) => x.id === id); if (c) c.locked = locked; return c; }),
  places: () => call(() => http.get('/places'), () => db.places),
  addPlace: (b) => call(() => http.post('/places', b), () => { const l = { id: uid(), ...b }; db.places.push(l); keepPlaces(); return l; }),
  deletePlace: (id) => call(() => http.delete(`/places/${id}`), () => { db.places = db.places.filter((l) => l.id !== id); keepPlaces(); return { ok: true }; }),
  notifications: () => call(() => http.get('/notifications'), () => [...callEventService.notifications(), ...coupleService.notifications(), ...db.notifications]),
  // scheduled calls ("call events"): /call-events, because /events is the couple calendar. Rules: src/callEvents/logic.js, server: backend/src/callEvents
  ceList: () => call(() => http.get('/call-events'), () => callEventService.list()),
  ceGet: (id) => call(() => http.get(`/call-events/${id}`), () => callEventService.get(id)),
  ceByLink: (meetingId) => call(() => http.get(`/call-events/link/${meetingId}`), () => callEventService.byMeeting(meetingId)),
  ceDraftId: () => randomId(),
  ceCreate: (b) => call(() => http.post('/call-events', b), () => callEventService.create(b)),
  ceUpdate: (id, b) => call(() => http.put(`/call-events/${id}`, b), () => callEventService.update(id, b)),
  ceCancel: (id) => call(() => http.delete(`/call-events/${id}`), () => callEventService.cancel(id)),
  ceAddGuests: (id, guestIds) => call(() => http.post(`/call-events/${id}/guests`, { guestIds }), () => callEventService.addGuests(id, guestIds)),
  ceRemoveGuest: (id, userId) => call(() => http.delete(`/call-events/${id}/guests/${userId}`), () => callEventService.removeGuest(id, userId)),
  ceRespond: (id, status) => call(() => http.post(`/call-events/${id}/respond`, { status }), () => callEventService.respond(id, status)),
  ceParticipants: (id) => call(() => http.get(`/call-events/${id}/participants`), () => callEventService.participants(id)),
  ceJoin: (id) => call(() => http.post(`/call-events/${id}/join`), () => callEventService.join(id)),
  ceLeave: (id) => call(() => http.post(`/call-events/${id}/leave`), () => callEventService.leave(id)),
  ceDecide: (id, userId, approve) => call(() => http.post(`/call-events/${id}/requests/${userId}`, { approve }), () => callEventService.decideRequest(id, userId, approve)),
  albums: () => Promise.resolve(mock.albums),
};
