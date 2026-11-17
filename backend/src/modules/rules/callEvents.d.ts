export const REMINDER_OPTIONS: { value: number; label: string }[];
export const ms: (v: any) => number;
export const reminderLabel: (m: any) => string;
export function validateEvent(b: any, now?: number): { ok: boolean; error?: string; value?: any };
export const reminderAt: (startISO: any, minutes: any) => string | null;
export function eventState(e: any, now?: number): 'cancelled' | 'ended' | 'live' | 'upcoming';
export function joinDecision(e: any, userId: string, guest: any, now?: number): { ok: boolean; reason?: string; early?: boolean; needsApproval?: boolean; host?: boolean };
export function mergeGuests(existing: any[], ids: string[], hostId: string): { rows: any[]; added: string[] };
