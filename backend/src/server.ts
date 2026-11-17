import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/db';
import { logger } from './lib/logger';
import { redis } from './lib/redis';
import { startJobs, stopJobs } from './jobs';
import { initSockets } from './sockets';

async function main() {
  await prisma.$queryRaw`SELECT 1`; // fail fast if the database is unreachable
  const app = createApp();
  const server = http.createServer(app);
  const io = initSockets(server);
  server.keepAliveTimeout = 65_000; // longer than common load-balancer idle timeouts
  server.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Send Me/U API listening'));
  if (env.RUN_JOBS) startJobs();

  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return; closing = true;
    logger.info({ sig }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 15_000); force.unref();
    stopJobs();
    io.close();
    server.close(async () => {
      try { await prisma.$disconnect(); redis?.disconnect(); } finally { clearTimeout(force); process.exit(0); }
    });
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (e: any) => logger.error({ err: e?.message || String(e) }, 'unhandledRejection'));
}
main().catch((e) => { logger.fatal({ err: e.message }, 'failed to start'); process.exit(1); });
