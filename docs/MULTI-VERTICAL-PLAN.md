# Multi-vertical plan: one sales + support brain, many products

**Goal:** the same voice agent platform should serve a hotel, a CRM, an agriculture advisory, a car dealer, or any other product — without code changes per client and without one industry's rules leaking into another's calls.

**Status (2026-09-24):** Roadmap step 1 (playbook engine) done — see "Decision update" below. Phase 1 done — `packages/shared/src/packs/` (generic, crm_demo, hotel_stay, auto_test_drive), hotel logic moved behind the hotel pack, `Agent.agentRules`, brand defaults removed, `speakLine()` for Gemini Live, guard tests in `packs/packs.test.ts`. Deferred to Phase 2: auto STT/transcript maps and caller-speech regexes (`call-hold.ts`, `off-topic-wrap.ts`, `call-facts.ts`) — they only classify caller speech, they do not instruct the model.

**Principle:** sales + support *skills* are universal. What changes per product is (a) the facts, (b) what a successful call ends in (booking, demo, visit, advisory callback), and (c) which live systems the agent can query.

> **Decision update (2026-09-24): everything product-specific is data, not code.**
> One salesperson can sell anything; only *how to sell* and *what to sell* change. So the
> "how to sell" layer is a per-agent **Sales Playbook** (JSON in the DB, seeded from templates,
> later auto-generated from the Brain). Code packs remain only for **integrations** that truly
> need code (today: the hotel live-inventory adapter). Phases 2–3 below are superseded where
> they say "pack file per industry" — a new industry is a new playbook, not a new file.

---

## 1. Target architecture — four layers

| Layer | Owner | Changes when… | Lives in |
|---|---|---|---|
| **1. Core skills** | Platform | Never per client | `packages/shared` (domain-free code) |
| **2. Sales playbook** (how to sell) | Client | Any time, in Studio | `Agent.playbook` JSON (templates in `packages/shared/src/playbook.ts`) |
| **3. Product knowledge** (what to sell) | Client | Client edits their Brain | DB (`brainMarkdown`, chunks, catalog) |
| **4. Tools / integrations** | Client | Client connects a system | DB config; code adapters only when unavoidable (`packs/hotel-stay.ts`) |

Rule of thumb:

- **New client, any industry** → pick a playbook template (or generate one), edit it, add Brain + Agent rules. **Zero code.**
- **New live system** (inventory API, CRM calendar) → configure a generic tool; write an adapter only if the API needs custom logic.
- **Layer 1 must never mention a domain** (no "hotel", "showroom", "Manali", "test drive", brand names).

### Sales playbook shape

```ts
interface SalesPlaybook {
  templateId: string;              // template it started from, or "custom"
  industry: string;                // "Real estate", "Hotel stays", "Agri inputs"
  customerNoun: string;            // "buyer", "guest", "farmer"
  offeringNoun: string;            // "flat or plot", "room", "crop solution"
  goal: {
    label: string;                 // spoken: "site visit"
    slug: string;                  // saved Lead.bookingType: "site_visit"
    alternateSlugs: string[];
    dateMode: 'single_slot' | 'date_range' | 'none';
    locationType: string;          // free text: "site", "online", "hotel"
  };
  fields: Array<{ key: string; label: string; required: boolean }>;  // saved in Lead.details
  discoveryQuestions: string[];
  qualification: string[];         // when to offer the goal
  mustNotSay: string[];
  pricingRules: string;
  handoff: string;
  extraRules: string;
}
```

The playbook's goal overrides Booking-policy vocabulary (spoken label, booking type, location).
Booking policy keeps the universal save gates (name/phone confirm, discuss-before-save, email).
Agents without a stored playbook get one derived from their Booking policy + matching template,
so behaviour does not change until someone edits it.

### How a prompt is built

```
Core skills prompt            (Layer 1 — same text for every agent)
+ Agent rules                 (client's short always-on guardrails)
+ Product Knowledge map       (Layer 3 — inline if small, catalog map + search if large)
+ Sales playbook section      (Layer 2 — rendered from Agent.playbook)
+ Tool list + integration     (Layer 4 — e.g. hotel lookup rules only when that adapter is on)
+ Call context                (direction, caller, time, memory)
```

### Roadmap (replaces the old Phase 2–3 ordering)

1. **Playbook engine** — type, templates, `Agent.playbook`, prompt + save tool driven by it, `Lead.details`, speakAs-driven labels (fixes "showroom visit" leaking into non-auto agents), free-text `locationType`. Studio Playbook tab.
2. **Auto-generate** a playbook draft from the Brain on save; Studio shows it for approval.
3. **`catalog_lookup`** — CSV/sheet upload + filter tool for flats, plots, rooms, SKUs.
4. **Generic `live_lookup` HTTP tool** — Nexora becomes one config of it.
5. **Scenario tests** auto-generated per playbook.

---

## 2. Current state — what already fits, what leaks

### Already in place

- `BookingPolicy` with templates `crm_demo`, `hotel_stay`, `auto_test_drive` (`packages/shared/src/booking-policy.ts`) — per-agent outcome, required fields, discuss gates, vocabulary. This is the seed of the pack concept.
- Skills are stored per agent (`skillsConfig`) and merged with defaults (`mergeSkillsConfig`).
- Large Product Knowledge: chunked + `search_product_knowledge` tool + catalog map (`packages/shared/src/product-knowledge.ts`, `apps/api/src/product-knowledge.ts`).
- Section-priority prompt compression for Gemini Live (`compressTelephonyS2sInstructions`).

### Domain leaks into "universal" code

Counts of hotel/auto/brand terms in non-test source (excluding `nexora-hotel-facts.ts`, which is legitimately hotel-only):

| File | Hits | What leaks |
|---|---|---|
| `apps/api/src/telephony/telephony-tools.ts` | 35 | hotel lookup tool + descriptions, city examples |
| `packages/shared/src/index.ts` | 31 | `buildPrinciplesPrompt` "Stay / hotel" clarify rule; Voice rules "check-in and check-out"; hotel tool block; Volkswagen/automotive STT hooks |
| `apps/agent-v2/src/tools.ts` | 30 | hotel lookup tool, "Moustache Rishikesh Resort" example |
| `packages/shared/src/simulator2-turn.ts` | 25 | `isCityHotelExistenceAsk`, `buildCityHotelLookupNote`, Moustache brand cue, room/suite regex in the shared turn policy |
| `packages/shared/src/booking-policy.ts` | 25 | fine (templates) — but `BookingLocationType` is `'showroom' \| 'home' \| 'online' \| 'hotel'` |
| `packages/shared/src/gemini-live-config.ts` | 8 | S2S supplement: hotel lookup lines, "dealership advisor", check-in dates |
| `packages/shared/src/stt-phrase-list.ts`, `transcript-correction.ts` | 12 | `isVolkswagenProduct`, `isAutomotiveProduct`, car-name correction maps |
| `apps/agent-v2/src/voice-agent.ts` | 4 | `END_CALL_EXTRA` — Manali/Agra, hotel lookup rules for every agent |
| `packages/shared/src/call-facts.ts`, `schedule-parse.ts` | 9 | showroom / test_drive intents and slot lengths |
| `apps/api/src/routes/leads.ts` | 6 | `locationType` enum, "showroom/demo booking" errors |
| `packages/shared/src/sales-support-skills.ts` | 1 | "Moustache-style correction" comment (harmless, but a smell) |
| `apps/api/prisma/schema.prisma`, `routes/agents.ts` | — | default `productName` = "Cronberry CRM"; `Lead.location` / `locationType` default `showroom` |

### Other structural issues

- **Rules mixed into the Brain.** Real agents have behaviour rules inside `brainMarkdown` ("AGRICULTURE DOMAIN LOCK — HIGHEST PRIORITY", "BOOKING CONVERSATION FLOW", "Never invent price"). With large-brain search, those are no longer always in the prompt.
- **Integrations are global.** Hotel lookup is enabled by env (`NEXORA_*`) for every `stay` agent — two hotel clients cannot use two different inventory APIs.
- **Tools duplicated per runtime.** `apps/agent-v2/src/tools.ts` (LiveKit) and `apps/api/src/telephony/telephony-tools.ts` (Acefone) are ~650 lines each with the same logic.
- **Tool naming is domain-specific.** `capture_demo_lead` is used for hotel stays and agriculture callbacks.
- **Intent detection is Hinglish regex.** `DEFER_BOOKING_ASK`, `FRUSTRATED_OR_ANGRY`, `CLEAR_BOOK_INTENT`, hotel existence regexes — not extensible per pack or language.
- **`session.say()` on Gemini Live.** Used by `user-turn-handler.ts` and `silence-watchdog.ts`, but the session has no TTS; failures are swallowed (possible dead air). Not pack-related, but fix alongside Phase 1.

---

## 3. Data model changes

### 3.1 `VerticalPack` (code, `packages/shared/src/packs/`)

Packs are code, not DB rows: they contain prompt text and runtime hooks that need review and tests.

```ts
export type PackId = 'generic' | 'crm_demo' | 'hotel_stay' | 'auto_test_drive' | 'agri_advisory';

export interface VerticalPack {
  id: PackId;
  label: string;
  description: string;

  /** Seeds the agent's BookingPolicy (outcome, required fields, gates, vocabulary). */
  bookingPolicy: BookingPolicy;

  /** Spoken vocabulary used by core prompts via placeholders. */
  vocabulary: {
    lead: string;          // "guest" | "customer" | "farmer"
    offering: string;      // "property" | "plan" | "crop solution" | "car model"
    outcomeSpoken: string; // "stay booking" | "product demo" | "field officer visit"
  };

  /** How dates are resolved and confirmed. */
  dateMode: 'stay_range' | 'single_slot' | 'none';

  /** Short domain rules appended after core skills — the ONLY place domain wording lives. */
  promptFragment: string;

  /** Discovery questions the core "Discover" step may draw from (meanings, not scripts). */
  discoveryHints: string[];

  /** Tool plugin ids this pack supports; the agent enables a subset. */
  supportedTools: ToolPluginId[];

  /** STT hints + transcript-correction maps. */
  sttPhrases: string[];
  transcriptCorrections?: Record<string, string>;

  /** Optional per-turn hooks (e.g. hotel city → force live lookup). */
  turnHooks?: PackTurnHook[];
}
```

Initial packs:

| Pack | Outcome | Date mode | Tools | Notes |
|---|---|---|---|---|
| `generic` | `lead_only` | `single_slot` | knowledge search | default for unknown industries |
| `crm_demo` | `demo` | `single_slot` | knowledge search, calendar slots | from current `crm_demo` template |
| `hotel_stay` | `stay` | `stay_range` | knowledge search, live inventory | move all hotel code here |
| `auto_test_drive` | `visit` | `single_slot` | knowledge search, catalog lookup | move Volkswagen/auto STT here |
| `agri_advisory` | `callback` / `visit` | `single_slot` | knowledge search, catalog lookup | "dose/chemical advice only from verified facts; escalate to expert" |

### 3.2 Agent (Prisma)

```prisma
model Agent {
  // ...existing
  packId         String  @default("generic")
  /** Short always-on client rules (guardrails). Never searched — always in prompt. */
  agentRules     String  @default("")
  /** Per-agent tool plugins: [{ id, enabled, config }] — secrets stored encrypted/refs. */
  toolConfig     Json?
  productName    String  @default("")   // drop "Cronberry CRM" default
}
```

- `skillsConfig.booking` stays as the per-agent override of the pack's `bookingPolicy`.
- Migration: map existing `skillsConfig.booking.templateId` → `packId` (`crm_demo`/`hotel_stay`/`auto_test_drive`, else `generic`).

### 3.3 Lead (Prisma)

```prisma
model Lead {
  // ...existing core columns: name, phone, email, preferredTime, scheduledStart/End, status, bookingType
  /** Pack-specific fields: party_size, city, room_name, crop, acreage, model, ... */
  details  Json   @default("{}")
  // location / locationType kept for backward compat, deprecated; new writes go to details
}
```

### 3.4 Organization (Phase 4)

```prisma
model Organization {
  id        String  @id @default(uuid())
  name      String
  agents    Agent[]
  webhookUrl String?
  // per-org API keys, usage limits
}
```

---

## 4. Phases

### Phase 1 — Make the core domain-free (highest priority)

**Why first:** today a CRM or agriculture agent receives hotel rules (city lookup, check-in/check-out, Manali examples) and dealership tone. That is wrong behaviour, not just tidiness.

Tasks:

1. **Create `packages/shared/src/packs/`** with `types.ts`, `generic.ts`, `hotel-stay.ts`, `crm-demo.ts`, `auto-test-drive.ts`, and `index.ts` (`getPack(id)`, `resolvePackForAgent(agent)`).
   - For Phase 1, `resolvePackForAgent` derives the pack from `skillsConfig.booking.templateId`/`outcome` — no DB change yet.
2. **Move hotel wording out of core prompts** into `hotel-stay.ts#promptFragment`:
   - `buildPrinciplesPrompt` (`index.ts`): "Stay / hotel… lookup_hotel_availability" clarify line; the whole `outcome === 'stay'` tool block.
   - Voice rules: "confirm both check-in and check-out" → core says "confirm the date(s) the caller gave"; the stay-range rule goes to the pack.
   - `buildGeminiLiveS2sInstructionSupplement` (`gemini-live-config.ts`): hotel lookup lines, "dealership advisor", check-in date lines → pack fragment or tool description.
   - `END_CALL_EXTRA` (`apps/agent-v2/src/voice-agent.ts`) and `END_CALL_DESCRIPTION` (`telephony-tools.ts`): remove hotel/city lines.
   - `product-knowledge.ts` tool description example "Manali resort cancellation policy" → neutral example.
3. **Move hotel turn logic behind a pack hook**:
   - `simulator2-turn.ts`: `isCityHotelExistenceAsk`, `buildCityHotelLookupNote`, the Moustache brand cue, and the room/suite/hostel regex → `hotel-stay.ts#turnHooks`. Core turn policy calls `pack.turnHooks` generically.
4. **Move auto STT logic** (`isVolkswagenProduct`, `isAutomotiveProduct`, car correction maps in `transcript-correction.ts`) → `auto-test-drive.ts` (`sttPhrases`, `transcriptCorrections`).
5. **Split the Brain into rules vs knowledge**:
   - Add `agentRules` (Studio textarea "Agent rules / guardrails", ~1,500 char limit, always in prompt, high priority in S2S compression).
   - Keep `brainMarkdown` as facts (searchable).
   - One-time helper in Studio: "Suggest rules from Brain" — highlights headings containing RULE / LOCK / NEVER / PRIORITY / FLOW so the client can move them.
6. **Remove brand defaults**: `productName` default "Cronberry CRM" → `""` (require it in Studio).
7. **Fix `session.say()` on Gemini Live** (`user-turn-handler.ts`, `silence-watchdog.ts`): use `generateReply({ instructions: "Say exactly: …" })` for S2S, keep `say()` only if a TTS is configured.

Acceptance criteria:

- A guard test fails if core files contain domain words: scan `index.ts` (excluding pack imports), `sales-support-skills.ts`, `simulator2-turn.ts`, `gemini-live-config.ts`, `voice-agent.ts` for `/hotel|check-in|showroom|dealership|Manali|Moustache|Volkswagen/i`.
- Snapshot tests: compiled prompt for a CRM agent contains no hotel text; hotel agent still contains its lookup rules.
- All existing hotel tests (`nexora-hotel-facts.test.ts`, `simulator2-instructions.test.ts`) still pass via the hotel pack.

### Phase 2 — Industry pack as a first-class concept

Tasks:

1. **Prisma**: add `Agent.packId`, `Agent.agentRules`; migration maps existing agents from `booking.templateId`.
2. **Prompt composition** (`compileSystemPrompt`): core → `pack.promptFragment` → `agentRules` → Product Knowledge → tools. Vocabulary placeholders (`{lead}`, `{offering}`, `{outcome}`) filled from the pack in core skills text.
3. **S2S compression priorities** (`S2S_SECTION_SHARES`): add `## Agent rules` (high) and `## Industry rules` (medium).
4. **Studio**:
   - Pack picker at agent creation (cards: Hotel, CRM demo, Auto, Agriculture, Generic).
   - Picking a pack seeds `BookingPolicy`, discovery hints, and default tool set; everything stays editable.
   - `BookingPolicyPanel.tsx` reads options from the pack instead of hardcoded hotel/showroom labels.
5. **Add `agri_advisory` pack**: outcome `callback` (expert call) or `visit` (field officer); required fields `name, phone, village/district, crop`; rules: no chemical dose/brand advice unless in Product Knowledge; weather/pest emergencies → escalate.
6. **`dateMode`**: `schedule-parse.ts`/`call-time.ts` read `dateMode` — `stay_range` (check-in + check-out), `single_slot` (one datetime), `none`.

Acceptance criteria:

- Creating a new agriculture client requires only Studio config.
- Per-pack prompt snapshot tests (`packs/*.test.ts`).

### Phase 3 — Tools as per-agent plugins, defined once

Tasks:

1. **Tool registry** (`packages/shared/src/tools/`): each plugin = `{ id, schema (JSON schema), description(pack, agent), execute(args, ctx) }` where `execute` runs server-side in `apps/api`.
   - Plugins: `search_product_knowledge`, `save_outcome`, `schedule_callback`, `update_lead_name`, `live_inventory` (Nexora adapter), `catalog_lookup`, `calendar_slots`, `end_call`.
2. **One executor, two adapters**:
   - `apps/api` exposes `POST /api/tools/:agentId/:toolId` (and Acefone calls the executor in-process).
   - `apps/agent-v2/src/tools.ts` becomes a thin adapter: builds `llm.tool()` from the shared schema and POSTs to the executor.
   - Deletes ~600 duplicated lines.
3. **Per-agent config** (`Agent.toolConfig`): e.g. `live_inventory: { provider: "nexora", url, tokenRef }`. Env vars become fallbacks only.
4. **Rename `capture_demo_lead` → `save_outcome`** with `outcome` from the pack (keep `capture_demo_lead` as an alias for one release).
5. **`catalog_lookup` plugin**: client uploads CSV/JSON (SKU, name, category, price, attributes) → `CatalogItem` table → filter tool (category, budget range, attribute match). Use for CRM plans, car models, agri products — numbers come from rows, not from vector search.
6. **`Lead.details` JSON**: `save_outcome` writes pack fields there; `locationType` enum no longer grows per industry.

Acceptance criteria:

- Two hotel agents can point at two different inventory APIs.
- LiveKit and Acefone produce identical tool results for the same args (shared executor test).

### Phase 4 — Platform

1. `Organization` model; agents, leads, calls scoped to an org; per-org API keys and webhooks.
2. **Scenario test suite per pack**: 5–10 scripted callers per industry (text simulation through the turn policy + a mocked model), run in CI. Core skill changes must pass every pack.
3. **Intent detection**: replace Hinglish-only regex gates with pack-extendable patterns first, then a small fast classifier (optional) for defer-booking / angry / clear-intent.
4. Observability: per-pack dashboards — tool call rate, `found:false` rate for knowledge search, booking conversion.

---

## 5. Backward compatibility

- Existing agents keep working at every phase: `resolvePackForAgent` falls back to `booking.templateId` → pack, then `generic`.
- `capture_demo_lead` alias kept until all agents are re-saved.
- `Lead.location` / `locationType` stay readable; new writes also go to `details`.
- `agentRules` empty by default → no behaviour change until a client fills it.

## 6. Testing strategy

| Test | Where | Catches |
|---|---|---|
| Domain-word guard on core files | `packages/shared` | leaks back into Layer 1 |
| Prompt snapshot per pack | `packs/*.test.ts` | wrong fragment / missing rules |
| S2S compression keeps priority sections | `hinglish-gender.test.ts` (exists) | trimming regressions |
| Shared tool executor contract | `apps/api` | LiveKit vs Acefone drift |
| Scenario callers per pack | new `scenarios/` | behaviour regressions |

## 7. Open decisions

1. **Packs in code vs DB?** Recommended: code (reviewed prompt text + hooks), with per-agent overrides in DB.
2. **Agriculture outcome**: expert callback, field-officer visit, or both as `allowedBookingTypes`?
3. **Catalog source**: CSV upload in Studio, or pull from the client's API?
4. **Multi-tenant timing**: needed before onboarding the second external client, or later?

## 8. Suggested order and rough size

| Phase | Size | Depends on |
|---|---|---|
| 1. Domain-free core + agent rules + `say()` fix | ~3–4 days | — |
| 2. Pack concept + Studio picker + agri pack | ~4–5 days | Phase 1 |
| 3. Shared tool plugins + catalog + `Lead.details` | ~5–7 days | Phase 2 |
| 4. Org model + scenario suite | ~5+ days | Phase 3 |
