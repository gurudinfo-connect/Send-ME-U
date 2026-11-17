import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

// Redis is optional: without REDIS_URL every consumer falls back to in-process memory (single instance only).
export const redis: Redis | null = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false, enableOfflineQueue: true })
  : null;
if (redis) redis.on('error', (e) => logger.warn({ err: e.message }, 'redis error'));
