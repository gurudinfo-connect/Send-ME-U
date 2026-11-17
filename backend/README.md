# Send Me/U — backend

Node.js · Express · TypeScript · PostgreSQL (Prisma) · Redis · Socket.IO. Serves the existing Vite/React app's `/api/v1` contract plus the admin dashboard (`/admin`).

```
backend/
  prisma/            schema.prisma, migrations/, seed.ts
  src/
    app.ts server.ts       HTTP app, entry point (graceful shutdown)
    config/env.ts          every environment variable, validated with Zod (the server refuses to start if one is missing)
    lib/                   db, redis, auth (sessions/JWT/rotation), crypto, storage, mail, notify, presence, realtime
    middleware/            auth + RBAC, rate limits, upload (multer), error handler
    modules/               auth users streaks private chat stories couple misc calls admin (+ rules/ shared pure logic)
    sockets/               Socket.IO: auth handshake, rooms, typing, presence, WebRTC signalling
    jobs/                  expiry, reminders, purge, janitors (Redis-locked)
  tests/                   node:test integration tests against real Postgres + Redis
  scripts/                 test.sh, backup.sh, restore.sh
admin/                   static admin dashboard (served at /admin)
../docs/                   API.md, ER_DIAGRAM.md, DEPLOYMENT.md, SECURITY.md, feature notes
```

## Run it locally

Requirements: Node 22, PostgreSQL 15+ (with the `btree_gist` and `pg_trgm` extensions — included in the standard contrib package), Redis 7 (optional: without it rate limits and presence fall back to memory, single instance only), `ffmpeg` (optional, video compression/posters).

```bash
cd backend
cp .env.example .env            # set DATABASE_URL, JWT_ACCESS_SECRET, OTP_PEPPER (openssl rand -base64 48), ADMIN_PASSWORD
npm ci
npx prisma migrate deploy       # creates the schema
npm run seed                    # creates the admin from ADMIN_EMAIL/ADMIN_PASSWORD; SEED_DEMO=true adds 3 demo accounts
npm run dev                     # http://localhost:5000  ·  admin dashboard: http://localhost:5000/admin
```

Or everything in containers: `cp backend/.env.example backend/.env && docker compose up --build` from the repository root. Migrations run on container start.

Point the frontend at it: `VITE_USE_MOCK=false` and `VITE_API_BASE_URL=http://localhost:5000/api/v1` (the app falls back to its offline demo data otherwise). The frontend refreshes access tokens automatically.

### Scripts
`dev` · `build` (generate client + compile) · `start` · `typecheck` · `test` · `seed` · `db:backup` · `db:restore`

## Tests

`npm test` runs 31 integration tests against a real database (set `DATABASE_URL` to a **scratch** database: the tests create users). They cover registration/login, refresh rotation and theft detection, lockout, account deletion, follow/block/private accounts, messaging (idempotency, receipts, edit/delete rules, realtime, disappearing messages), group permissions, socket authorization, uploads and signed media, stories visibility/expiry, Private Space (locks, PIN lockout, tokens), server-enforced streaks, couples (invites, appointment overlap, private notes, consent-based location), calls (ring/answer/busy/missed, signalling isolation), call events, notifications and the admin API (roles, reports, suspension, audit log).

## Design notes

- **Auth**: Argon2id; 15-minute access JWT bound to a server session (revocation is immediate); opaque refresh tokens stored as SHA-256 and rotated on every use (10 s grace for parallel tabs; replay revokes the session); OTP codes HMAC-hashed, 5 attempts, 10 minutes; 8 failed logins lock the account 15 minutes; no account enumeration.
- **Media**: files are stored under keys; the API only ever returns HMAC-signed, expiring `/media/...` URLs. Uploads are type-sniffed by magic bytes, images are re-encoded to WebP (EXIF/GPS stripped) with thumbnails, videos are compressed/trimmed/postered when `ffmpeg` is present. `STORAGE_DRIVER=s3` works with AWS S3, R2, MinIO, Spaces.
- **Streaks** are computed only on the server, from real messages, with the server clock, under a row lock and idempotent per event. `POST /streaks/:id/activity` from a client is rejected.
- **Couples**: appointment conflicts are rejected twice — by the shared booking rules and by a Postgres exclusion constraint (`tsrange`) — and serialised with per-couple advisory locks. Notes belong to their author; private appointments are invisible to the partner. Live location keeps only the latest point, needs consent, expires, and the coordinates are deleted when sharing ends.
- **Private Space**: PIN (Argon2) → short-lived `X-Private-Token`; locked chats are excluded from lists/search/sockets and answer 423.
- **Realtime**: Socket.IO with the Redis adapter, so you can run several API replicas. Rooms are joined only after a membership (and private-lock) check.
- **Background jobs** (`RUN_JOBS=false` to disable on a replica): call timeouts, disappearing messages, story expiry, reminders (events, appointments, anniversaries, birthdays, scheduled calls), streak reminders, location janitor, 30-day account purge, token/OTP/notification housekeeping.

## Honest limitations

- **No end-to-end encryption.** Messages are protected in transit (TLS) and at rest by your database/disk encryption; the server can read them. The app does not claim otherwise. E2EE would need a vetted protocol (e.g. Signal/MLS) and is not implemented.
- **No SMS gateway.** Phone OTPs are not sent (email OTP via SMTP is). Wire a provider (Twilio, MSG91…) in `src/lib/mail.ts` (`sendOtp`). Without SMTP, OTPs are logged and, only if `EXPOSE_DEV_OTP=true` outside production, returned in the response.
- **Calls are 1:1** (WebRTC, peer-to-peer with STUN/TURN). Group calls would need an SFU (LiveKit, mediasoup). Configure `TURN_URLS` + `TURN_SECRET` (coturn) for calls across strict NATs.
- **Push notifications** use Expo Push; they are delivered once the mobile app registers device tokens (`POST /users/me/devices`).
- The React Native mobile rewrite described in the project brief is **not** part of this delivery; the backend serves the existing web frontend and is mobile-ready.
- `prisma migrate deploy` could not be exercised in the build sandbox (Prisma's engine download is blocked there); the migration SQL was applied with `psql` instead, and `migrate diff` was used to generate it. Run `npx prisma migrate deploy` on a staging database first.
