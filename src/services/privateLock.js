// Private Space password lock — stored on this device only (salted SHA-256), per user.
import { useAuth } from '../store';

const key = () => `smu_plock_${useAuth.getState().user?.id || 'guest'}`;

async function digest(password, salt) {
  const text = `${salt}:${password}`;
  if (window.crypto?.subtle) {
    const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0; // fallback (non-secure origins)
  return `f${h.toString(16)}`;
}

export const lockConfig = () => { try { return JSON.parse(localStorage.getItem(key())) || null; } catch { return null; } };
const save = (c) => localStorage.setItem(key(), JSON.stringify(c));

export async function setPassword(password) {
  const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
  save({ enabled: true, salt, hash: await digest(password, salt) });
}
export async function verifyPassword(password) {
  const c = lockConfig();
  return !!c && (await digest(password, c.salt)) === c.hash;
}
export const disableLock = () => { const c = lockConfig(); if (c) save({ ...c, enabled: false }); };
export const clearLock = () => localStorage.removeItem(key());
