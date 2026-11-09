# Profiles, privacy and posts

Timeline → card / menu → `/people/:id` (`src/screens/PersonProfile.jsx`).

## Frontend
| File | Role |
| --- | --- |
| `src/screens/PersonProfile.jsx` | Instagram-style profile: header, stats, actions, Posts / Reels / Tagged tabs, private + blocked states |
| `src/profile/ProfileParts.jsx` | Followers/Following sheet, post grid, post / video viewer (like, comment, share, save) |
| `src/profile/relations.js` | Pure rules (who can see what, follow button state, tab selection). Tested in `tests/relations.test.js` |
| `src/profile/actions.js` | Block / unblock (also blocks the direct chat), share links, safe website links |

## Backend (`backend/src/people/routes.js`, migration `004_profiles_posts.sql` after `003`)
| Route | |
| --- | --- |
| `GET /users/:id/profile` | profile + counts + relationship (`isFollowing`, `requested`, `isPrivate`). A user I blocked returns identity only (`blocked: true`) |
| `GET /users/:id/posts?tab=posts\|reels\|tagged&limit&offset` | `{ locked, items }`; private accounts are locked until a follow is accepted |
| `GET /users/:id/followers`, `/following` | 403 for private accounts the viewer does not follow |
| `POST/DELETE /users/:id/follow` | private account → creates a request (`requested: true`); DELETE also cancels a request |
| `GET /follow-requests`, `POST /follow-requests/:id/accept`, `DELETE /follow-requests/:id` | incoming requests |
| `POST/DELETE /users/:id/block` | block (severs follows and requests both ways) / unblock |
| `DELETE /suggestions/:id` | remove from People you know |
| `POST/DELETE /posts/:id/like`, `/save`; `GET/POST /posts/:id/comments` | interactions, each checked against post visibility |

Every query takes the viewer from the verified token, never from the URL or body. Duplicates are prevented by primary keys.

## Demo mode (`VITE_USE_MOCK` on)
Same behaviour in `src/services/api.js`, with generated posts (`buildPosts` in `src/data/mock.js`). Anu is private and not followed (locked); Muthu is private and followed (visible). Followers/following lists come from a small demo graph, so they list fewer people than the headline counts.
