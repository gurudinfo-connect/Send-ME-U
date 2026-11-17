import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import { corsOrigins, env, isProd, isTest } from './config/env';
import { prisma } from './lib/db';
import { redis } from './lib/redis';
import { logger } from './lib/logger';
import { readObject, verifySigned } from './lib/storage';
import { errorHandler, notFoundHandler } from './middleware/error';
import { globalLimiter } from './middleware/rateLimit';
import { adminRouter } from './modules/admin';
import { authRouter } from './modules/auth';
import { callEventsRouter, callsRouter } from './modules/calls';
import { chatRouter, groupsRouter, messagesRouter } from './modules/chat';
import { coupleRouter } from './modules/couple';
import { miscRouter } from './modules/misc';
import { privateRouter } from './modules/private';
import { highlightsRouter, storiesRouter } from './modules/stories';
import { streaksRouter } from './modules/streaks';
import { discoverRouter, socialRouter, usersRouter } from './modules/users';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY === 'true' ? true : env.TRUST_PROXY);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false })); // the API serves JSON and media, not pages
  app.use(cors({ origin: (o, cb) => cb(null, !o || corsOrigins.includes('*') || corsOrigins.includes(o)), credentials: true, exposedHeaders: ['X-Request-Id', 'RateLimit'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Private-Token', 'X-Request-Id'], maxAge: 600 }));
  app.use(compression());
  if (!isTest) app.use((req, res, next) => { const t = Date.now(); res.on('finish', () => { if (req.path !== '/health' && !req.path.startsWith('/media/')) logger.info({ m: req.method, p: req.path, s: res.statusCode, ms: Date.now() - t }, 'req'); }); next(); });

  // ── liveness / readiness (no auth, no rate limit)
  app.get('/health', (_req, res) => { res.json({ status: 'ok', uptime: Math.round(process.uptime()) }); });
  app.get('/ready', async (_req, res) => {
    try { await prisma.$queryRaw`SELECT 1`; if (redis) await redis.ping(); res.json({ status: 'ready' }); }
    catch (e: any) { res.status(503).json({ status: 'unavailable', error: String(e.message).slice(0, 100) }); }
  });

  // ── media: HMAC-signed, expiring URLs. No cookie/token needed, so <img>/<video> work; guessing a key is useless without the signature.
  app.get('/media/*', async (req, res) => {
    const key = String((req.params as any)[0] || '');
    const exp = Number(req.query.exp); const sig = String(req.query.sig || '');
    if (!key || key.includes('..') || !verifySigned(key, exp, sig)) { res.status(403).json({ error: { code: 'forbidden', message: 'This link has expired' }, message: 'This link has expired' }); return; }
    const obj = await readObject(key);
    if (!obj) { res.status(404).json({ error: { code: 'not_found', message: 'Not found' }, message: 'Not found' }); return; }
    res.setHeader('Content-Type', obj.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', `private, max-age=${Math.max(60, Math.min(env.MEDIA_URL_TTL, Math.floor(exp - Date.now() / 1000)))}`);
    res.setHeader('Accept-Ranges', 'bytes');
    const stream = obj.stream as any;
    if (Buffer.isBuffer(stream)) { res.end(stream); return; }
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && obj.size && stream.destroy && env.STORAGE_DRIVER !== 's3') {
      stream.destroy(); // reopen the local file with a byte range for video seeking
      const start = range[1] ? Number(range[1]) : Math.max(0, obj.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), obj.size - 1) : obj.size - 1;
      if (start > end || start >= obj.size) { res.status(416).setHeader('Content-Range', `bytes */${obj.size}`).end(); return; }
      const fs = await import('node:fs');
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${obj.size}`).setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(path.join(path.resolve(env.UPLOAD_DIR), key), { start, end }).pipe(res); return;
    }
    if (obj.size) res.setHeader('Content-Length', String(obj.size));
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  // ── admin dashboard (static SPA). Its data comes from /api/v1/admin, which enforces roles on the server.
  const adminDir = path.resolve(__dirname, '../admin');
  app.use('/admin', express.static(adminDir, { index: 'index.html', maxAge: isProd ? '1h' : 0, setHeaders: (r) => { r.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"); } }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  const api = express.Router();
  api.use(globalLimiter);
  api.get('/', (_req, res) => { res.json({ name: 'Send Me/U API', version: 'v1' }); });
  // public + prefix-scoped routers first
  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/discover', discoverRouter);
  for (const p of ['/conversations', '/chats']) api.use(p, chatRouter); // /chats is the spec's name for the same resource
  api.use('/messages', messagesRouter);
  api.use('/groups', groupsRouter);
  api.use('/stories', storiesRouter);
  api.use('/highlights', highlightsRouter);
  api.use('/streaks', streaksRouter);
  for (const p of ['/couple', '/couples']) api.use(p, coupleRouter);
  for (const p of ['/private', '/private-space']) api.use(p, privateRouter);
  api.use('/calls', callsRouter);
  api.use('/call-events', callEventsRouter);
  api.use('/admin', adminRouter);
  // routers that live at the API root (they require auth themselves, so they go last)
  api.use(socialRouter);
  api.use(miscRouter);
  api.use(notFoundHandler);

  app.use('/api/v1', api);
  app.use('/api', api); // spec alias: /api/auth/login etc.

  // ── the mobile/web app itself (Vite build in ../dist). One server = UI + API + sockets + admin.
  const webDir = path.resolve(env.WEB_DIR || path.resolve(__dirname, '../../frontend/dist'));
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir, { index: false, maxAge: isProd ? '1h' : 0, setHeaders: (r, f) => { if (/sw\.js$|index\.html$/.test(f)) r.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^\/(?!api\/|media\/|admin|socket\.io|health|ready).*/, (_req, res) => { res.sendFile(path.join(webDir, 'index.html')); }); // SPA fallback
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
