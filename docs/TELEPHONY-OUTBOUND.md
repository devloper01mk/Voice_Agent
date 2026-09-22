# Outbound telephony

Place real outbound calls from **Outbound Call** in the web app (`/outbound`).

Two transports are supported:

| Transport | Path | Feel |
|-----------|------|------|
| **Acefone / Smartflo** (default when keys exist) | Click-to-Call Support → Voice Bot WSS → API `call-session` | Half-duplex + local barge |
| **LiveKit SIP** (optional) | PSTN → LiveKit SIP trunk → room → **agent-v2** (same as Simulator 2.0) | Natural barge / duplex |

## Important: Transport selection

**Always check the selected transport on `/outbound` and in backend logs before debugging trunks.**

- **Acefone path** uses Tata Smartflo HTTP **Click-to-Call Support** (`/v1/click_to_call_support`) and Voice Bot WSS into `TelephonyCallSession`. It does **not** call LiveKit `createSipParticipant`.
- **LiveKit SIP path** uses LiveKit `createRoom` + `AgentDispatchClient` (`voice-sales-agent-v2`) + `SipClient.createSipParticipant` with `LIVEKIT_SIP_OUTBOUND_TRUNK`.
- **LiveKit trunk settings do not affect Acefone calls.**
- **Acefone portal settings / successful Acefone rings do not prove the LiveKit SIP path is being used.**
- Code default: if Acefone/Smartflo keys are configured, `GET /api/telephony/transports` recommends **acefone** (`defaultTransport: acefone`).
- Look for named logs: `OUTBOUND_CALL_REQUEST`, `LIVEKIT_SIP_PARTICIPANT_CREATE_REQUEST`, `LIVEKIT_SIP_CALL_FAILED`, `CUSTOMER_ANSWERED`.
- Debug checkbox on LiveKit: **wait until call is answered** passes `waitUntilAnswered: true` so SIP reject/no-answer surfaces on the HTTP response.

---

## LiveKit SIP (Simulator 2.0 path)

### Prerequisites

1. LiveKit Cloud project with **SIP** enabled.
2. Create an **Outbound SIP trunk** (Telnyx, Twilio Elastic SIP, or another SIP provider that can dial Indian PSTN).
3. Copy the trunk id into env.
4. Run `npm run dev:agent-v2` (worker must be registered as `voice-sales-agent-v2`).

### Env (`apps/api/.env`)

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_SIP_OUTBOUND_TRUNK=ST_xxxxxxxx
# Optional caller ID presented on the trunk
# LIVEKIT_SIP_FROM_NUMBER=9198xxxxxxxx
GEMINI_API_KEY=...   # if using gemini_live
API_URL=http://localhost:3001
# Optional: keep gemini-3.1 on phone (opener/tool speak weaker — default remaps to 2.5)
# GEMINI_LIVE_ALLOW_31_ON_PHONE=1
# Noise cancel: default auto (Telephony BVC on SIP). Override: off | nc | bvc-web | bvc-telephony
# NOISE_CANCELLATION=bvc-telephony
```

### Flow

1. UI → `POST /api/telephony/outbound-call` with `transport: "livekit_sip"`
2. API creates `call-v2-…` room + dispatches **voice-sales-agent-v2**
3. API dials via `SipClient.createSipParticipant` (**Krisp off on trunk** — agent uses Telephony BVC)
4. Agent waits for `sip.callStatus=active` (or SIP audio track) before opener
5. On answer, agent-v2 opens (same Gemini Live / Realtime / cascaded stack as Simulator 2.0)

Hangup deletes the LiveKit room.

**Phone tuning:** shorter AEC warmup (~900ms), softer barge thresholds, Gemini 3.1 remapped to 2.5 native-audio for `generateReply` (opener + hotel speak).

**Debug options (Outbound UI → LiveKit SIP):**

- Default: `waitUntilAnswered=false`, request `timeout=20`, `ringingTimeout=45`. API returns after `createSipParticipant`; background poll logs `sip.callStatus` every 2s for 60s.
- Checkbox **wait until answered**: `timeout=max(90, ringingTimeout+30)`, status `dial_timeout` if SDK aborts before answer.
- Checkbox **use default trunk caller ID**: omit `fromNumber` so the LiveKit outbound trunk CLI is used.
- Checkbox **play dialtone**: default **off** (`playDialtone=false`) so early media does not confuse SIP answer detection; enable only for debugging.
- Agent-v2 still waits for `sip.callStatus=active` before the opener — greeting does not start on ring alone.

---

## Acefone / Smartflo (legacy)

### Prerequisites (Acefone portal)

1. **Settings → Channels → Voice Bot** — add Dynamic endpoint:
   - POST URL: `https://<your-ngrok>/api/telephony/voice/endpoint`
   - Map fields: `callId`, `fromNumber`, `toNumber`, `status`
2. **API Connect → Click to Call Support API** — generate API key with **VOICE Bot** as destination

### Env

```env
ACEFONE_CLICK_TO_CALL_API_KEY=your_api_key
ACEFONE_FROM_NUMBER=919876543210
TELEPHONY_WSS_PUBLIC_URL=wss://YOUR-NGROK.ngrok-free.app/stream
API_URL=https://YOUR-NGROK.ngrok-free.app
```

### Run locally

```bash
# Terminal 1 — ngrok for Acefone callbacks + WSS
ngrok http 3001

# Terminal 2
npm run dev:api

# Terminal 3
npm run dev:web

# Terminal 4 (required for LiveKit SIP / Simulator 2.0)
npm run dev:agent-v2
```

Open http://localhost:5173/outbound, pick transport, enter mobile, **Place call**.

`GET /api/telephony/transports` reports which transports are configured.

### Acefone + Gemini Live S2S (latency)

Acefone is **half-duplex**: while the agent plays audio to the phone, caller mic is not sent to Gemini unless **local-energy barge** cuts playback. Provider-side interrupts are ignored (echo would cause silence).

**Recommended**

- Agent preset: **Gemini Live S2S**; model **2.5 native audio** (API auto-remaps 3.1 → 2.5 on phone unless `GEMINI_LIVE_ALLOW_31_ON_PHONE=1`).
- In agent realtime settings: **turn silence ~100–110ms** (UI `0` is clamped to 100ms on phone).
- `LATENCY_PROFILE=low` on API (default) — shorter cascaded STT/LLM paths if you fall back from S2S.
- Shorter compiled brain / fewer tools on hot paths — prompt is trimmed for phone S2S.

**Expectations**

- You can **barge in** after ~700ms of agent speech + sustained loud talk; you will **not** hear the agent mid-sentence like LiveKit full duplex.
- Replies start after a short hush (~110ms local EOU nudge + model TTFT), not while you are still talking.

**Env**

```env
LATENCY_PROFILE=low
TELEPHONY_WSS_PUBLIC_URL=wss://YOUR-NGROK.ngrok-free.app/stream
# Optional: keep Gemini 3.1 on Acefone (slower turns)
# GEMINI_LIVE_ALLOW_31_ON_PHONE=1
```
