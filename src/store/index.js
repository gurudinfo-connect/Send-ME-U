import { streakService } from '../services/streakService';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, tokenStore } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';

export const useAuth = create((set, get) => ({
  user: null,
  token: tokenStore.get(),
  ready: false,
  async bootstrap() {
    if (!tokenStore.get()) return set({ ready: true });
    try { const user = await api.me(); set({ user, ready: true }); connectSocket(); }
    catch { tokenStore.clear(); set({ user: null, token: null, ready: true }); }
  },
  async login(body, remember = true) {
    const { token, user } = await api.login(body);
    tokenStore.set(token, remember); set({ user, token }); connectSocket();
  },
  async signup(body) {
    const { token, user } = await api.signup(body);
    tokenStore.set(token, true); set({ user, token }); connectSocket();
  },
  setUser: (user) => set({ user }),
  logout() { tokenStore.clear(); disconnectSocket(); useMenu.getState().reset(); useChatPrefs.getState().reset(); useProfile.getState().reset(); set({ user: null, token: null }); },
}));

export const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
};

export const useUI = create((set) => ({
  theme: localStorage.getItem('smu_theme') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  toast: null,
  unread: null,
  setUnread: (unread) => set({ unread }),
  setTheme(theme) { localStorage.setItem('smu_theme', theme); applyTheme(theme); set({ theme }); },
  notify(msg) { set({ toast: msg }); setTimeout(() => set({ toast: null }), 2200); },
  settings: JSON.parse(localStorage.getItem('smu_settings') || '{"notifications":true,"readReceipts":true,"lastSeen":true,"twoFactor":false,"enterSend":true}'),
  setSetting(k, v) {
    set((s) => { const settings = { ...s.settings, [k]: v }; localStorage.setItem('smu_settings', JSON.stringify(settings)); return { settings }; });
  },
}));

// Private Space lock session: unlocked until the user leaves to Home or taps the lock button
export const usePrivate = create((set) => ({
  unlocked: false,
  rev: 0, // bump to re-read the lock settings
  unlock: () => set({ unlocked: true }),
  lock: () => set({ unlocked: false }),
  refresh: () => set((s) => ({ rev: s.rev + 1 })),
}));

// Data behind the Chats-page "more" menu (starred messages, broadcast lists, communities, linked devices, payments).
// Kept on this device (localStorage) and cleared on log out.
const rid = () => Math.random().toString(36).slice(2, 10);
const EMPTY = { starred: [], broadcasts: [], communities: [], devices: [], payments: [] };
export const useMenu = create(persist((set) => ({
  ...EMPTY,
  reset: () => set({ ...EMPTY }),
  // starred messages
  toggleStar: (m) => set((s) => (s.starred.some((x) => x.id === m.id)
    ? { starred: s.starred.filter((x) => x.id !== m.id) }
    : { starred: [{ ...m, starredAt: new Date().toISOString() }, ...s.starred] })),
  clearStars: () => set({ starred: [] }),
  // broadcast lists: { id, name, recipients: [{id,name,avatar}], messages: [{id,text,at}] }
  addBroadcast: (b) => { const item = { id: rid(), messages: [], createdAt: new Date().toISOString(), ...b }; set((s) => ({ broadcasts: [item, ...s.broadcasts] })); return item; },
  updateBroadcast: (id, patch) => set((s) => ({ broadcasts: s.broadcasts.map((b) => (b.id === id ? { ...b, ...(typeof patch === 'function' ? patch(b) : patch) } : b)) })),
  deleteBroadcast: (id) => set((s) => ({ broadcasts: s.broadcasts.filter((b) => b.id !== id) })),
  // communities: { id, name, about, emoji, color, groups: [{id,name,avatar}] }
  addCommunity: (c) => { const item = { id: rid(), createdAt: new Date().toISOString(), ...c }; set((s) => ({ communities: [item, ...s.communities] })); return item; },
  updateCommunity: (id, patch) => set((s) => ({ communities: s.communities.map((c) => (c.id === id ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)) })),
  deleteCommunity: (id) => set((s) => ({ communities: s.communities.filter((c) => c.id !== id) })),
  // linked devices
  addDevice: (d) => set((s) => ({ devices: [{ id: rid(), linkedAt: new Date().toISOString(), ...d }, ...s.devices] })),
  removeDevice: (id) => set((s) => ({ devices: s.devices.filter((d) => d.id !== id) })),
  clearDevices: () => set({ devices: [] }),
  // payments ledger: { id, kind: 'sent'|'request', to, avatar, amount, note, at }
  addPayment: (p) => set((s) => ({ payments: [{ id: rid(), at: new Date().toISOString(), ...p }, ...s.payments] })),
  clearPayments: () => set({ payments: [] }),
}), { name: 'smu_menu_v1', partialize: (s) => ({ starred: s.starred, broadcasts: s.broadcasts, communities: s.communities, devices: s.devices, payments: s.payments }) }));

// Per-chat settings from the chat's 3-dot menu: saved contact, mute, block, report, wallpaper (kept on this device)
export const isMuted = (p) => !!p?.mutedUntil && (p.mutedUntil === -1 || p.mutedUntil > Date.now());
export const useChatPrefs = create(persist((set) => ({
  prefs: {},
  reset: () => set({ prefs: {} }),
  setPref: (id, patch) => { if ('blocked' in patch) streakService.setFlags(id, { blocked: !!patch.blocked }); set((s) => ({ prefs: { ...s.prefs, [id]: { ...s.prefs[id], ...patch } } })); },
}), { name: 'smu_chatprefs_v1', partialize: (s) => ({ prefs: s.prefs }) }));

// "You" hub data that belongs to the person (kept on this device, cleared on log out):
// current mood bubble, custom contact lists and the Send ME/U Plus plan.
export const moodActive = (m) => !!m && !!m.text && (!m.until || m.until > Date.now());
export const useProfile = create(persist((set) => ({
  mood: null, // { emoji, text, until }
  lists: [], // { id, name, emoji, members: [chatId] }
  plan: null, // { id: 'monthly'|'yearly', since, trialEnds }
  reset: () => set({ mood: null, lists: [], plan: null }),
  setMood: (mood) => set({ mood }),
  addList: (l) => { const item = { id: rid(), emoji: '⭐', members: [], ...l }; set((s) => ({ lists: [...s.lists, item] })); return item; },
  updateList: (id, patch) => set((s) => ({ lists: s.lists.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
  deleteList: (id) => set((s) => ({ lists: s.lists.filter((l) => l.id !== id) })),
  setPlan: (plan) => set({ plan }),
}), { name: 'smu_profile_v1', partialize: (s) => ({ mood: s.mood, lists: s.lists, plan: s.plan }) }));

// Accessibility settings are applied on <html> so plain CSS can react to them (see design.css "You hub" block)
export const applyA11y = (st = {}) => {
  const d = document.documentElement.dataset;
  d.contrast = st.highContrast ? 'high' : 'normal';
  d.motion = st.reduceMotion ? 'reduce' : 'full';
  d.bold = st.boldText ? 'on' : 'off';
  document.documentElement.lang = st.lang || 'en';
};
