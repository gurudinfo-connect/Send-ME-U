import 'dotenv/config';
import { z } from 'zod';

const bool = z.union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false'), z.literal('')]).transform((v) => v === '1' || v === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(5000),
  PUBLIC_URL: z.string().default('http://localhost:5000'),
  PUBLIC_APP_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // Folder holding the built frontend (npm run build at the repo root). Defaults to <repo>/dist
  WEB_DIR: z.string().optional(),
  TRUST_PROXY: z.string().default('0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().optional().default(''),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  OTP_PEPPER: z.string().min(8).default('dev-otp-pepper'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  REQUIRE_EMAIL_VERIFICATION: bool.default('0'),
  EXPOSE_DEV_OTP: bool.default('0'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('Send ME/U <no-reply@sendmeu.app>'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  RUN_JOBS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(50),
  S3_BUCKET: z.string().optional().default(''),
  S3_REGION: z.string().default('ap-south-1'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: bool.default('0'),
  MEDIA_URL_TTL: z.coerce.number().default(3600),
  EXPO_ACCESS_TOKEN: z.string().optional().default(''),
  STUN_URLS: z.string().default('stun:stun.l.google.com:19302'),
  TURN_URLS: z.string().optional().default(''),
  TURN_SECRET: z.string().optional().default(''),
  TURN_USERNAME: z.string().optional().default(''),
  TURN_CREDENTIAL: z.string().optional().default(''),
  SMS_WEBHOOK_URL: z.string().optional().default(''),
  ADMIN_EMAIL: z.string().default('admin@sendmeu.app'),
  ADMIN_PASSWORD: z.string().default('ChangeMe!12345'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
if (isProd) {
  if (/replace-with|change-me/i.test(env.JWT_ACCESS_SECRET) || env.EXPOSE_DEV_OTP) {
    // eslint-disable-next-line no-console
    console.error('Refusing to start in production with the example JWT secret or EXPOSE_DEV_OTP enabled.');
    process.exit(1);
  }
}
export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
