# syntax=docker/dockerfile:1
# One image = web/mobile UI + API + Socket.IO + admin dashboard.   docker build -t sendmeu .
FROM node:22-bookworm-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY frontend/index.html frontend/vite.config.js ./
COPY frontend/public ./public
COPY frontend/src ./src
ARG VITE_USE_MOCK=false
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_SOCKET_URL=
ENV VITE_USE_MOCK=$VITE_USE_MOCK VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_SOCKET_URL=$VITE_SOCKET_URL
RUN npm run build

FROM node:22-bookworm-slim AS api
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production PORT=5000
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates tini curl && rm -rf /var/lib/apt/lists/*
COPY --from=api /app/backend/node_modules ./node_modules
COPY --from=api /app/backend/dist ./dist
COPY --from=api /app/backend/prisma ./prisma
COPY --from=api /app/backend/admin ./admin
COPY --from=api /app/backend/prisma.config.ts /app/backend/package.json ./
COPY --from=web /app/frontend/dist /app/frontend/dist
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD curl -fsS http://localhost:${PORT}/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
