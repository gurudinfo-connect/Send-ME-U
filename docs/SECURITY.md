# Security model

**Authentication** Argon2id hashes · 15 min access tokens bound to server sessions · rotating refresh tokens with reuse detection · lockout after 8 failures · generic error messages and timing equalisation (no account enumeration) · OTPs HMAC-hashed with attempt limits.

**Authorization** Every route requires a session unless it is an auth route. Ownership/membership is checked in the query (not just in the handler). Admin routes use server-side RBAC; admins cannot suspend themselves or other admins; every admin write is audit-logged with actor, target and IP. Moderators see only items that were reported.

**Input** Zod validation on every body/query/param; parameterised queries (Prisma; the few raw queries use bound parameters); JSON body limit 1 MB; uploads limited by size and sniffed by magic bytes, never trusted by extension or `Content-Type`; images re-encoded (EXIF removed).

**Transport/headers** helmet, strict CORS allow-list, `nosniff` and sandboxing CSP on media, HSTS via helmet when behind TLS.

**Abuse controls** Redis-backed rate limits (global, auth, OTP, sending, uploads), per-socket token buckets for typing/signalling, block lists enforced in chat, calls, profiles, presence and follows, user reports → moderation queue.

**Privacy** Signed expiring media URLs · Private Space with PIN lockout · live location is consent-based, latest-point-only, expiring and deleted on stop · account deletion revokes sessions immediately and purges data after 30 days · disappearing messages and 24 h stories are really deleted (rows tombstoned, files removed unless still referenced).

**Not provided** End-to-end encryption (see README). Secrets management and disk/database encryption are the operator's responsibility.
