import { useEffect, useRef } from 'react';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { streakBus } from '../services/streakService';
import { useAsync } from '../components/ui';

// Subscribes to real-time streak updates: the demo bus, plus the `streak:update` socket event when a real server is connected.
export function useStreakEvents(handler, friendshipId) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    const on = (e) => { const d = e.detail || e; if (!friendshipId || d.friendshipId === friendshipId) ref.current(d); };
    streakBus.addEventListener('streak:update', on);
    const s = getSocket(); s?.on('streak:update', on);
    return () => { streakBus.removeEventListener('streak:update', on); s?.off('streak:update', on); };
  }, [friendshipId]);
}

export function useStreaks() {
  const q = useAsync(() => api.streaks(), []);
  useStreakEvents(() => q.reload());
  useEffect(() => { const t = setInterval(q.reload, 60000); return () => clearInterval(t); }, []); // eslint-disable-line  (countdowns and at-risk status refresh each minute)
  const items = q.data || [];
  return { ...q, items, byId: Object.fromEntries(items.map((s) => [s.friendshipId, s])) };
}

export function useStreak(id) {
  const q = useAsync(() => api.streak(id), [id]);
  useStreakEvents(() => q.reload(), id);
  useEffect(() => { const t = setInterval(q.reload, 60000); return () => clearInterval(t); }, [id]); // eslint-disable-line
  return q;
}
