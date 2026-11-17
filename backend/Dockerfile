# syntax=docker/dockerfile:1
# Backend-only image. Build context is this folder.
#   cd backend && docker build -t sendmeu-api .  (API + admin only; the root Dockerfile also bundles the frontend)
FROM node:22-bookworm-slim AS build
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production PORT=5000
WORKDIR /app/backend
# ffmpeg: video compression / trimming / poster frames (optional; uploads fall back to storing the original without it)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates tini curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/admin ./admin
COPY --from=build /app/backend/prisma.config.ts /app/backend/package.json ./
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD curl -fsS http://localhost:${PORT}/health || exit 1
# migrations run before the server starts (safe to run from several replicas: Prisma takes an advisory lock)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
