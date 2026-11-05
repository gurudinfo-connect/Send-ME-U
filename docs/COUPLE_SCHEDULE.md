# Couple calendar, shared availability and live location

## Where things are

| Piece | File |
| --- | --- |
| Booking, overlap, free-time and privacy rules (pure, shared by demo and server) | `src/couple/scheduling.js` |
| Sharing sessions, expiry, freshness, distance (pure) | `src/couple/location.js` |
| Map maths (OpenStreetMap tiles, no map library) | `src/couple/geo.js`, `src/couple/SlippyMap.jsx` |
| Calendar on the Couple Space screen, date sheet, booking form | `src/screens/CoupleCalendar.jsx` (rendered by `Couple.jsx`) |
| Live Location screen (`/private/couple/location`) | `src/screens/LiveLocation.jsx` |
| Sends my position while sharing; shows partner notifications | `src/couple/CoupleSync.jsx` (mounted in `App.jsx`) |
| Demo server (used when `VITE_USE_MOCK=true`) | `src/services/coupleService.js` |
| PostgreSQL schema | `backend/migrations/002_couple_calendar_location.sql` |
| REST + Socket.IO server code | `backend/src/couple/routes.js`, `sockets.js` |
| Tests | `tests/coupleScheduling.test.js`, `coupleLocation.test.js`, `coupleService.test.js` (`npm test`) |

## REST (all under `/api/v1/couple`, Bearer token, scoped to the caller's own couple)

- `GET /appointments?from&to`, `POST /appointments`, `PUT /appointments/:id` (send `rev`), `DELETE /appointments/:id` (cancels)
- `GET /availability?from&to`, `POST /availability`, `PUT|DELETE /availability/:id` (own blocks only)
- `GET /slots?from&to&minutes&ignoreId`: both people's free time + the shared time + 30-minute slots
- `GET /location`, `POST /location/session {duration: 15m|1h|8h|off}`, `DELETE /location/session`, `PUT /location {latitude, longitude, accuracy}`, `POST /location/request`

Errors are `{ code, message }`: `overlap`, `not_mutually_free`, `stale`, `in_past`, `end_before_start`, `not_sharing`, `bad_coords`, `too_soon`, ...

## Socket.IO events (to specific users only)

`appointment:created|updated|cancelled`, `availability:updated`, `location:started|update|stopped|request`, `notification:new`.
Location events carry no coordinates; the partner re-fetches `GET /location`.

## Rules worth knowing

- **Time**: stored as UTC; every screen shows the viewer's local time. Ranges are half-open, so 6-7pm and 7-8pm do not clash.
- **No double booking**: shared meetups cannot overlap each other, a partner's busy block, or either person's private commitment. On the server this runs under a per-couple advisory lock, and PostgreSQL exclusion constraints (`appt_no_overlap_*`) back it up, so two simultaneous requests cannot both win (the loser gets `409 overlap`).
- **Edits**: `PUT` needs the `rev` the client last saw; a stale edit gets `409 stale`.
- **Privacy**: lists show `Name: Location`. A "personal" (private) commitment is invisible to the partner and only makes you show as busy. Notes are only returned to their author. The partner never receives your availability blocks, only computed free time.
- **Free vs busy**: if someone adds "available" blocks for a day, only those hours count as free that day (minus anything busy); with none, the whole 7am-11pm planning window counts.
- **Location consent**: nothing starts by itself. Sharing starts only after you pick a duration AND the browser grants a first position. Each partner chooses independently; you only ever see a position the other person is actively sharing, and only your linked partner can. "Ask to share" sends a notification and nothing else (10-minute cooldown).
- **Expiry and freshness**: sessions end at their expiry; "until I turn it off" also ends after 30 minutes without updates. A position older than 90 s is no longer called "Live"; older than 5 minutes it is shown greyed as "Last known". When a session ends the stored position is deleted, so there is no history and nothing stale to show.
- **Web limits**: a browser can only report location while Send ME/U is open (or installed and running). When it is closed, the partner sees the last known position, clearly marked, until the session expires.
- **Map tiles** come from tile.openstreetmap.org (fine for a small app; use a paid tile provider if traffic grows) and need an internet connection.

## Hooking up the real backend

1. Run `002_couple_calendar_location.sql` (needs `users` and `couples(id, user_a, user_b)`; adapt names if yours differ).
2. In your server: `const { notifyUsers } = attachCoupleSockets(httpServer, { verifyToken, pool, corsOrigin });` then `app.use('/api/v1/couple', coupleRouter({ pool, auth, notifyUsers }));`
3. Set `VITE_USE_MOCK=false` with `VITE_API_BASE_URL` / `VITE_SOCKET_URL`.
