import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { env } from '../config/env';
import { prisma } from './db';
import { logger } from './logger';
import { emitToUser } from './realtime';
import { toUrl } from './storage';

type NType = 'MESSAGE' | 'CALL' | 'STORY_REPLY' | 'STORY_REACTION' | 'FOLLOW' | 'FOLLOW_REQUEST' | 'COUPLE_INVITE' | 'COUPLE_UPDATE' | 'CALENDAR_REMINDER' | 'STREAK' | 'GROUP_INVITE' | 'EVENT' | 'SYSTEM';
const PREF: Record<NType, string | null> = {
  MESSAGE: 'notifyMessages', CALL: 'notifyCalls', STORY_REPLY: 'notifyStories', STORY_REACTION: 'notifyStories', FOLLOW: 'notifyFollows',
  FOLLOW_REQUEST: 'notifyFollows', COUPLE_INVITE: 'notifyCouple', COUPLE_UPDATE: 'notifyCouple', CALENDAR_REMINDER: 'notifyCalendar',
  STREAK: 'notifyStreaks', GROUP_INVITE: 'notifyGroups', EVENT: 'notifyCalendar', SYSTEM: null,
};
const expo = new Expo({ accessToken: env.EXPO_ACCESS_TOKEN || undefined });

export function inQuietHours(s: { quietHoursEnabled: boolean; quietStartMin: number; quietEndMin: number; timezone: string }, now = new Date()) {
  if (!s.quietHoursEnabled) return false;
  let mins: number;
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: s.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    mins = Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
  } catch { mins = now.getUTCHours() * 60 + now.getUTCMinutes(); }
  const { quietStartMin: a, quietEndMin: b } = s;
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b; // window may wrap midnight
}

export interface NotifyInput {
  userId: string; actorId?: string | null; type: NType; title: string; body?: string; data?: Record<string, unknown>;
  push?: boolean; // default true; false = in-app only
  /** calls ignore quiet hours */
  urgent?: boolean;
}

/** Create the in-app notification, push it over the socket, and (respecting preferences + quiet hours) to the phone. */
export async function notify(n: NotifyInput) {
  try {
    if (n.actorId && n.actorId !== n.userId) {
      const blocked = await prisma.blockedUser.findFirst({ where: { OR: [{ blockerId: n.userId, blockedId: n.actorId }, { blockerId: n.actorId, blockedId: n.userId }] }, select: { blockerId: true } });
      if (blocked) return null;
    }
    const settings = await prisma.userSettings.findUnique({ where: { userId: n.userId } });
    const key = PREF[n.type];
    if (settings && key && !(settings as any)[key]) return null;
    const row = await prisma.notification.create({
      data: { userId: n.userId, actorId: n.actorId ?? null, type: n.type, title: n.title, body: n.body ?? '', data: (n.data ?? undefined) as any },
    });
    emitToUser(n.userId, 'notification:new', { id: row.id, type: n.type, title: n.title, body: n.body ?? '', data: n.data ?? {}, createdAt: row.createdAt });
    if (n.push !== false && (!settings || settings.pushEnabled) && (n.urgent || !settings || !inQuietHours(settings))) {
      void sendPush(n.userId, n.title, settings?.hideNotificationPreviews && n.type === 'MESSAGE' ? 'New message' : n.body ?? '', { type: n.type, ...(n.data ?? {}) });
    }
    return row;
  } catch (e: any) {
    logger.warn({ err: e.message, type: n.type }, 'notify failed');
    return null;
  }
}

export async function sendPush(userId: string, title: string, body: string, data: Record<string, unknown>) {
  const devices = await prisma.device.findMany({ where: { userId }, select: { id: true, pushToken: true } });
  const messages: ExpoPushMessage[] = devices.filter((d) => Expo.isExpoPushToken(d.pushToken)).map((d) => ({ to: d.pushToken, title, body, data, sound: 'default', priority: 'high' as const }));
  if (!messages.length) return;
  try {
    for (const chunk of expo.chunkPushNotifications(messages)) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((t, i) => {
        if (t.status === 'error' && (t as any).details?.error === 'DeviceNotRegistered') {
          void prisma.device.deleteMany({ where: { pushToken: String((chunk[i] as any).to) } });
        }
      });
    }
  } catch (e: any) { logger.warn({ err: e.message }, 'push failed'); }
}

export const avatarOf = (p?: { avatarUrl?: string | null } | null) => toUrl(p?.avatarUrl);
