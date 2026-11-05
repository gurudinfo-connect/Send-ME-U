// Live-location rules (pure). Sessions are consent-based and expire; coordinates are never shown as "live" unless fresh.
export const DURATIONS = { '15m': 15 * 60e3, '1h': 3600e3, '8h': 8 * 3600e3, off: null };
export const DURATION_LABELS = [['15m', '15 minutes'], ['1h', '1 hour'], ['8h', '8 hours'], ['off', 'Until I turn it off']];
export const LIVE_MS = 90e3;              // updated within 90 s  -> "Live"
export const RECENT_MS = 5 * 60e3;        // within 5 min         -> "Recently updated"; older -> "Last known" (never called live)
export const INACTIVITY_MS = 30 * 60e3;   // an "until I turn it off" session with no updates for 30 min ends by itself
export const PUSH_EVERY_MS = 15e3;

const t = (x) => (x == null ? null : typeof x === 'number' ? x : new Date(x).getTime());

export const expiryFor = (key, now = Date.now()) => (key in DURATIONS ? (DURATIONS[key] == null ? null : new Date(now + DURATIONS[key]).toISOString()) : undefined);

// A session counts only while it is switched on, not stopped, not past its expiry, and (for open-ended ones) not abandoned.
export function sessionActive(s, now = Date.now(), lastUpdate = null) {
  if (!s || !s.is_active || s.stopped_at) return false;
  const exp = t(s.expires_at);
  if (exp != null) return exp > now;
  const last = t(lastUpdate) ?? t(s.started_at);
  return last != null && now - last < INACTIVITY_MS;
}

export function freshness(updatedAt, now = Date.now()) {
  const u = t(updatedAt); if (u == null) return 'none';
  const age = now - u;
  return age <= LIVE_MS ? 'live' : age <= RECENT_MS ? 'recent' : 'stale';
}

// What the other person may see: nothing unless their session is active, and then the position tagged with its freshness.
export function visibleLocation({ session, location, now = Date.now() }) {
  if (!location || !sessionActive(session, now, location.updated_at)) return null;
  return { ...location, freshness: freshness(location.updated_at, now), expires_at: session.expires_at ?? null };
}

export function validCoords(lat, lng, accuracy) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (accuracy == null || (Number.isFinite(accuracy) && accuracy >= 0));
}

export function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180, R = 6371.0088;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// Deliberately coarse: this is "about how far", not a precise reading.
export function fmtDistance(km) {
  if (km == null) return '';
  if (km < 0.1) return 'Very close';
  if (km < 1) return `~${Math.round((km * 1000) / 50) * 50} m`;
  return `~${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function ageLabel(updatedAt, now = Date.now()) {
  const u = t(updatedAt); if (u == null) return 'never';
  const s = Math.max(0, Math.round((now - u) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); return h < 24 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`;
}

export function timeLeftLabel(expiresAt, now = Date.now()) {
  const e = t(expiresAt); if (e == null) return 'until you stop';
  const m = Math.max(0, Math.ceil((e - now) / 60e3));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m} min left`;
}
