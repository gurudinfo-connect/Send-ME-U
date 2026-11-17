# Deployment guide

## 1. What you need
| Component | Notes |
|---|---|
| API (this repo) | Docker image (`backend/Dockerfile`) or Node 22 |
| PostgreSQL 15+ | extensions `btree_gist`, `pg_trgm` (migrations enable them; managed services allow both) |
| Redis 7 | rate limits, presence, Socket.IO adapter, job locks. Needed for more than one API replica |
| Object storage | optional; local disk volume by default, S3-compatible for multiple replicas |
| TURN server | optional but recommended for calls (coturn with `use-auth-secret`) |
| SMTP | for email OTP / password reset |

## 2. Configuration
Copy `.env.example`. Required: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `OTP_PEPPER` (long random values: `openssl rand -base64 48`), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CORS_ORIGINS` (your web origin), `PUBLIC_URL` (the API's public URL — used in media links), `PUBLIC_APP_URL` (web app URL for invitation links). Production requires strong secrets and refuses the default admin password. Set `TRUST_PROXY=1` behind one load balancer so rate limits see real client IPs. Secrets are **only** server-side; the web/mobile app contains none.

## 3. Docker (single host)
```bash
cp backend/.env.example .env      # edit
docker compose up -d --build
docker compose exec api npm run seed   # first admin
```
Put a TLS-terminating proxy (Caddy, nginx, a cloud load balancer) in front of port 5000. WebSockets must be allowed and idle timeouts ≥ 60 s. The container health check is `GET /health`; readiness is `GET /ready` (database + Redis).

## 4. Scaling out
Run several `api` containers behind the load balancer. Requirements: Redis (`REDIS_URL`), `STORAGE_DRIVER=s3` (so every replica sees uploads), and one replica (or a worker) with `RUN_JOBS=true` — jobs are also Redis-locked, so extra runners are harmless. Sticky sessions are not required (Socket.IO uses WebSocket only).

## 5. Migrations
`npx prisma migrate deploy` (the container does this on start). Never edit an applied migration; add a new one with `npx prisma migrate dev --name change` locally. The `constraints` migration holds what Prisma cannot express (exclusion constraints, trigram indexes, CHECKs).

## 6. Backups
`DATABASE_URL=… sh backend/scripts/backup.sh` → custom-format dump; test restores with `restore.sh` on a scratch database regularly. Back up the uploads volume or enable bucket versioning. Schedule daily; keep 14+ days.

## 7. Admin dashboard
Served by the API at `/admin` (static files, CSP locked to same origin). Sign in with an ADMIN or MODERATOR account. Create more moderators by changing a role in the dashboard (admins only). Restrict `/admin` at your proxy to a VPN/IP allow-list if you can.

## 8. Mobile (Android) notes
The mobile app talks to the same `/api/v1` and Socket.IO endpoints. For Expo/EAS builds: set the API URL via `EXPO_PUBLIC_API_URL`, build with `eas build -p android --profile production`, register devices for push at `POST /users/me/devices` with the Expo push token, and set `EXPO_ACCESS_TOKEN` on the server if you enable push security. Use HTTPS only (Android blocks cleartext by default).

## 9. Production checklist
- [ ] strong secrets, unique per environment; `NODE_ENV=production`
- [ ] TLS everywhere; `CORS_ORIGINS` is an explicit list (no `*`)
- [ ] database not publicly reachable; backups verified
- [ ] SMTP configured; `EXPOSE_DEV_OTP` unset
- [ ] TURN configured if calls matter
- [ ] log shipping/alerts on `/ready` and error rate
- [ ] admin password changed, 2 admins exist
