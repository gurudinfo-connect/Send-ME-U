import crypto from 'node:crypto';
import argon2 from 'argon2';
import { env } from '../config/env';

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = async (hash: string, pw: string) => { try { return await argon2.verify(hash, pw); } catch { return false; } };

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
export const randomCode = (digits = 6) => String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0');
export const randomId = (len = 16) => crypto.randomBytes(len).toString('hex').slice(0, len);
export const hmac = (s: string) => crypto.createHmac('sha256', env.OTP_PEPPER).update(s).digest('hex');
export const safeEqual = (a: string, b: string) => {
  const A = Buffer.from(a); const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
