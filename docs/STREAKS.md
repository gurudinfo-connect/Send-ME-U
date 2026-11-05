# Friends Streaks

## What is in the project

| Area | File |
|---|---|
| Rules engine (pure, no browser APIs, reusable on a Node backend) | `src/streaks/engine.js` |
| Demo "server" used when `VITE_USE_MOCK=true` (same rules, saved in the browser) | `src/services/streakService.js` |
| API client + endpoints | `src/services/api.js` (`streaks`, `streak`, `streakContribution`, `recordStreakActivity`, `recoverStreak`, `streakPrefs`, `setStreakPrefs`) |
| React hooks (real-time) | `src/streaks/hooks.js` |
| UI pieces (badge, chat bar, celebration, share card) | `src/streaks/components.jsx` |
| Dashboard screen (`/streaks`) | `src/screens/Streaks.jsx` |
| Chat list badges + "Streaks" filter | `src/screens/Home.jsx` |
| Chat status bar + celebrations | `src/screens/Chat.jsx` |
| SQL migration (PostgreSQL) | `backend/migrations/001_friend_streaks.sql` |
| Tests | `tests/streaks.test.js`, `tests/streakService.test.js` |

**Important:** the uploaded project has no backend or database, only the React app with a demo-data layer. So the rules are written once in `engine.js`, and the demo service runs them locally so the whole feature works today. For production, your backend must run the same engine (see below). A client can never be trusted to set its own streak.

## Rules (as implemented)
- A streak belongs to one friendship (two users). Both must send a qualifying text, photo, video or voice message on the same streak day; one-sided activity never counts and never carries to the next day.
- Count +1 when both exchange again on the next consecutive day. Extra messages the same day do nothing. Replays of the same message id do nothing (idempotent).
- Not qualifying: reactions, calls, system or automated messages, empty text, repeated-character spam.
- Expiry: a full streak day passes with no mutual exchange. The deadline is the end of the day after `last_mutual_day`.
- At risk (hourglass): within `atRiskHours` (default 4) of the deadline, only when a contribution is still owed.
- Milestones: 3, 7, 14, 30, 50, 100, 365 days. Saved once per run, cosmetic badges (Spark, Flame, Bonfire, Blaze, Inferno, Legend, Eternal), optional shareable card drawn locally.
- Recovery: one free recovery per friendship per 30 days, within 48 hours of expiry. Restores the previous count; both friends still need to exchange that day. Configurable in `DEFAULT_CONFIG`.
- Blocked, removed or deleted friendships ignore activity and hide the streak.
- Reminders: opt-out switch independent of message notifications, at most one nudge per day, never when the user already contributed.

## Timezone policy
A streak day is a calendar day in the **friendship timezone**, an IANA zone stored on the streak row (`tz`). It is set when the streak row is first created (the timezone of the user who sent the first message, falling back to UTC) and does not change, so both friends always share one deadline even if one travels. All timestamps are stored in UTC; day keys are derived with `dayKey(ms, tz)`, which uses `Intl` and handles DST (23 and 25 hour days are tested).

## Backend integration (what your server must do)
1. Run `001_friend_streaks.sql`.
2. In the message-send pipeline, after a message is saved, call the engine inside one transaction:
   `BEGIN; SELECT ... FROM friend_streaks WHERE friendship_id=$1 FOR UPDATE;` (create the row if missing, after checking the friendship is accepted and neither side blocked the other) then `INSERT INTO friend_streak_events ... ON CONFLICT DO NOTHING` (0 rows = duplicate, stop), then `applyActivity(state, activity, { now: serverNow })`, write the new state, milestones and recoveries, `COMMIT`. The row lock makes concurrent messages safe. Always pass the **server** clock as `now`.
3. After commit, emit `streak:update` to both users' socket rooms: `{ friendshipId, summary, events }` where `summary` has the shape returned by `summarize()` in `streakService.js` (the client only needs the fields it already reads) and `events` is the engine's event list (`started`, `incremented`, `milestone`, `expired`, `recovered`).
4. A scheduled job (every 15 min) runs `evaluate()` for streaks whose `expires_at` is near, sends push reminders where `shouldRemind()` is true, and marks them reminded.

### REST endpoints (use the existing auth middleware; only the two participants may read or write)
| Method | Path | Purpose |
|---|---|---|
| GET | `/streaks` | Current user's streaks (summaries). Excludes blocked/removed. |
| GET | `/streaks/:friendshipId` | One streak's detail. 403/404 for non-participants. |
| GET | `/streaks/:friendshipId/contribution` | Who contributed today, `msLeft` to deadline. |
| POST | `/streaks/:friendshipId/activity` | Optional/internal. Production servers should record from the message pipeline instead; never trust a client-supplied count. |
| POST | `/streaks/:friendshipId/recover` | Recover an eligible streak (free). 409 if not eligible. |
| GET / PUT | `/streaks/preferences` | `{ enabled, push, inApp, hoursBefore }` |

Streak analytics never include message content, only counts, days and who contributed.

## Environment variables
No new variables. Existing ones still apply: `VITE_USE_MOCK` (true = demo service), `VITE_API_BASE_URL`, `VITE_SOCKET_URL`.

## Setup and tests
```
npm install
npm run dev        # demo mode shows streaks immediately
npm test           # node --test "tests/*.test.js"   (22 tests, no extra dependencies)
```
Demo data: Priya has a 12-day streak (she has already sent today), Rahul has 3 days, Anu has an expired 21-day streak you can recover once. Reset with `localStorage.removeItem('smu_streaks_v1')`.

## Snap camera: filters and gallery

Chats → orange camera button opens the streak-snap camera.

- **Filters** (`src/streaks/filters.js`): 12 looks (Original, Vivid, Golden, Frost, Noir, Vintage, Faded, Dreamy, Sunset, Neon, Retro cam, Polaroid). Tap one in the strip or swipe left/right on the viewfinder. Filters are applied live and again when the photo is taken (canvas `ctx.filter` + overlay), so the saved photo matches the preview. The photo is stored unfiltered, so the filter can still be changed on the "Send to" screen.
  Add a filter by pushing `{ id, name, css, overlay?, swatch }` onto `FILTERS`.
- **Gallery** (`src/streaks/gallery.js`, `SnapGallery.jsx`): "Save" on the Send-to screen keeps the filtered photo on the device (IndexedDB, newest first). The Gallery button (bottom right of the camera) opens a grid; tap a photo to Send it, save it **To device**, add it to **Memories** (album "Snaps"), or delete it. "Select" deletes several at once.
- Browsers without `CanvasRenderingContext2D.filter` (older Safari) still preview filters, but the captured colour grading is skipped; overlays (vignette, frame, grain, tint) still apply.
- Tests: `npm test` (includes `tests/snapFilters.test.js`).
