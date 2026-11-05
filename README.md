# Send ME/U — Frontend

React + Vite mobile-first frontend for Send ME/U (chat, stories, couple space, calendar, memories).

## Setup

```bash
npm install
cp .env.example .env     # already present in this folder
npm run dev              # http://localhost:5173
npm run build && npm run preview
```

`.env`:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | REST API base, e.g. `http://localhost:5000/api/v1` |
| `VITE_SOCKET_URL` | Socket.IO server, e.g. `http://localhost:5000` |
| `VITE_USE_MOCK` | `true` = run entirely on built-in demo data (no backend needed). Any password except `wrong` logs in. Set to `false` to talk to your API. |

No secrets live in the frontend; only the two public URLs above.

## Stack

React 18, Vite, React Router, plain CSS with design tokens (`src/styles.css`), lucide-react, axios, socket.io-client, react-hook-form + zod, zustand.

## Structure

```
src/
  App.jsx               routes, protected routes, token-expiry handling
  styles.css            tokens (colors, gradients, radii, shadows) + component styles
  components/ui.jsx     Button, TextField, Avatar, Chip, Badge, Modal, Toast, Skeleton, Empty/Error states, AppHeader, BottomNav, hooks
  services/api.js       axios client, auth interceptor, 401 -> logout, every endpoint (+ demo fallback)
  services/socket.js    Socket.IO client
  store/index.js        auth (session persistence) and UI (theme, toast, settings) stores
  data/                 demo data and generated SVG art
  screens/              Splash, Onboarding, Auth, Home, Chat, Discover, Stories, Couple, Calendar, Memories, Profile
public/logo.png         full logo (transparent PNG)
public/logo-full.png    original supplied logo
public/logo-icon.png    bubble + paper-plane mark only (used with the live-text wordmark in <Logo/>)
public/favicon.png      tab icon
```

## Screens and routes

| Design screen | Route |
| --- | --- |
| Splash | `/` |
| Onboarding (Your Private World, Made for Couples, Stories & Memories) | `/onboarding` |
| Login (neon) / Create Your Account | `/login`, `/signup` (+ `/forgot-password`, `/reset-password`) |
| Chats list (Private Space shortcut, filters) | `/home` |
| Chat room | `/chats/:id` (+ `/chats/new`, `/notifications`) |
| Daily (My Story, story cards, Channels) | `/daily`, `/stories`, `/stories/new` |
| Timeline (People you know, Recent Activity) | `/timeline` (+ `/discover`) |
| Calls (Call, Schedule, Keypad, Favorites, Recent) | `/calls` |
| Profile (Name, About, Reserved Username, Phone, Links) | `/profile`, `/profile/edit`, `/settings/:privacy\|chat\|help` |
| Private Space | `/private` |
| Locked Chats / Calendar / Couple Calendar / Location Saved | `/private/locked`, `/calendar`, `/couple`, `/private/locations` |
| Couple Space (monthly calendar, shared availability) / Live Location | `/private/couple`, `/private/couple/location` |
| Memories (from Profile) | `/memories` |

Bottom navigation: Chats · Daily · Timeline · Calls · Profile. Visual tokens for the glass/aurora look live in `src/design.css`; artwork cropped from the supplied designs is in `public/assets/`.

## Backend contract (what the frontend calls)

REST under `VITE_API_BASE_URL`, `Authorization: Bearer <token>`; a 401 clears the session and returns to login.

- Auth: `POST /auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password` → `{ token, user }`
- Users: `GET/PUT /users/me`, `POST /users/me/avatar` (multipart `avatar`), `POST /users/:id/follow`, `POST /friends/:id`
- Chats: `GET/POST /conversations`, `GET /conversations/:id`, `GET/POST /conversations/:id/messages` (`?page&limit`, returns `{ items, hasMore }`), `POST /conversations/:id/media` (multipart `file`, `type`), `POST .../messages/:mid/reactions`
- Discover: `GET /discover/people?interest&q`
- Stories: `GET/POST /stories` (multipart `media`), `POST /stories/:id/react`, `/reply`
- Couple: `GET /couple`, `POST /couple/invite`, journal and goals CRUD under `/couple/journal`, `/couple/goals`
- Events: `GET/POST /events`, `PUT/DELETE /events/:id`
- Memories: `GET/POST /memories` (multipart `file`, `album`; filters `type`, `album`, `q`), `DELETE /memories/:id`
- Couple calendar, availability, live location: see `docs/COUPLE_SCHEDULE.md`
- `GET /notifications`
- Daily: `GET /channels`; Timeline: `GET /timeline/activity`; Calls: `GET/POST/DELETE /calls`; Private Space: `PATCH /conversations/:id/lock`, `GET/POST /places`, `DELETE /places/:id`

Socket.IO (token in `auth`): client emits `conversation:join|leave`, `typing:start|stop`; server emits `message:new`, `message:status {id,status}`, `typing {conversationId,on}`, `message:reaction {messageId,emoji}`.

## Notes

- Layout is mobile-first (430px column); on tablet/desktop it renders inside a centered device frame.
- Google/Apple/phone sign-in buttons show a "not configured" notice until you add providers.
- Voice messages use the browser MediaRecorder API (needs HTTPS or localhost).

## Full screen on phones (Android + iOS)

- On touch devices the app fills the whole screen (no phone frame). The framed look only shows on desktop with a mouse.
- Installable: open the site, then **Android Chrome** → ⋮ → *Install app*; **iPhone Safari** → Share → *Add to Home Screen*. It then opens with no browser bars (`public/manifest.webmanifest`, `public/sw.js`, icons in `public/`).
- To also hide the Android status bar, set `"display": "fullscreen"` in the manifest.
