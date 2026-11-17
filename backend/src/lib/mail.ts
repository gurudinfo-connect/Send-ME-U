import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined })
  : null;

export async function sendMail(to: string, subject: string, text: string) {
  if (!transport) { logger.info({ to, subject }, 'email (SMTP not configured, not sent)'); return false; }
  try { await transport.sendMail({ from: env.MAIL_FROM, to, subject, text }); return true; } catch (e: any) { logger.error({ err: e.message, to }, 'email failed'); return false; }
}

/** Deliver a one-time code to an email address or phone number. */
export async function sendOtp(target: string, code: string, purpose: string) {
  const label = purpose === 'RESET_PASSWORD' ? 'password reset' : 'verification';
  const text = `Your Send ME/U ${label} code is ${code}. It expires in 10 minutes. If you did not request it, ignore this message.`;
  if (target.includes('@')) return sendMail(target, `Your Send ME/U ${label} code`, text);
  if (env.SMS_WEBHOOK_URL) { // plug in any SMS gateway that accepts a JSON webhook
    try { await fetch(env.SMS_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: target, message: text }) }); return true; } catch (e: any) { logger.error({ err: e.message }, 'sms webhook failed'); }
  }
  logger.info({ target }, 'sms (no gateway configured, not sent)');
  return false;
}
