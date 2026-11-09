# Scheduled calls (Calls → Schedule)

Plan a voice or video call for later, invite people, and join a real room when the time comes.

## Screens (all under `/calls`)
| Route | Screen |
|---|---|
| `/calls` | **Upcoming** (your next scheduled calls with Join), **Recent**, Call / Schedule actions, green schedule button |
| `/calls/events` | **Events** – filters *All* · *Scheduled calls* · *Not responded* |
| `/calls/events/new` , `/:id/edit` | **Create / Edit event** – image, title, description, start / end, voice or video, approval toggle, reminder, host |
| `/calls/events/guests` | **Add guest** (create/edit flow): invite link, frequently contacted, contacts, search, Skip / Create / Save |
| `/calls/events/:id` | **Event details** – date, Add to calendar (.ics), Copy link, Join, reminder, Going / Not responded, Invite more guests |
| `/calls/events/:id/invite` | Invite more guests (people already invited are shown as *Invited* and cannot be picked twice) |
| `/calls/join/:meetingId` | Opening an invitation link |
| `/calls/room/:id` | The call room |

Menu → *Scheduled calls* and the old `/calls/scheduled` route both lead to `/calls/events`.

## Rules (one source of truth: `src/callEvents/logic.js`)
- End must be after start, not already over, at most 24 h. Reminder: 5 / 15 / 30 min, 1 h, 1 day, none (default 15 min).
- **Join** is allowed for the host and for invited guests who have not declined, from 10 minutes before the start until the end; never for cancelled / ended events. With *require approval*, a guest asks and the host approves or rejects (in the room or on the event page).
- Guests are unique per event (`UNIQUE (event_id, user_id)` + `mergeGuests`); the host is never a guest; removed guests can be re-invited.
- Editing keeps the event id and meeting link, tells guests about changes and re-plans reminders. Cancelling keeps the row so guests see *Cancelled*.

## Real calling
`src/callEvents/rtc.js` is a WebRTC mesh (fine for small groups). The browser asks for the microphone (and camera for video calls); if blocked the person still joins and listens. Signalling goes through Socket.IO (`room:join`, `room:signal`, `room:leave`, see `backend/src/callEvents/sockets.js`), which admits a socket only if the join rules above allow that user right now. In demo mode (`VITE_USE_MOCK=true`) signalling uses a `BroadcastChannel`, so two tabs on one device genuinely call each other. Add a TURN server through `VITE_ICE_SERVERS` for users behind strict NATs; media never goes through the app server.

## Backend
- `backend/migrations/005_call_events.sql` – `scheduled_events`, `scheduled_event_guests`, `event_reminders`, `call_event_notifications`.
- `backend/src/callEvents/routes.js` – mount at `/api/v1/call-events` (`/events` is already the couple calendar):
  `GET /`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id` (cancel), `POST /:id/guests`, `DELETE /:id/guests/:userId`, `POST /:id/respond`, `GET /:id/participants`, `POST /:id/join`, `POST /:id/leave`, `POST /:id/requests/:userId`, `POST /:id/reminders`, `GET /link/:meetingId`.
- `backend/src/callEvents/sockets.js` – room signalling and the reminder scheduler (claims due reminders with `FOR UPDATE SKIP LOCKED`, stores a notification and pushes `notification:new`).
- Wiring: `attachCallEventSockets(io, { pool })` after `attachCoupleSockets`, then `app.use('/api/v1/call-events', callEventsRouter({ pool, auth, notifyUsers }))`. Set `PUBLIC_APP_URL` so meeting links use your real domain. Merge `call_event_notifications` into `GET /notifications` (or insert into your own notifications table in `notify()`).

## Notifications
Invitation, update, cancellation, accept/decline, join request and reminder notifications appear as toasts and in the Notifications screen; invitations have Accept / Decline buttons there.

## Demo mode
`src/callEvents/eventService.js` mirrors the server (same rules, persisted in localStorage). Invited people who are online accept after a few seconds, and a simulated host approves approval-only join requests, so the lists and approval flow can be tried without a second account. One sample invitation from Priya is seeded.

Tests: `npm test` (`tests/callEvents.test.js`).
