import { api } from '../services/api';
import { useChatPrefs } from '../store';
import { clearAsyncCache } from '../components/ui';

// Blocking from a profile / Timeline also blocks that person's direct chat, which ContactInfo keys by conversation id.
const setChatBlocked = async (id, blocked) => {
  try { const c = (await api.conversations({})).find((x) => x.friendId === id); if (c) useChatPrefs.getState().setPref(c.id, { blocked }); } catch { /* the chat may not exist */ }
};
export async function blockPerson(id) { await api.blockUser(id); await setChatBlocked(id, true); clearAsyncCache(); }
export async function unblockPerson(id) { await api.unblockUser(id); await setChatBlocked(id, false); clearAsyncCache(); }

const SITE = 'https://sendmeu.app';
export const profileLink = (handle) => `${SITE}/@${String(handle || '').replace(/^@/, '')}`;
export const postLink = (id) => `${SITE}/p/${encodeURIComponent(id)}`;

// Native share sheet when the device has one, otherwise copy the link. Returns a short message for a toast.
export async function shareLink({ title, url }) {
  try { if (navigator.share) { await navigator.share({ title, url }); return null; } } catch (e) { if (e?.name === 'AbortError') return null; }
  try { await navigator.clipboard.writeText(url); return 'Link copied'; } catch { return url; }
}

// Only http(s) links are ever rendered as links ("priya.dev" -> https://priya.dev)
export function safeUrl(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  const full = /^https?:\/\//i.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) ? `https://${t}` : null;
  try { const u = new URL(full); return /^https?:$/.test(u.protocol) ? { href: u.href, label: u.host + (u.pathname === '/' ? '' : u.pathname) } : null; } catch { return null; }
}
