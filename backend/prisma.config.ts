import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Default: the standard Prisma schema engine (downloaded by `npm install`).
// PRISMA_ENGINE=js uses the WASM schema engine + the pg adapter instead; handy in locked-down build
// environments that cannot reach binaries.prisma.sh (it needs no native engine download).
const useJs = process.env.PRISMA_ENGINE === 'js';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations'), seed: 'tsx prisma/seed.ts' },
  ...(useJs
    ? {
        engine: 'js',
        experimental: { adapter: true },
        async adapter() {
          const { PrismaPg } = await import('@prisma/adapter-pg');
          return new PrismaPg({ connectionString: process.env.DATABASE_URL });
        },
      }
    : {}),
} as any);
