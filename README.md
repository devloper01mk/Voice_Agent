# Voice Sales Agent

Agent Studio + Call Simulator 2.0 with **Gemini Live** voice (LiveKit SIP / Acefone).

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React (Vite) |
| Backend API | Node.js (Express) |
| Database | PostgreSQL (Prisma) |
| Voice worker | LiveKit Agents (`apps/agent-v2`) |
| Voice model | Gemini Live S2S |
| Realtime | LiveKit (+ optional Acefone WSS) |

## Quick start

### 1. Postgres + env

```bash
docker compose up -d
cp .env.example .env
# Set GEMINI_API_KEY, LIVEKIT_*, and keep API_AUTH_TOKEN / VITE_API_AUTH_TOKEN in sync
```

### 2. Install + migrate

```bash
npm install
npm run db:migrate
```

### 3. Run (3 terminals)

```bash
npm run dev:api        # http://localhost:3001
npm run dev:agent-v2   # LiveKit worker (voice-sales-agent-v2)
npm run dev:web        # http://localhost:5174
```

### 4. Use the app

1. Open **Agent Studio** — create agent, Brain, Gemini Live settings, Save  
2. Open **Simulator 2.0** or **Outbound** — start a call (needs LiveKit + agent-v2 + `GEMINI_API_KEY`)

## Auth

When `API_AUTH_TOKEN` is set, `/api/*` and `/stream` require:

- `Authorization: Bearer <token>`, or  
- `X-API-Key: <token>`, or  
- `?token=<token>` (EventSource / Acefone WSS URL)

Acefone provider webhooks (`/api/telephony/webhooks/*`, `/api/telephony/voice/*`) stay public.  
Leave `API_AUTH_TOKEN` empty only for open local experimentation.

## Tests / CI

```bash
npm test          # shared + api unit tests
npm run typecheck # tsc across workspaces
```

## Docs

| Doc | Contents |
|-----|----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview (may lag Gemini-only cleanup) |
| [docs/BACKEND.md](docs/BACKEND.md) | Express API / Prisma |
| [docs/FRONTEND.md](docs/FRONTEND.md) | React Studio & Simulator |
| [docs/TELEPHONY-OUTBOUND.md](docs/TELEPHONY-OUTBOUND.md) | Outbound phone |

## Project structure

```
apps/
  api/       Express + Prisma + Acefone Gemini Live telephony
  agent-v2/  LiveKit Gemini Live worker
  web/       React UI (Studio, Simulator 2.0, Outbound)
packages/
  shared/    Prompts, booking/phone helpers, Gemini Live config
```
