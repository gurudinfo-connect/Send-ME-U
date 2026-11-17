import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { isTest } from '../config/env';
import { redis } from '../lib/redis';

const make = (name: string, windowMs: number, max: number, keyByUser = false) =>
  rateLimit({
    windowMs, limit: isTest ? 10_000 : max, standardHeaders: 'draft-7', legacyHeaders: false, passOnStoreError: true,
    ...(redis ? { store: new RedisStore({ prefix: `rl:${name}:`, sendCommand: (...args: string[]) => (redis as any).call(...args) }) } : {}),
    keyGenerator: (req) => (keyByUser && (req as any).user?.id) || req.ip || 'anon',
    handler: (_req, res) => { res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests, slow down' }, message: 'Too many requests, slow down' }); },
  });

export const globalLimiter = make('global', 60_000, 600);
export const authLimiter = make('auth', 15 * 60_000, 40);        // login / register / reset
export const otpLimiter = make('otp', 60 * 60_000, 10);          // OTP sends per IP per hour
export const sendLimiter = make('send', 60_000, 120, true);      // chat messages per user
export const uploadLimiter = make('upload', 60_000, 40, true);
