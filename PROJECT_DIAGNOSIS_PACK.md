# PROJECT DIAGNOSIS PACK — Voice Sales Agent (Phone + Hotel Booking)

**Generated:** 2026-09-19  
**Repo:** `/Users/manish/AI`  
**Scope:** Inspect-only. No code was changed except this file.  
**Audience:** Another engineer / ChatGPT. Share this file as the project map + issue diagnosis.

**Rules used in this report**

- Facts come from application source, env *key names*, running terminals, and docs.  
- If something is not in those places: **unclear**, with the exact file/log/env needed.  
- Secrets are not printed. Phones, tokens, keys, and sensitive URLs are masked.

---

## 0. Executive diagnosis (read this first)

There are **two separate production problems**. They do not share a root cause.

| # | Symptom | Where it happens | Root class | App-code vs infra |
|---|---------|------------------|------------|-------------------|
| 1 | LiveKit SIP outbound creates a SIP participant but the customer phone does **not ring** | `/outbound` + `transport=livekit_sip` | SIP/TLS media path from LiveKit Cloud → Tata SBC timed out | **Mostly infra / trunk**. App successfully created the LiveKit SIP participant. The PSTN INVITE/media never completed. |
| 2 | Hotel/hostel booking conversation is unreliable | **Today’s evidence is Simulator 2.0** (`telephony: false`, Gemini Live), same worker as LiveKit SIP | Prompt + tools + missing hard gates. Gemini speaks and books before tools succeed. | **App + model**. Proven in agent-v2 logs from this session. |

A third older bug — **agent-v2 started the session while `sip.callStatus` was still `dialing`** — is **already patched in current `apps/agent-v2/src/main.ts`**. Current code waits for `sip.callStatus === "active"` only. It does **not** treat audio tracks as answered. Docs still mention the old audio-track shortcut.

**Do not mix transports when debugging rings.** Acefone Click-to-Call Support and LiveKit SIP are independent. Acefone ringing does not prove LiveKit SIP works. LiveKit trunk settings do not affect Acefone.

---

## 1. What has been built

### 1.1 Product

A **voice sales / booking agent** monorepo:

| Surface | Route | What it is |
|---------|-------|------------|
| Agent Studio | `/` | Create/edit agents: identity, Cartesia voice, Brain markdown, Skills, booking policy, LLM, STT, Gemini/OpenAI S2S settings, learnings |
| Call Simulator (classic) | `/simulator` | Browser LiveKit room → **legacy** worker `voice-sales-agent` (`apps/agent`) |
| Simulator 2.0 | `/simulator2` | Browser LiveKit room → **agent-v2** `voice-sales-agent-v2` (same worker as LiveKit SIP phone) |
| Outbound Call | `/outbound` | Real PSTN outbound: **Acefone/Smartflo** (default when keys exist) **or** **LiveKit SIP** |
| Leads & Calendar | `/leads` | Saved leads / callbacks / calendar |
| Active leads | `/active-leads` | Lead list / autodial into `/outbound` |

There is **no login**. REST is open on localhost; CORS only. LiveKit JWTs protect room join.

### 1.2 Monorepo

```
apps/
  web/          React 19 + Vite 6  (dev: http://localhost:5174 today)
  api/          Express + Prisma SQLite + telephony + Simulator 2.0 tokens
  agent/        Legacy LiveKit worker  agentName: voice-sales-agent
  agent-v2/     Current LiveKit worker agentName: voice-sales-agent-v2
packages/
  shared/       Prompt compiler, booking policy, Nexora hotel facts, turn notes, phone validation
```

**Processes that actually matter today**

```bash
npm run dev:api        # :3001  Express + Acefone WSS /stream
npm run dev:web        # :5174  Vite (proxy /api → :3001)
npm run dev:agent-v2   # LiveKit worker voice-sales-agent-v2
# npm run dev:agent    # only for classic /simulator
```

### 1.3 Stack that exists in code (not “assumed configured”)

| Layer | Implementation |
|-------|----------------|
| Frontend | `apps/web` React 19, Vite 6, `livekit-client` |
| API | `apps/api` Express, Prisma → **SQLite** (`file:./dev.db`) |
| Classic voice | `apps/agent` LiveKit Agents 1.5.0, Azure/OpenAI/Sarvam/Google STT → Groq/GPT → Cartesia |
| Current voice | `apps/agent-v2` same Agents 1.5.0; pipelines: cascaded **or** OpenAI Realtime **or** Gemini Live |
| Real-time rooms | LiveKit Cloud (`LIVEKIT_URL`) |
| SIP outbound | LiveKit `SipClient.createSipParticipant` + `LIVEKIT_SIP_OUTBOUND_TRUNK` |
| Tata telephony | Smartflo **Click-to-Call Support** HTTP + Voice Bot WSS (Acefone path only) |
| STT | Azure Speech (default), OpenAI, Sarvam, Google Chirp |
| LLM cascaded | Groq or OpenAI GPT (per agent in Studio) |
| TTS cascaded | Cartesia |
| S2S | Gemini Live (`@livekit/agents-plugin-google`) and OpenAI Realtime |
| Hotel inventory | Nexora `facts/query` (`NEXORA_FACTS_QUERY_URL` + `NEXORA_INGEST_TOKEN`) |
| Calendar | Optional Google Calendar; in-app availability rules |

### 1.4 What is implemented vs not

**Implemented**

- Agent Studio + compiled system prompt on save  
- Simulator (v1) and Simulator 2.0  
- Outbound UI with transport selector Acefone vs LiveKit SIP  
- Acefone Click-to-Call Support + Dynamic endpoint + WSS `/stream` + in-API `TelephonyCallSession`  
- LiveKit SIP: createRoom → dispatch `voice-sales-agent-v2` → `createSipParticipant`  
- agent-v2 wait-for-SIP-answer (`sip.callStatus === active` only)  
- Named outbound logs: `OUTBOUND_CALL_REQUEST`, `LIVEKIT_SIP_*`, `AGENT_V2_*`, `CUSTOMER_ANSWERED`  
- Nexora `lookup_hotel_availability` + stay inventory re-check on `capture_demo_lead`  
- Booking policy templates (`hotel_stay` includes `party_size` + payment discuss **in the prompt**)  
- Lead capture, callbacks, post-call brain mutation / learnings  
- Call-completed webhook to Nexora ingest  

**Not implemented**

- LiveKit **inbound** SIP  
- LiveKit SIP Dispatch Rule management in code  
- Tata plain `/v1/click_to_call` (non-Support)  
- A real booking state machine (dates, guests, payment, booking ID) — policy is prompt + a few tool flags  
- `party_size` as a **tool parameter or DB column**  
- Persistent payment / booking-ID fields on `Lead`  
- Meals, pin code, distance-to-landmark in Nexora `select`  
- Orphan reconciler for `source: livekit-sip` (reconciler only targets Acefone `click-to-call`)  
- Bridging agent-v2 telemetry into telephony SSE the way Acefone `call-session` does  

### 1.5 Docs vs code (stale)

| Doc | Problem |
|-----|---------|
| `README.md`, `docs/ARCHITECTURE.md`, `docs/BACKEND.md`, `docs/FRONTEND.md` | Describe Studio + classic Simulator only. Omit agent-v2, Simulator 2.0, Outbound, Acefone, Nexora. |
| `docs/TELEPHONY-OUTBOUND.md` | Mostly accurate. Still says agent waits for `sip.callStatus=active` **or SIP audio track**. Current code **does not** use audio tracks. |
| `HANDOFF_REPORT.md` (2026-09-16) | Useful history. **Out of date** on logs: named `LIVEKIT_SIP_*` / `CUSTOMER_ANSWERED` logs **are now in code**. `playDialtone` default is now **false**, not true. |

---

## 2. What architecture is actually running

### 2.1 Observed this session (2026-09-19 ~17:57–18:12 IST)

| Process | Terminal | Status |
|---------|----------|--------|
| Vite web | pid 60958, `npm run dev:web` | **Running** — `http://localhost:5174/` |
| API | pid 60974, `npm run dev:api` | **Running** — `http://localhost:3001`, WSS `/stream` |
| agent-v2 | pid 64510, `npm run dev:agent-v2` | **Running** — registered `voice-sales-agent-v2` |
| Classic `dev:agent` | — | **Not running** |
| LiveKit SIP outbound | API logs | **Not attempted this session** (no `OUTBOUND_CALL_REQUEST` / `LIVEKIT_SIP_*` in current API terminal) |
| Simulator 2.0 | agent-v2 logs | **Two Gemini Live rooms**, `telephony: false` |

Boot warnings from agent-v2:

- Nexora facts **configured** (`nexoracompany.tech` host; token present).  
- **Azure Speech key rejected (401)** for `centralindia`. Cascaded agents cannot hear. Gemini Live / OpenAI Realtime do not need Azure.  
- Sarvam API key present.

API side effects this session:

- `call.completed` webhook to a **LAN Nexora ingest URL** failed (`fetch failed`). This is a different project id than the facts/query URL. Webhook failure does not block the voice loop.

### 2.2 Three runtime paths (do not collapse these)

```
                    ┌─────────────────────────────────────────┐
                    │  Agent Studio (Postgres/SQLite Agent)   │
                    │  compiledSystemPrompt + skillsConfig    │
                    └─────────────────────────────────────────┘
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          ▼                            ▼                            ▼
   Classic Simulator            Simulator 2.0                 Outbound Call
   POST /api/livekit/token      POST /api/simulator2/.../token
   room: call-{agentId}-…       room: call-v2-{agentId}-…
   dispatch: voice-sales-agent  dispatch: voice-sales-agent-v2
   apps/agent                   apps/agent-v2
                                                               │
                                         ┌─────────────────────┴─────────────────────┐
                                         ▼                                           ▼
                              transport=acefone                           transport=livekit_sip
                              Tata Click-to-Call Support                 createRoom + dispatch v2
                              Voice Bot WSS → /stream                    createSipParticipant
                              TelephonyCallSession (in API)              LiveKit SIP trunk → PSTN
                              NOT LiveKit SIP                            agent-v2 waitForSipAnswered
```

### 2.3 Env that is present (keys only)

**Root `.env` has:** `DATABASE_URL`, `API_*`, `LIVEKIT_URL/KEY/SECRET`, Azure, Sarvam, OpenAI, Gemini, Groq, Cartesia, latency, Acefone/Smartflo, `NEXORA_*`, call-completed webhook.

**`apps/api/.env` additionally has:** `LIVEKIT_SIP_OUTBOUND_TRUNK`, `LIVEKIT_SIP_FROM_NUMBER`, `TELEPHONY_STT`.

**`apps/agent-v2/.env` has:** `API_URL` only. Worker then loads root `.env` then **overrides from `apps/api/.env`**.

**Missing from root `.env` (present only on API):** `LIVEKIT_SIP_OUTBOUND_TRUNK`. That is OK for SIP **dial** (API does it). Agent-v2 does not create SIP participants.

**Unclear without LiveKit Cloud UI:** trunk provider (Telnyx vs Twilio vs Tata SIP), trunk auth, allowed caller IDs, whether the trunk is actually mapped to Indian PSTN.

---

## 3. What flow is expected

### 3.1 LiveKit SIP outbound (intended)

1. User opens `/outbound`, selects **LiveKit SIP → agent-v2**, enters E.164 / 10-digit India number, Place call.  
2. UI `POST /api/telephony/outbound-call` with `transport: "livekit_sip"`.  
3. API creates Prisma `Call` (`provider=livekit_sip`, `source=livekit-sip`, `roomName=call-v2-…`).  
4. `placeLivekitSipOutbound`:
   1. `RoomServiceClient.createRoom`
   2. `AgentDispatchClient.createDispatch(room, "voice-sales-agent-v2")`
   3. `SipClient.createSipParticipant(LIVEKIT_SIP_OUTBOUND_TRUNK, +91…, room, { waitUntilAnswered: false by default, playDialtone: false, krispEnabled: false, ringingTimeout: 45, timeout: 20 })`
5. HTTP returns `status: ringing`. Background poll logs `sip.callStatus` every 2s for 60s.  
6. Customer handset **rings**.  
7. On answer, LiveKit sets SIP participant attr `sip.callStatus=active`.  
8. agent-v2: `AGENT_V2_WAITING_FOR_SIP_ANSWER` → wait → `CUSTOMER_ANSWERED` → `AGENT_SESSION_STARTING` → opener.  
9. Same Gemini Live / Realtime / cascaded stack as Simulator 2.0.  
10. Hangup deletes the LiveKit room.

### 3.2 Acefone outbound (intended)

1. UI `transport: "acefone"` (this is the **code default** when Acefone keys exist).  
2. API `initiateClickToCallSupport` → Tata `POST /v1/click_to_call_support`.  
3. Tata dials customer. On Voice Bot connect: `POST /api/telephony/voice/endpoint` returns `wss_url`.  
4. Acefone opens WSS to API `/stream`.  
5. `TelephonyCallSession` runs cascaded or in-API Gemini/OpenAI S2S. **Half-duplex** + local barge.  
6. **Not** LiveKit SIP. Trunk settings in LiveKit Cloud are irrelevant.

### 3.3 Hotel / hostel booking conversation (intended)

Booking policy template `hotel_stay` (`packages/shared/src/booking-policy.ts`):

- Outcome: `stay`  
- Required **in the prompt**: preferred_time, **party_size**, name, phone  
- Must discuss before save: **payment / advance**  
- Never announce confirmed until `capture_demo_lead` returns `ok: true`  
- Live inventory: `lookup_hotel_availability` for every named city; speak only from tool JSON  
- Before save, pass `city` + `room_name`; server re-checks Nexora  

Intended turn order for a stay:

1. Answer the latest user question (location, meals, price) from **live lookup + Product Knowledge**, without booking.  
2. If city named → `lookup_hotel_availability`.  
3. Collect guests, dates, room, name, 10-digit phone with read-back.  
4. Discuss payment/advance from Product Knowledge, get ack.  
5. `capture_demo_lead` with `name_confirmed`, `phone_confirmed`, `payment_discussed`, city, room.  
6. Only if `ok: true`, say stay booking confirmed. There is **no booking-ID generator**.

### 3.4 SIP answer gate (intended, current code)

`apps/agent-v2/src/main.ts`:

- Non-SIP participant (browser Simulator): start immediately.  
- SIP: wait until `sip.callStatus === "active"`.  
- `dialing` / `ringing` / empty → keep waiting up to 60s.  
- `hangup` / `disconnected` / `error` / `failed` / timeout → patch call `no-answer` or `failed`, **delete room**, **do not** start `AgentSession`.

---

## 4. What flow is currently happening

### 4.1 LiveKit SIP “participant created, phone silent”

**Not reproduced in today’s terminals.** Current API log has webhook failures only. No `OUTBOUND_CALL_REQUEST`.

What the **code will do** if the user selects LiveKit SIP:

1. SIP participant is created in LiveKit’s control plane (`LIVEKIT_SIP_PARTICIPANT_CREATED`, status `dialing` when `waitUntilAnswered=false`).  
2. API marks Prisma call `ringing` and returns success to the UI.  
3. Customer handset does not ring if LiveKit’s SIP/TLS hop to the Tata SBC times out (user-reported LiveKit Call Detail).  
4. `sip.callStatus` likely stays `dialing` / never becomes `active`.  
5. Current agent-v2 should **not** greet; after 60s it should log `AGENT_V2_SIP_ANSWER_TIMEOUT`, patch `no-answer`, delete room.

**User-reported LiveKit Call Detail (not in app logs):**

```
transport<TLS> dial err=dial tcp <nil>->14.97.48.21:49869: connect: connection timed out
```

Interpretation from that string alone (no extra guessing about portal config):

| Piece | Meaning |
|-------|---------|
| `transport<TLS>` | LiveKit SIP stack is trying a **TLS TCP** connection, not the Node app. |
| `dial tcp <nil>->14.97.48.21:49869` | Destination is `14.97.48.21:49869`. Source address recorded as `<nil>` (no local bind / no chosen source IP). |
| `14.97.48.21` | Public IPv4 in **Indian Tata Teleservices** space (typical Tata SBC / media). |
| `:49869` | **Not** SIP 5060/5061. Ephemeral / media / Contact port advertised by the far end. |
| `connection timed out` | LiveKit Cloud **never completed TCP** to that host:port. PSTN ring cannot start if INVITE/media never lands. |

This is **after** `createSipParticipant` succeeded (LiveKit already has a SIP participant object). The failure is on the **SIP/media path**, not the REST route.

**Unclear without LiveKit Cloud SIP trunk JSON + Tata SBC ACL:**

- Whether the outbound trunk is pointed at Tata SIP vs Telnyx/Twilio.  
- Whether `49869` is a NAT-mapped media port LiveKit cannot reach.  
- Whether LiveKit Cloud IPs are allow-listed on Tata.  
- Whether `LIVEKIT_SIP_FROM_NUMBER` is an authorized CLI on that trunk.

**Files/logs needed to confirm a future SIP attempt**

- API stdout: `OUTBOUND_CALL_REQUEST`, `LIVEKIT_SIP_PARTICIPANT_CREATE_REQUEST`, `LIVEKIT_SIP_PARTICIPANT_CREATED`, `LIVEKIT_SIP_PARTICIPANT_POLL`, `LIVEKIT_SIP_CALL_FAILED`  
- agent-v2 stdout: `AGENT_V2_JOB_RECEIVED`, `AGENT_V2_WAITING_FOR_SIP_ANSWER`, `AGENT_V2_SIP_STATUS_POLL`, `CUSTOMER_ANSWERED` or `AGENT_V2_SIP_ANSWER_TIMEOUT`  
- LiveKit Cloud → Calls → that room’s SIP trace (the TLS dial line)  
- Tata/Smartflo CDR for the same timestamp (if the trunk terminates on Tata)  
- Env (values not needed here): `LIVEKIT_SIP_OUTBOUND_TRUNK` is set on `apps/api/.env`

### 4.2 Agent starting while still dialing (historical vs now)

**Then (handoff / user report):** wait treated SIP audio track / early media as answered → `AGENT_SESSION_STARTING` during `dialing`.

**Now (source of truth: `apps/agent-v2/src/main.ts`):**

```ts
/** Only sip.callStatus === "active" means the customer answered. Never use audio tracks. */
```

`waitForSipAnswered` polls attributes every 1.5s. Audio tracks are not a shortcut.

**Docs still wrong:** `docs/TELEPHONY-OUTBOUND.md` line about “or SIP audio track”.

**Unclear:** no current-session log of a SIP job, so we cannot prove the patch on a live PSTN call. We can prove the code path.

### 4.3 Hotel booking conversation — what actually happened today

Two Simulator 2.0 sessions, both Gemini Live, **not telephony**:

| Call | roomName prefix | callId (internal) | telephony |
|------|-----------------|-------------------|-----------|
| 1 | `call-v2-0c52516d-…-1789821153105` | `f5bdc4d7-…` | `false` |
| 2 | `call-v2-0c52516d-…-1789821489269` | `3d953ca4-…` | `false` |

Call 2 is the booking conversation. User STT (Gemini input transcription, unmasked content paraphrased where it contains a number):

1. Wants to travel to Agra / Taj Mahal / nearby; ask for Moustache hotels.  
2. Agent called `lookup_hotel_availability` city=`Agra` → **ok:true**, hotel **Moustache Agra**, 4 room rows, policies only `check_in` / `check_out`, `forceSpoken: true`, ~408ms.  
3. User: mixed dorm, female and male can stay.  
4. User: first week of October, four bedroom sufficient.  
5. User: **where is it, how far from Taj?**  
6. User: **exact location, area name, pin code?**  
7. User: **how much money, what options, breakfast/lunch/dinner?**  
8. User: **finalize booking, 1 Oct–4 Oct, 4 nights.**  
9. Agent called `capture_demo_lead` **three times**, all `ok: false`.  
10. User started speaking a mobile number in fragments.  
11. Agent called `end_call` while the number was still incomplete.

There is **no** `payment_discussed: true` on any capture. There is **no** `party_size` argument (the tool does not have that field). There is **no** booking ID. Lead POST never succeeded in these logs (`ok:false` before HTTP).

---

## 5. What is going wrong

### 5.1 SIP: participant exists, phone silent

**Primary:** LiveKit Cloud cannot complete TLS TCP to `14.97.48.21:49869`. That is outside `apps/api` HTTP. Fixing Node timeouts will not make Tata ring if the SBC is unreachable.

**Contributing app/ops issues (can confuse debugging):**

1. **Two transports.** UI defaults to Acefone when Acefone keys exist (`GET /api/telephony/transports` → `defaultTransport: acefone`). A user can configure a LiveKit trunk and still dial Acefone, or the reverse.  
2. **Fast `createSipParticipant`.** `waitUntilAnswered: false` (default) returns HTTP success at `dialing`. UI shows “Ringing…” even if the PSTN INVITE later times out.  
3. **No SIP orphan reconciler.** `reconcileAbandonedTelephonyCalls` in `apps/api/src/index.ts` only queries `source: 'click-to-call'`. A stuck LiveKit SIP call can sit `ringing` in DB.  
4. **Azure STT 401** is unrelated to ringing, but will kill cascaded phone audio if that pipeline is used after answer.

**Not the cause of no-ring (current code):** agent greeting before answer — gated on `active`.

### 5.2 Booking conversation — proven failures

Mapped to the user’s list:

| User complaint | Evidence | Mechanism |
|----------------|----------|-----------|
| Did not answer latest question properly | After Taj-distance / pin-code / meals questions, model still pushed toward booking; Nexora payload had no meals, pin, distance | Tool `select` is room/price/check-in only. Product Knowledge is truncated. Gemini does not have a “answer this question first” hard gate. |
| Pushed booking too early | User had to say “finalize booking”; model had already been in sales close; then capture with `name: Unknown` | Prompt says collect fields first; Gemini Live ignores it. No server-side “don’t capture until gates” except when the tool is actually called. |
| Assumed availability | `lookup_hotel_availability` **did** return live rooms for Agra (`ok: true`, 4 rooms). Assuming “4 Bed Mixed Dorm” from “mixed dorm” + “four bedroom” is a **model mapping**, not a second live check until capture | Inventory exists; room-type mapping is fuzzy (`matchStayRoom`). Guest count never captured. Date-range inventory is **not** queried per night (Nexora `Date` is selected but summarizer modes beds/prices across related rows). |
| Confirmed booking without valid phone/guests/payment/booking ID | Tool never returned `ok: true`. If the model **spoke** confirmation, that is speech without a save. `Lead` has no booking ID column. | Prompt forbids speaking confirm before `ok: true`. Enforcement is a **SYSTEM note after the fact** (`buildFakeBookingConfirmSystemNote`) if assistant text is in chatCtx. Gemini Live often has weak/absent assistant text → note never fires. |
| Failed phone validation | Three captures: (1) `Name not confirmed` (`name: "Unknown"`); (2) `Phone contains letters` (`phone: "Current phone number"`); (3) `Phone number too long` (11 digits concatenated from STT fragments) | `validateLeadPhone` is working. The model passes garbage. Phone buffer / protocol exists in `prepareSimulator2UserTurn` but Gemini Live S2S often **does not wait** for that path to complete before tool calls. |
| Mixed female/male wording | Hardcoded feminine in Nexora `speak_now` (“karti hoon”, “bataungi”), tool filler “check karti hoon”, default core skills “bol rehi hoon / sakti hoon”. Gender prompt exists but is easy to override. | No runtime TTS-gender lock on Gemini tokens. |
| Lost conversation state | After “phone too long”, user said more digits; model called `end_call` | No durable slot-filling state machine. `CallFactsState` is regex-oriented (cars/Jaipur-heavy) and lives in SYSTEM notes, not a booking object. Off-topic/wrap + `end_call` tool is available and was used. |
| Inconsistent price/location/meal | Live lookup compact JSON has rooms+price+optional address+check-in/out. No meals. Address only if Nexora `Address` present. Prompt cap 4000 product chars + Gemini instruction compress 5500–6000 | Facts missing at the API schema layer + prompt truncation + model paraphrase. |

### 5.3 Why Gemini Live specifically makes this worse

- Pipeline for both Sim 2.0 calls: `voicePipeline: gemini_live`.  
- Native-audio model owns turn-taking. `onUserTurnCompleted` SYSTEM notes are **advisory**. The model can tool-call in the same audio turn.  
- `userTranscriptionEnabled: false` in LiveKit activity logs — Gemini still emits `inputTranscription`, but agent-side phone-buffer may not see the same text LiveKit chat sees.  
- Tool filler + `generateReply` force-speak after hotel lookup can **talk over** or **replace** an answer to the latest question.  
- Instruction compress (`compressTelephonyS2sInstructions`, 6000 chars in Sim / 5500 on phone) can slice booking-policy / gender / “never confirm” rules out of the middle of the prompt.

### 5.4 Phone number pathology (exact)

Capture 2 used `phone: "Current phone number"`. That string is **not** produced by `validateLeadPhone` or known-contact (those use real digits). It is the **model inventing a placeholder**, likely from English prompt language (“call number”, “current number”, “number on file”) on a Simulator call that **has no `contactPhone`**.

Capture 3 concatenated STT fragments:

- `"957"` then `"11158394"` → tool sent an **11-digit** string → `Phone number too long`.  
- Next user fragment was 9 digits; model `end_call` instead of asking for the missing digit (the validator hint says to do that).

`phone-buffer.ts` / `phone-protocol.ts` exist to assemble digit turns. They are **not a hard pre-tool filter** on Gemini function calls.

---

## 6. Which files control each part

### 6.1 Frontend

| Concern | File |
|---------|------|
| Routes / nav | `apps/web/src/App.tsx` |
| Studio | `apps/web/src/pages/Studio.tsx` |
| Booking policy UI | `apps/web/src/components/studio/BookingPolicyPanel.tsx` |
| Classic simulator | `apps/web/src/pages/Simulator.tsx` |
| Simulator 2.0 | `apps/web/src/pages/Simulator2.tsx` |
| Outbound phone | `apps/web/src/pages/OutboundCall.tsx` |
| REST client | `apps/web/src/api.ts` |
| Telephony SSE | `apps/web/src/hooks/useTelephonyEvents.ts` |

### 6.2 API / telephony

| Concern | File |
|---------|------|
| Express mount | `apps/api/src/index.ts` |
| Outbound + transports + hangup | `apps/api/src/telephony/routes.ts` |
| LiveKit SIP dial | `apps/api/src/telephony/livekit-sip.ts` |
| Acefone HTTP | `apps/api/src/telephony/acefone-client.ts` |
| Acefone media session | `apps/api/src/telephony/call-session.ts` |
| Acefone Gemini S2S | `apps/api/src/telephony/telephony-gemini-live-client.ts` |
| Acefone hotel tools | `apps/api/src/telephony/telephony-tools.ts` |
| Simulator 2.0 token | `apps/api/src/simulator2/livekit.ts` |
| Classic token | `apps/api/src/routes/livekit.ts` (`agentName: voice-sales-agent`) |
| Agent runtime | `apps/api/src/routes/agents.ts`, `apps/api/src/simulator2/runtime.ts` |
| Lead save + payment gates | `apps/api/src/routes/leads.ts` |
| Prisma | `apps/api/prisma/schema.prisma` |
| Webhook | `apps/api/src/call-webhook.ts` |

### 6.3 agent-v2 (current voice)

| Concern | File |
|---------|------|
| Worker entry, SIP wait, opener | `apps/agent-v2/src/main.ts` |
| Env load (root + api + local) | `apps/agent-v2/src/load-env.ts` |
| Runtime fetch | `apps/agent-v2/src/load-agent.ts` |
| Instructions + pipeline wiring | `apps/agent-v2/src/voice-agent.ts` |
| Tools (capture, callback, hotel) | `apps/agent-v2/src/tools.ts` |
| Turn SYSTEM notes | `apps/agent-v2/src/user-turn-handler.ts` → `@vsa/shared` `prepareSimulator2UserTurn` |
| Gemini Live model | `apps/agent-v2/src/gemini-live-factory.ts` |
| Hotel re-export | `apps/agent-v2/src/nexora-hotel-facts.ts` → `@vsa/shared` |

### 6.4 Shared brain / booking / hotel

| Concern | File |
|---------|------|
| Compile Brain+Skills | `packages/shared/src/index.ts` (`compileSystemPrompt`, `ensureGenderPrompt`) |
| Sim 2.0 instruction assembly | `packages/shared/src/simulator2-instructions.ts` |
| Prompt size cap (4000 product chars) | `packages/shared/src/simulator2-compact-prompt.ts` |
| Gemini supplement + 5500 trim | `packages/shared/src/gemini-live-config.ts` |
| Booking policy | `packages/shared/src/booking-policy.ts` |
| Nexora query / compact / inventory gate | `packages/shared/src/nexora-hotel-facts.ts` |
| Phone validate | `packages/shared/src/phone-utils.ts` |
| Phone capture protocol | `packages/shared/src/phone-protocol.ts`, `phone-buffer.ts` |
| Call facts notepad | `packages/shared/src/call-facts.ts` |
| Fake-confirm SYSTEM note | `packages/shared/src/simulator2-turn.ts` |
| Known contact | `packages/shared/src/known-contact.ts` |

### 6.5 What does **not** control LiveKit ringing

- Acefone portal / `ACEFONE_*`  
- `TelephonyCallSession`  
- Cartesia / Groq / Gemini (those run **after** answer)  
- Nexora  

---

## 7. Which prompts / tools / state machines are missing or weak

### 7.1 Missing (not in code)

| Gap | Impact |
|-----|--------|
| Explicit booking state machine (slots: city, property, room, dates, guests, name, phone, payment_ack, inventory_ok, saved_id) | Model improvises order; can close or `end_call` mid-collection |
| `party_size` on `capture_demo_lead` + Prisma `Lead` | Hotel template lists guests as required; **server never checks** |
| Booking ID generator | Cannot “confirm with ID”; any spoken ID is invented |
| Payment amount stored on Lead | `paymentDiscussed` is a boolean gate only; not persisted as a Lead column in `schema.prisma` |
| Nexora `select` for meals, pin, geo, landmark distance | Location/meal answers come from truncated Brain or hallucination |
| Date-range inventory (per-night beds for 1–4 Oct) | Summarizer aggregates related rows; does not prove those dates |
| Hard block: no `capture_demo_lead` until SYSTEM booking object is complete | Gemini can call the tool anytime |
| Hard block: no spoken “confirm” without last tool `ok: true` at the audio layer | SYSTEM note is text-only and late |
| LiveKit SIP inbound | Out of scope |
| SIP call reconciler | DB can remain `ringing` |

### 7.2 Weak (exists but insufficient)

| Mechanism | Why weak |
|-----------|----------|
| `buildBookingPolicyPrompt` | Injected into compiled prompt; Gemini compress/trim can drop it; not a finite-state enforcer |
| `missingBookingDiscussGates` | Only runs **inside** `capture_demo_lead` / POST `/api/leads`. Does not stop the model from **saying** payment is done or booking is confirmed |
| `assertLiveStayInventoryForBooking` | Never reached today (phone/name failed first). Does not take stay dates. 2.5s timeout. Soft-allows when API down (`inventory_verified: false`) |
| `lookup_hotel_availability` force-speak | Speaks inventory even when the user asked location/meals; can drown the actual question |
| `prepareSimulator2UserTurn` SYSTEM notes | Advisory. Hotel city note says MUST lookup — that part worked for Agra. Answer-the-latest-question is not a structured gate |
| `CallFactsState` | Regex catalog is car/Jaipur-centric (`virtus|taigun`, Vaishali Nagar). Agra/hostel facts are poorly extracted |
| Phone protocol | Designed for cascaded STT turns. Gemini function-calling bypasses it |
| Gender prompt | Default skills + Nexora `speak_now` are **female hardcoded**. `ensureGenderPrompt` no-ops if `## Speaker gender` already in compiled prompt |
| `end_call` | Extra description says don’t hang up on identity questions; it still fired during phone repair |
| Fake booking-confirm note | Regex on assistant **text**. Gemini audio-only replies may not populate `chatCtx` assistant text |

### 7.3 Tools that exist

| Tool | Worker | Notes |
|------|--------|-------|
| `lookup_hotel_availability` | agent-v2 + Acefone telephony-tools | Only if Nexora configured **and** `booking.outcome === 'stay'` |
| `capture_demo_lead` | both | Name/phone confirm flags; payment flag; **no party_size** |
| `update_demo_lead_name` | agent-v2 | After save only |
| `schedule_callback` | both | Wrong tool for stays (prompt says so) |
| `end_call` | LiveKit `beta.createEndCallTool` | Used prematurely in call 2 |

There is **no** `get_property_location`, `get_meals`, `validate_party_size`, or `create_booking_id` tool.

---

## 8. What logs prove the issue

### 8.1 SIP no-ring (user LiveKit detail; not in today’s app terminals)

```
transport<TLS> dial err=dial tcp <nil>->14.97.48.21:49869: connect: connection timed out
```

**Proves:** LiveKit’s SIP/TLS client timed out connecting to Tata-range `14.97.48.21:49869`.  
**Does not prove:** a bug in `OutboundCall.tsx` or `createSipParticipant` request construction.  
**Still needed:** one full app log of a LiveKit SIP Place call (`OUTBOUND_CALL_REQUEST` … `LIVEKIT_SIP_PARTICIPANT_POLL`) plus Tata CDR for the same second.

### 8.2 Today’s agent-v2 — session is Simulator, not SIP

```
AGENT_SESSION_STARTING { roomName: "call-v2-0c52516d-…", telephony: false, voicePipeline: "gemini_live" }
AGENT_SESSION_STARTED  { … telephony: false }
```

**Proves:** booking bugs were observed on **Simulator 2.0**, same worker that SIP would use after answer.

### 8.3 Hotel lookup succeeded

```
[nexora] lookup_hotel_availability
  asked: Agra, ok: true, hotel: Moustache Agra, rooms: 4,
  policies: ["check_in","check_out"], spoken: true, forceSpoken: true, ms: 408
```

**Proves:** Nexora path works for Agra. Policies in live payload were only check-in/out — **not** meals, pin, Taj distance.

### 8.4 Three failed captures (masked)

1. `name: "Unknown"`, `phone: "Current phone number"`, `phone_confirmed: true`  
   → `ok: false`, `Name not confirmed` (read-back “Maine suna Unknown”)

2. `name: "Saurabh"`, `name_confirmed: true`, `phone: "Current phone number"`  
   → `ok: false`, `Phone contains letters`

3. `phone: "<11-digit concatenation from STT>"`  
   → `ok: false`, `Phone number too long`  
   hint: ask which 10 digits are correct  

None included `payment_discussed`. None included guest count.

### 8.5 Premature hangup

User STT fragment of a number, then:

```
toolCall end_call args: {}
```

**Proves:** wrap/end fired during phone repair. Booking was never saved.

### 8.6 Azure STT

```
Azure Speech key rejected (401) for region centralindia
```

**Proves:** cascaded pipeline is deaf until `AZURE_SPEECH_KEY` is fixed. Irrelevant to Gemini Live Sim 2.0 hearing.

### 8.7 Webhook

```
[webhook] call.completed failed { callId: …, url: http://192.168.*.*:8000/api/projects/<id>/ingest/voice/call-completed, message: fetch failed }
```

**Proves:** post-call ingest host on LAN is down. Unrelated to ring or in-call booking.

### 8.8 Logs that are **missing** (unclear)

| Missing | Why it matters | Where to get it |
|---------|----------------|-----------------|
| Today’s `OUTBOUND_CALL_REQUEST` | Cannot prove which transport was used for the no-ring incident | Reproduce SIP dial; API terminal |
| `sip.callStatus` poll series for the failing SIP call | Distinguishes dialing-stuck vs hangup vs error | API `LIVEKIT_SIP_PARTICIPANT_POLL` + agent `AGENT_V2_SIP_STATUS_POLL` |
| Gemini **output** transcription of “booking confirm” | User heard confirm; tool never `ok: true` — need spoken text | Enable/persist `outputAudioTranscription` in call transcript JSON |
| Nexora raw JSON for Agra (full `Address`, meals) | Whether location existed in API but was dropped by `compactHotelFactsForLlm` | HTTP log of facts/query response (no token) |
| Agent Studio `skillsConfig.booking` for agent `0c52516d-…` | Confirm `hotel_stay` vs custom requiredFields | SQLite `Agent` row or Studio Booking policy tab |
| LiveKit trunk XML/JSON | Who `14.97.48.21` is | LiveKit Cloud SIP outbound trunk |

---

## 9. Exact fixes next, in phases

Do **not** mix SIP infra work with booking FSM work. They are parallel tracks.

### Phase 0 — Reproduce and label (no product change)

1. On `/outbound`, screenshot transport = **LiveKit SIP**.  
2. Place one call with debug **wait until answered** ON.  
3. Capture API logs `OUTBOUND_CALL_REQUEST` → `LIVEKIT_SIP_*`.  
4. Capture agent-v2 `AGENT_V2_WAITING_FOR_SIP_ANSWER` / timeout.  
5. Download LiveKit Call Detail for that room (TLS dial line).  
6. If Tata is the SIP peer: CDR + SBC ACL for LiveKit Cloud egress IPs.  
7. Confirm Acefone-only calls still ring (proves PSTN number/CLI, not LiveKit).

**Success:** one folder of logs that shows `createSipParticipant` vs TLS timeout vs Tata 4xx/487.

### Phase 1 — SIP connectivity (infra first)

This is **not** a TypeScript bug if the TLS dial to `14.97.48.21:49869` still times out.

1. In LiveKit Cloud outbound trunk: confirm SIP URI, transport (UDP/TCP/TLS), auth, destination port (**5061** vs random).  
2. If the far end is Tata SBC: allow-list LiveKit Cloud signaling/media IPs; do not expect LiveKit to dial a **NAT ephemeral** Contact port unless the SBC is set up for it.  
3. Preferred architecture for India PSTN: LiveKit trunk → **Telnyx/Twilio Elastic SIP** that already dials India, **or** Tata Click-to-Call Support (Acefone path), **not** LiveKit attempting TLS to a high port on Tata.  
4. App-side hardening (only after Phase 0 logs):
   - Surface last `sip.callStatus` on the Outbound UI (poll already exists).  
   - If poll stays `dialing` > N seconds, mark `failed` and show “SIP INVITE did not reach carrier” instead of infinite “Ringing…”.  
   - Extend orphan reconciler to `source: livekit-sip`.  
   - Align `docs/TELEPHONY-OUTBOUND.md` (remove audio-track sentence).

**Do not** “fix” no-ring by starting the agent earlier. That was the old bug.

### Phase 2 — Stop fake bookings (server truth)

Goal: the model **cannot** tell the user a stay is confirmed unless a Lead row exists.

1. Add a per-call `BookingDraft` object (memory is fine first): city, property, room, check-in, check-out, party_size, name, phone, payment_ack, inventory_ok, leadId.  
2. `capture_demo_lead` must require `party_size` when policy `requiredFields` includes it; reject otherwise (same pattern as `payment_discussed`).  
3. Persist guests on `Lead` (new column) or `notes` with a structured prefix until schema migration.  
4. Return `booking_ref` (Lead id or short code) on `ok: true`. Prompt: speak that ref only.  
5. Ban spoken confirm: if Gemini is about to talk, user-turn-handler already has `looksLikeBookingConfirmed` — **also** run it on output transcription; force a correction line. Better: after failed tool, inject a short `session.generateReply` that reads the tool `hint` and **nothing else**.  
6. Reject `phone` that is not 10 digits **before** `phone_confirmed` can be true; reject literals like `Current phone number`.  
7. Phone assembly: do not call `capture_demo_lead` until `phone-buffer` has 10 digits **or** knownContact.phone is real digits. Gemini should get a tool error `WAIT_FOR_DIGITS` rather than `too long`.  
8. Stop `end_call` while phone capture is active (`shouldRunPhoneProtocol`).

### Phase 3 — Answer the question asked (conversation)

1. User-turn classifier already has `isProductCatalogHelpAsk` / city lookup. Add a **priority rule**: if the latest user turn is location / meals / price / distance, **forbid** `capture_demo_lead` this turn.  
2. Extend Nexora `NEXORA_HOTEL_SELECT_FIELDS` with whatever the live index actually has: meals, pin, lat/lng, landmarks. If the index does not have them, put them in Brain and **stop truncating those sections** (or retrieve them with a `lookup_property_policies` tool).  
3. Disable hotel force-speak when the user question is not availability (or make `speak_now` answer the asked facet).  
4. `CallFactsState`: add stay keys (`city`, `room`, `dates`, `guests`, `meals_asked`) instead of car models.  
5. Gender: generate Nexora `speak_now` and tool fillers from `agentGender`; remove hardcoded `karti hoon` / `bataungi`.

### Phase 4 — Inventory honesty

1. Pass stay dates into `queryNexoraHotelFacts` / match on `Date` instead of mode-aggregating all dates.  
2. Mixed dorm vs “4 bedroom”: do not map “four bedroom” → `4 Bed Mixed Dorm` without confirmation.  
3. Multi-property cities: already asks Hostel vs Resort when `other_properties` exist; keep that; do not dump one property as the city.

### Phase 5 — Ops / keys

1. Fix `AZURE_SPEECH_KEY` (401) before any cascaded phone test.  
2. Fix or disable `CALL_COMPLETED_WEBHOOK_URL` (LAN host down).  
3. Keep Gemini Live for latency, but treat it as **untrusted** for booking commits — tools + DB are the source of truth.

---

## 10. File / log / env still needed (explicit “unclear”)

| Question | Status | Need |
|----------|--------|------|
| Which transport was selected on the silent PSTN attempt? | Unclear | Outbound UI echo + `OUTBOUND_CALL_REQUEST` from that minute |
| Is LiveKit trunk terminated on Tata vs Telnyx? | Unclear | LiveKit Cloud SIP outbound trunk config (no secrets) |
| Why port 49869 not 5061? | Unclear | SIP trace / Contact header from LiveKit Call Detail |
| Did `sip.callStatus` ever leave `dialing`? | Unclear for that incident | `LIVEKIT_SIP_PARTICIPANT_POLL` / `AGENT_V2_SIP_STATUS_POLL` |
| Did the model **speak** “booking confirm” despite `ok: false`? | Unclear in logs (no output transcript dump) | Call transcript JSON / Gemini output transcription |
| Agent `0c52516d-…` booking template | Unclear | Prisma `skillsConfig.booking` for that agent |
| Nexora Agra raw address/meals | Unclear | One facts/query response body (redact token) |
| Whether Acefone still rings this number | Unclear today | Place Acefone call; Smartflo CDR |

---

## 11. Quick reference — processes and names

| Name | Value |
|------|--------|
| Current worker | `voice-sales-agent-v2` |
| Legacy worker | `voice-sales-agent` |
| SIP room prefix | `call-v2-` |
| Classic room prefix | `call-` |
| Acefone room prefix | `telephony-` |
| Default real-phone transport | Acefone if keys exist |
| Hotel tool | `lookup_hotel_availability` |
| Save tool | `capture_demo_lead` |
| Stay inventory env | `NEXORA_FACTS_QUERY_URL`, `NEXORA_INGEST_TOKEN` |
| SIP trunk env | `LIVEKIT_SIP_OUTBOUND_TRUNK` on `apps/api/.env` |

---

## 12. Suggested message to paste into ChatGPT (short)

We have two issues. (1) LiveKit SIP `createSipParticipant` succeeds but the handset does not ring; LiveKit Call Detail shows `transport<TLS> dial tcp <nil>->14.97.48.21:49869 connection timed out` — Tata-range IP, ephemeral port, so this is SIP/TLS reachability from LiveKit Cloud, not the React/Express dial button. Current agent-v2 waits for `sip.callStatus=active` only. (2) Simulator 2.0 Gemini Live hotel call: Nexora Agra lookup ok, then `capture_demo_lead` failed three times (Unknown name, phone literal “Current phone number”, 11-digit STT concat); payment/guests never collected; `end_call` during digit repair; no booking ID; location/meals not in Nexora select. Do not start the agent during dialing. Fix SIP at trunk/SBC. Fix booking with a server-side draft + party_size + block confirm/end_call until tools return ok:true.

---

*End of diagnosis pack. Inspect-only. Next engineering work should start at Phase 0 (SIP reproduce) and Phase 2 (server-side booking truth), not with more prompt-only tweaks.*
