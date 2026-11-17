# Send ME/U

Two independent projects, one repository.

```
send-me-u/
├── frontend/   Mobile app UI: React + Vite, installable PWA, Android/iOS via Capacitor   → see frontend/README.md
├── backend/    API: Express + Socket.IO + Prisma/PostgreSQL + Redis (+ admin/ dashboard)  → see backend/README.md
├── docs/       API, ER diagram, security, deployment, feature notes
├── Dockerfile / docker-compose.yml   optional: builds both into one image (+ Postgres, Redis)
```

Each folder has its own `package.json`, `.env.example` and README, and can be run, tested and deployed on its own.

## Run

```bash
# backend                              # frontend
cd backend                             cd frontend
cp .env.example .env                   cp .env.example .env     # VITE_USE_MOCK=false to use the API
npm ci && npx prisma migrate deploy    npm install
npm run seed && npm run dev            npm run dev              # http://localhost:5173
```

The frontend runs on built-in demo data (`VITE_USE_MOCK=true`) when no backend is available.

**Everything in Docker:** `cp backend/.env.example backend/.env` (set the secrets) then `docker compose up --build`. The backend serves the built frontend, so the app is at http://localhost:5000 and the admin dashboard at `/admin`.

**Android / iOS:** in `frontend/`, set `VITE_API_BASE_URL` / `VITE_SOCKET_URL` to your https API, then `npx cap add android` (or `ios`) once and `npm run mobile:sync`. `https://localhost` and `capacitor://localhost` are already allowed in the backend's `CORS_ORIGINS` example.
