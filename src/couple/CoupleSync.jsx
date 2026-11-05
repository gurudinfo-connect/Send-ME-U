import { useEffect } from 'react';
import { api } from '../services/api';
import { subscribeCouple } from '../services/socket';
import { useAuth, useUI } from '../store';
import { PUSH_EVERY_MS } from './location';
import { ms } from './scheduling';

// Mounted once for signed-in users. It (1) shows a toast for each couple notification and
// (2) while MY sharing session is active, sends my position every 15 s. It never starts a session by itself:
// with no active session it does not even ask the browser for location.
export default function CoupleSync() {
  const user = useAuth((s) => s.user);
  const notify = useUI((s) => s.notify);

  useEffect(() => subscribeCouple((name, p) => { if (name === 'notification:new' && p?.text) notify(p.text); }), [notify]);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true, watchId = null, timer = null, expTimer = null, last = null;
    const stop = () => {
      if (watchId != null) navigator.geolocation?.clearWatch(watchId);
      watchId = null; last = null; clearInterval(timer); clearTimeout(expTimer); timer = null; expTimer = null;
    };
    const push = async () => {
      if (!last) return;
      try { await api.pushLocation(last); } catch (e) { if (e?.response?.data?.code === 'not_sharing') { stop(); } }
    };
    const sync = async () => {
      let s = null;
      try { s = (await api.locationState()).session; } catch { return; }
      if (!alive) return;
      stop();
      if (!s || !navigator.geolocation) return;
      watchId = navigator.geolocation.watchPosition(
        (pos) => { const first = !last; last = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }; if (first) push(); },
        () => {}, // denied / unavailable: the Live Location screen explains it; nothing is sent
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
      );
      timer = setInterval(push, PUSH_EVERY_MS);
      if (s.expires_at) expTimer = setTimeout(sync, Math.max(1000, ms(s.expires_at) - Date.now() + 1000)); // stop sending the moment it expires
    };
    sync();
    const off = subscribeCouple((name) => { if (name === 'location:started' || name === 'location:stopped' || name === 'socket:reconnected') sync(); });
    return () => { alive = false; stop(); off(); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
