# Voice Sales Agent

Voice sales agent with **Agent Studio** + **Call Simulator**.

## Documentation

How the system works (explanations + flow diagrams):

| Doc | Contents |
|-----|----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview, stack, end-to-end call flow |
| [docs/BACKEND.md](docs/BACKEND.md) | Express API, Prisma models, LiveKit voice worker |
| [docs/FRONTEND.md](docs/FRONTEND.md) | React Studio & Simulator, API client map |

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React (Vite) |
| Backend API | Node.js (Express) |
| Database | PostgreSQL (Prisma) |
| Voice worker | LiveKit Agents (Node.js) |
| STT | Azure Speech |
| LLM | Groq **or** OpenAI GPT (per agent) |
| TTS | Cartesia |
| Realtime | LiveKit |

## Quick start

### 1. PostgreSQL

```bash
docker compose up -d
cp .env.example .env
# Edit .env with your API keys
```

### 2. Install dependencies

```bash
npm install
```

### 3. Database migrate

```bash
npm run db:push
```

### 4. Run services (3 terminals)

```bash
npm run dev:api      # http://localhost:3001
npm run dev:agent    # LiveKit agent worker
npm run dev:web      # http://localhost:5173
```

### 5. Use the app

1. Open **Agent Studio** — create agent, set Brain, pick Groq or GPT, Save
2. Preview Cartesia voice (needs `CARTESIA_API_KEY` on API)
3. Open **Call Simulator** — Start call (needs LiveKit + agent worker + Azure STT)

## Environment variables

See [.env.example](.env.example).

| Variable | Used by |
|----------|---------|
| `DATABASE_URL` | API |
| `LIVEKIT_*` | API (tokens), Agent |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Agent (STT) |
| `GROQ_API_KEY` | Agent (when agent uses Groq) |
| `OPENAI_API_KEY` | Agent (when agent uses GPT) |
| `CARTESIA_API_KEY` | API (preview), Agent (TTS) |
| `API_URL` | Agent (load agent config) |

## Project structure

```
apps/
  api/     Express + Prisma + LiveKit token API
  agent/   LiveKit voice worker (Azure STT → LLM → Cartesia)
  web/     React UI
packages/
  shared/  Prompt compiler (Brain + Skills → system prompt)
```

## Brain + Skills

On **Save**, Brain markdown and default sales skills are compiled into `compiled_system_prompt` in PostgreSQL. The agent worker loads it once per call.

## LLM provider

Set per agent in Studio:

- **Groq** — `openai.LLM.withGroq()` (fast, needs `GROQ_API_KEY`)
- **GPT** — `openai.LLM()` (needs `OPENAI_API_KEY`)
