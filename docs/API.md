# API reference

Base URL: `/api/v1` (the same routes are also served under `/api`). JSON in, JSON out. Aliases: `/chats` = `/conversations`, `/couples` = `/couple`, `/private-space` = `/private`.

## Conventions

- **Auth**: `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes and are checked against the live session on every request, so logout, password change and suspension take effect at once. Refresh with `POST /auth/refresh` `{refreshToken}`: refresh tokens **rotate**; replaying an old one revokes the whole session.
- **Errors**: `{ "error": { "code": "validation_failed", "message": "…", "details": … }, "message": "…" }` with the usual status codes (400 validation, 401 auth, 403 forbidden, 404, 409 conflict, 423 locked, 429 rate limited).
- **Pagination**: `?limit=&offset=` (max 100) unless stated. Message history uses a cursor (`before`).
- **IDs** are UUIDs. **Media URLs** are HMAC-signed and expire (`MEDIA_URL_TTL`); re-fetch the resource for a fresh URL.
- **Private Space**: locked conversations answer `423` until you send `X-Private-Token` (from `POST /private-space/unlock`).
- **Idempotency**: `POST /conversations/:id/messages` accepts `clientId`; retrying the same id returns the original message.
- **Roles**: `USER`, `MODERATOR`, `ADMIN`. `/admin/*` needs MODERATOR; account, audit and system routes need ADMIN.

## Realtime (Socket.IO)

Connect with `io(URL, { auth: { token: accessToken } })`.

| Client → server | Payload | Notes |
|---|---|---|
| `conversation:join` / `conversation:leave` | `{conversationId, privateToken?}` | ack `{ok}`; membership checked, Private Space needs the token |
| `typing:start` / `typing:stop` | `{conversationId}` | must have joined the room |
| `message:read` | `{conversationId}` | ack |
| `presence:get` | `{userIds[]}` | respects "show online status" and blocks |
| `call:answer` `call:reject` `call:end` `call:busy` `call:failed` | `{callId}` | ack |
| `call:signal` | `{callId, type: offer\|answer\|candidate\|renegotiate\|media, data}` | relayed only to the other participants of a live call |

| Server → client | When |
|---|---|
| `message:new` `message:edited` `message:deleted` `message:pinned` `message:status` `message:reaction` | chat changes |
| `conversation:new` `conversation:updated` `conversation:read` `conversation:removed` | the conversation list changed |
| `typing` | someone typing in a joined room |
| `presence:update` | a chat partner went online/offline |
| `call:incoming` `call:answered` `call:ended` `call:signal` | calls |
| `callevent:changed` `callevent:join_approved` | scheduled call events |
| `session:revoked` | your session ended (logout elsewhere, suspension) |
| `notification:new` | a new in-app notification |
| `streak:update` | server-computed streak changed |
| `couple:updated` `appointment:created\|updated\|cancelled` `availability:updated` | couple space |
| `location:request` `location:started` `location:update` `location:stopped` | consent-based live location (partner only) |

## Endpoints

_Generated from the route definitions; see the source for request bodies (Zod schemas sit next to each route)._

### admin

| Method | Path |
|---|---|
| GET | `/api/v1/admin/stats` |
| GET | `/api/v1/admin/analytics` |
| GET | `/api/v1/admin/users` |
| GET | `/api/v1/admin/users/:id` |
| POST | `/api/v1/admin/users/:id/suspend` |
| POST | `/api/v1/admin/users/:id/unsuspend` |
| PATCH | `/api/v1/admin/users/:id/role` |
| PATCH | `/api/v1/admin/users/:id/verified` |
| GET | `/api/v1/admin/reports` |
| GET | `/api/v1/admin/reports/:id` |
| POST | `/api/v1/admin/reports/:id/resolve` |
| GET | `/api/v1/admin/content/posts` |
| GET | `/api/v1/admin/content/stories` |
| DELETE | `/api/v1/admin/content/:type/:id` |
| GET | `/api/v1/admin/system/health` |
| GET | `/api/v1/admin/system/storage` |
| GET | `/api/v1/admin/audit-logs` |

### auth

| Method | Path |
|---|---|
| GET | `/api/v1/auth/username-available` |
| POST | `/api/v1/auth/register` |
| POST | `/api/v1/auth/login` |
| POST | `/api/v1/auth/request-otp` |
| POST | `/api/v1/auth/verify-otp` |
| POST | `/api/v1/auth/refresh` |
| POST | `/api/v1/auth/logout` |
| POST | `/api/v1/auth/logout-all` |
| GET | `/api/v1/auth/sessions` |
| DELETE | `/api/v1/auth/sessions/:id` |
| POST | `/api/v1/auth/forgot-password` |
| POST | `/api/v1/auth/reset-password` |
| POST | `/api/v1/auth/change-password` |

### calls

| Method | Path |
|---|---|
| GET | `/api/v1/calls/ice-servers` |
| POST | `/api/v1/calls` |
| GET | `/api/v1/calls` |
| DELETE | `/api/v1/calls` |
| GET | `/api/v1/calls/favorites` |
| PUT | `/api/v1/calls/favorites/:id` |
| GET | `/api/v1/calls/scheduled` |
| POST | `/api/v1/calls/scheduled` |
| DELETE | `/api/v1/calls/scheduled/:id` |
| GET | `/api/v1/calls/:id` |
| POST | `/api/v1/calls/:id/answer` |
| POST | `/api/v1/calls/:id/reject` |
| POST | `/api/v1/calls/:id/cancel` |
| POST | `/api/v1/calls/:id/end` |
| DELETE | `/api/v1/calls/:id` |

### callEvents

| Method | Path |
|---|---|
| GET | `/api/v1/call-events` |
| GET | `/api/v1/call-events/link/:meetingId` |
| POST | `/api/v1/call-events` |
| GET | `/api/v1/call-events/:id` |
| PUT | `/api/v1/call-events/:id` |
| DELETE | `/api/v1/call-events/:id` |
| POST | `/api/v1/call-events/:id/guests` |
| DELETE | `/api/v1/call-events/:id/guests/:userId` |
| POST | `/api/v1/call-events/:id/respond` |
| GET | `/api/v1/call-events/:id/participants` |
| POST | `/api/v1/call-events/:id/join` |
| POST | `/api/v1/call-events/:id/leave` |
| POST | `/api/v1/call-events/:id/requests/:userId` |
| POST | `/api/v1/call-events/:id/reminders` |

### chat

| Method | Path |
|---|---|
| GET | `/api/v1/conversations` |
| POST | `/api/v1/conversations` |
| POST | `/api/v1/conversations/direct` |
| PATCH | `/api/v1/conversations/read-all` |
| GET | `/api/v1/conversations/:id` |
| PATCH | `/api/v1/conversations/:id` |
| PATCH | `/api/v1/conversations/:id/lock` |
| DELETE | `/api/v1/conversations/:id` |
| POST | `/api/v1/conversations/:id/clear` |
| GET | `/api/v1/conversations/:id/messages` |
| GET | `/api/v1/conversations/:id/messages/search` |
| GET | `/api/v1/conversations/:id/pinned` |
| GET | `/api/v1/conversations/:id/media` |
| POST | `/api/v1/conversations/:id/messages` |
| POST | `/api/v1/conversations/:id/media` |
| POST | `/api/v1/conversations/:id/read` |
| POST | `/api/v1/conversations/:cid/messages/:mid/reactions` |
| POST | `/api/v1/conversations/:cid/messages/:mid/pin` |
| DELETE | `/api/v1/conversations/:cid/messages/:mid/pin` |
| GET | `/api/v1/conversations/:id/members` |
| PATCH | `/api/v1/conversations/:id/group` |
| POST | `/api/v1/conversations/:id/group/avatar` |
| POST | `/api/v1/conversations/:id/members` |
| DELETE | `/api/v1/conversations/:id/members/:uid` |
| PUT | `/api/v1/conversations/:id/members/:uid/role` |
| POST | `/api/v1/conversations/:id/invite-code/reset` |

### messages

| Method | Path |
|---|---|
| GET | `/api/v1/messages/starred` |
| GET | `/api/v1/messages/search` |
| POST | `/api/v1/messages/:id/reactions` |
| PUT | `/api/v1/messages/:id` |
| DELETE | `/api/v1/messages/:id` |
| POST | `/api/v1/messages/:id/star` |
| DELETE | `/api/v1/messages/:id/star` |
| POST | `/api/v1/messages/:id/forward` |

### groups

| Method | Path |
|---|---|
| POST | `/api/v1/groups/join` |

### couple

| Method | Path |
|---|---|
| GET | `/api/v1/couple` |
| GET | `/api/v1/couple/profile` |
| POST | `/api/v1/couple/invite` |
| POST | `/api/v1/couple/accept` |
| POST | `/api/v1/couple/reject` |
| DELETE | `/api/v1/couple/invite/:id` |
| DELETE | `/api/v1/couple/disconnect` |
| DELETE | `/api/v1/couple` |
| PUT | `/api/v1/couple` |
| POST | `/api/v1/couple/love-note` |
| GET | `/api/v1/couple/journal` |
| POST | `/api/v1/couple/journal` |
| DELETE | `/api/v1/couple/journal/:id` |
| GET | `/api/v1/couple/goals` |
| POST | `/api/v1/couple/goals` |
| PATCH | `/api/v1/couple/goals/:id/toggle` |
| DELETE | `/api/v1/couple/goals/:id` |
| GET | `/api/v1/couple/appointments` |
| POST | `/api/v1/couple/appointments` |
| PUT | `/api/v1/couple/appointments/:id` |
| DELETE | `/api/v1/couple/appointments/:id` |
| GET | `/api/v1/couple/availability` |
| POST | `/api/v1/couple/availability` |
| PUT | `/api/v1/couple/availability/:id` |
| DELETE | `/api/v1/couple/availability/:id` |
| GET | `/api/v1/couple/slots` |
| GET | `/api/v1/couple/location` |
| POST | `/api/v1/couple/location/session` |
| DELETE | `/api/v1/couple/location/session` |
| PUT | `/api/v1/couple/location` |
| POST | `/api/v1/couple/location/request` |
| GET | `/api/v1/couple/calendar` |
| POST | `/api/v1/couple/calendar` |

### misc

| Method | Path |
|---|---|
| GET | `/api/v1/events` |
| POST | `/api/v1/events` |
| PUT | `/api/v1/events/:id` |
| DELETE | `/api/v1/events/:id` |
| GET | `/api/v1/memories` |
| POST | `/api/v1/memories` |
| PATCH | `/api/v1/memories/:id` |
| DELETE | `/api/v1/memories/:id` |
| GET | `/api/v1/places` |
| POST | `/api/v1/places` |
| DELETE | `/api/v1/places/:id` |
| GET | `/api/v1/channels` |
| POST | `/api/v1/channels` |
| POST | `/api/v1/channels/:id/follow` |
| DELETE | `/api/v1/channels/:id/follow` |
| GET | `/api/v1/notifications` |
| GET | `/api/v1/notifications/unread-count` |
| PUT | `/api/v1/notifications/read-all` |
| PUT | `/api/v1/notifications/:id/read` |
| DELETE | `/api/v1/notifications/:id` |
| GET | `/api/v1/timeline/activity` |
| POST | `/api/v1/reports` |

### private

| Method | Path |
|---|---|
| GET | `/api/v1/private/status` |
| POST | `/api/v1/private/setup` |
| POST | `/api/v1/private/unlock` |
| POST | `/api/v1/private/touch` |
| POST | `/api/v1/private/change-pin` |
| POST | `/api/v1/private/recover` |
| PUT | `/api/v1/private/settings` |
| POST | `/api/v1/private/biometric/enable` |
| POST | `/api/v1/private/biometric/disable` |
| POST | `/api/v1/private/lock` |
| POST | `/api/v1/private/remove` |
| GET | `/api/v1/private/chats` |

### stories

| Method | Path |
|---|---|
| GET | `/api/v1/stories` |
| GET | `/api/v1/stories/drafts` |
| POST | `/api/v1/stories/drafts` |
| PUT | `/api/v1/stories/drafts/:id` |
| DELETE | `/api/v1/stories/drafts/:id` |
| POST | `/api/v1/stories` |
| GET | `/api/v1/stories/:id` |
| POST | `/api/v1/stories/:id/view` |
| DELETE | `/api/v1/stories/:id` |
| POST | `/api/v1/stories/:id/react` |
| DELETE | `/api/v1/stories/:id/react` |
| POST | `/api/v1/stories/:id/reply` |
| GET | `/api/v1/stories/:id/viewers` |
| POST | `/api/v1/stories/:id/save` |

### highlights

| Method | Path |
|---|---|
| GET | `/api/v1/highlights/user/:id` |
| POST | `/api/v1/highlights` |
| DELETE | `/api/v1/highlights/:id` |

### streaks

| Method | Path |
|---|---|
| GET | `/api/v1/streaks` |
| GET | `/api/v1/streaks/preferences` |
| PUT | `/api/v1/streaks/preferences` |
| GET | `/api/v1/streaks/:id` |
| GET | `/api/v1/streaks/:id/contribution` |
| GET | `/api/v1/streaks/:id/history` |
| POST | `/api/v1/streaks/:id/activity` |
| POST | `/api/v1/streaks/:id/recover` |

### users

| Method | Path |
|---|---|
| GET | `/api/v1/users/me` |
| PUT | `/api/v1/users/me` |
| PUT | `/api/v1/users/profile` |
| PATCH | `/api/v1/users/me` |
| POST | `/api/v1/users/me/avatar` |
| DELETE | `/api/v1/users/me/avatar` |
| GET | `/api/v1/users/me/settings` |
| PUT | `/api/v1/users/me/settings` |
| POST | `/api/v1/users/me/devices` |
| DELETE | `/api/v1/users/me/devices/:token` |
| DELETE | `/api/v1/users/me` |
| GET | `/api/v1/users/search` |
| GET | `/api/v1/users/:id/profile` |
| GET | `/api/v1/users/:id/posts` |
| GET | `/api/v1/users/:id/followers` |
| GET | `/api/v1/users/:id/following` |
| POST | `/api/v1/users/:id/follow` |
| DELETE | `/api/v1/users/:id/follow` |
| POST | `/api/v1/users/:id/block` |
| DELETE | `/api/v1/users/:id/block` |
| GET | `/api/v1/users/me/blocked` |
| GET | `/api/v1/users/:id` |

### discoverRouter

| Method | Path |
|---|---|
| GET | `/api/v1/discover/people` |

### social

| Method | Path |
|---|---|
| POST | `/api/v1/friends/:id` |
| DELETE | `/api/v1/suggestions/:id` |
| GET | `/api/v1/follow-requests` |
| POST | `/api/v1/follow-requests/:id/accept` |
| DELETE | `/api/v1/follow-requests/:id` |
| POST | `/api/v1/posts` |
| DELETE | `/api/v1/posts/:id` |
| POST | `/api/v1/posts/:id/like` |
| DELETE | `/api/v1/posts/:id/like` |
| POST | `/api/v1/posts/:id/save` |
| DELETE | `/api/v1/posts/:id/save` |
| GET | `/api/v1/posts/:id/comments` |
| POST | `/api/v1/posts/:id/comments` |
