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
  const old = lockConfig();
  save({ enabled: true, salt, hash: await digest(password, salt), ...(old?.bio ? { bio: old.bio } : {}) });
}
export async function verifyPassword(password) {
  const c = lockConfig();
  return !!c && (await digest(password, c.salt)) === c.hash;
}
export const disableLock = () => { const c = lockConfig(); if (c) save({ ...c, enabled: false }); };
export const clearLock = () => localStorage.removeItem(key());

// ---- Biometric unlock (fingerprint on Android, Face ID / Touch ID on iPhone) via the device's own WebAuthn
// platform authenticator. The phone itself checks the finger/face — the app never sees biometric data.
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rand = (n = 32) => crypto.getRandomValues(new Uint8Array(n));

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const biometricLabel = () => (isIOS() ? 'Face ID / Touch ID' : 'fingerprint');

export async function biometricAvailable() {
  try {
    return !!(window.PublicKeyCredential && window.isSecureContext && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}

export async function enrollBiometric() {
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rand(), rp: { name: 'SendMeU', id: location.hostname },
      user: { id: new TextEncoder().encode(key()).slice(0, 64), name: 'private-space', displayName: 'Private Space' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    } });
    const c = lockConfig(); if (!cred || !c) return false;
    save({ ...c, bio: b64(cred.rawId) });
    return true;
  } catch { return false; }
}

export async function verifyBiometric() {
  const c = lockConfig(); if (!c?.bio) return false;
  try {
    const r = await navigator.credentials.get({ publicKey: {
      challenge: rand(), rpId: location.hostname, userVerification: 'required', timeout: 60000,
      allowCredentials: [{ type: 'public-key', id: unb64(c.bio), transports: ['internal'] }],
    } });
    return !!r;
  } catch { return false; }
}

export const disableBiometric = () => { const c = lockConfig(); if (c?.bio) { const { bio, ...rest } = c; save(rest); } };
