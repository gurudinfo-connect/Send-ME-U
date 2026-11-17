import pino from 'pino';
import { env, isTest } from '../config/env';

export const logger = pino({
  level: isTest ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.pin', '*.token', '*.refreshToken'], censor: '[redacted]' },
});
