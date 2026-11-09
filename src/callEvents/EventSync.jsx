import { useEffect } from 'react';
import { USE_MOCK } from '../services/api';
import { subscribeCallEvents } from '../services/socket';
import { callEventService } from './eventService';
import { useAuth, useUI } from '../store';

// Mounted once for signed-in users: shows a toast for each event invitation / change / reminder.
// Demo mode also plays the scheduler's role and delivers due reminders; the real server pushes them itself (notification:new).
export default function EventSync() {
  const user = useAuth((s) => s.user);
  const notify = useUI((s) => s.notify);
  useEffect(() => subscribeCallEvents((name, p) => { if (name === 'notification:new' && p?.text) notify(p.text); }), [notify]);
  useEffect(() => {
    if (!user || !USE_MOCK) return undefined;
    const run = () => { try { callEventService.deliverReminders(); } catch { /* ignore */ } };
    run(); const t = setInterval(run, 15000);
    return () => clearInterval(t);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
