# Backend Worker + Neon Postgres Setup

This project now uses a **persistent backend engine** (`/backend`) for continuous 1-minute evaluation and trading logic. The frontend can stay on Vercel, but the worker must run on a persistent host (Railway/Fly/VM/Docker).

## Why Vercel is not suitable for the worker
Vercel API routes are serverless and short-lived. A trading loop requires a continuously running process for:
- 60s heartbeat evaluations
- TP/SL monitoring for open paper positions
- durable decision + trade writes to Postgres

Use Vercel only for UI hosting.

## 1) Create Neon account and project (free tier)
1. Go to https://neon.tech and sign up.
2. Create a new project.
3. Create (or use default) database.
4. Create a database role/user.
5. Copy the Neon connection string (pooled or direct).

## 2) Configure environment
Create a local `.env` (or `.env.local`) and set:

```bash
DATABASE_URL=postgresql://<user>:<pass>@<host>/<db>?sslmode=require
BACKEND_PORT=8787
CORS_ORIGIN=http://localhost:5173
ENGINE_MODE=PAPER
AUTO_PAPER=true
CONFIDENCE_THRESHOLD=0.6
ENGINE_SYMBOL=ETHUSDC
VITE_BACKEND_URL=http://localhost:8787
```

## 3) Install and generate Prisma client
```bash
npm install
npx prisma generate
```

## 4) Run migrations
```bash
npx prisma migrate dev
```

## 5) Start backend locally (persistent worker)
```bash
npm run backend:dev
```

Backend endpoints:
- `GET /api/status`
- `GET /api/trades?limit=100`
- `GET /api/decisions?limit=200`
- `POST /api/force-trade`
- `POST /api/settings`

## 6) Start frontend locally (pointing to backend)
```bash
npm run dev
```

Ensure `VITE_BACKEND_URL` points to your backend worker URL.

## 7) Deployment options for backend worker

### Railway (recommended)
1. Push repo to GitHub.
2. Create Railway project from repo.
3. Add env vars from `.env.example` backend section.
4. Set start command:
```bash
npm run backend:start
```

### Fly.io
1. Install Fly CLI and login.
2. Launch app from repo root:
```bash
fly launch
```
3. Set env vars:
```bash
fly secrets set DATABASE_URL=... BACKEND_PORT=8787 CORS_ORIGIN=https://your-ui.vercel.app ENGINE_MODE=PAPER AUTO_PAPER=true CONFIDENCE_THRESHOLD=0.6 ENGINE_SYMBOL=ETHUSDC
```
4. Deploy:
```bash
fly deploy
```

### Oracle Cloud VM + Docker (best persistence/control)
Use `Dockerfile.backend` + `docker-compose.backend.yml` and run:
```bash
docker compose -f docker-compose.backend.yml up -d --build
```

---

## Local run commands summary
```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run backend:dev
npm run dev
```

## Verification runbook checklist
1. **Backend heartbeat**: `GET /api/status` shows `lastHeartbeatTs` changing every minute.
2. **Decisions every minute**: `GET /api/decisions` includes `HOLD` when no signal.
3. **Force trade**: `POST /api/force-trade` opens a paper trade instantly.
4. **TP/SL auto-close**: open trade closes when price hits TP or SL and records pnl.
5. **UI trade history**: dashboard displays DB-backed trade rows from backend API.
