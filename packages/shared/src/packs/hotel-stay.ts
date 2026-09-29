import {
  compactHotelFactsForLlm,
  extractKnownHotelCityFromText,
  isNexoraHotelFactsConfigured,
  queryNexoraHotelFacts,
  textMentionsKnownHotelCity,
} from '../nexora-hotel-facts.js';
import type { PackTurnInput, VerticalPack } from './types.js';

const TOOL_RULES =
  `- lookup_hotel_availability — **required** when the caller names a clear **city** and/or **state**, and **again** when they add room/date. Progressive known: pass ONLY what they said (state → city → room_type → date). Never empty fields. English: मनाली→Manali, आगरा→Agra. Do NOT invent state when only city was said. Every new filter = a **new** tool call.\n` +
  `- **TOOL-FIRST:** On city/date/room filter turns, call the tool **immediately with no spoken audio first** (no date readback, no “That means check-in…”). Speak from tool \`say\` right after it returns — short, at most two rooms, then ask which suits them.\n` +
  `- **Progressive live call:** (1) state only → list cities from result, ask city; (2) city → property and room names, ask date or property; (3) room_type → names only; (4) date → call lookup with YYYY-MM-DD, then answer what they asked. Speak rupee rates only if they asked price, rate, budget, or discount. Speak from the latest tool result only.\n` +
  `- **Brain + live together:** Before saying a city has / does not have a property, check Product Knowledge AND live lookup. Existence and rates come from lookup; Brain adds sales vibe/policies only if they do not contradict live. NEVER deny a city from Product Knowledge alone. If fallback_to_brain:true, never deny; offer retry.\n` +
  `- **Vague place (not a clear city/state)** — landmark, area, “pahad”, “Taj ke paas”, “Laxman Jhula”, “koi sasta trip”, etc.: do **NOT** call lookup yet and do **NOT** invent rates. Act like a salesperson: (1) short acknowledge, (2) map to a nearby known city OR offer 2–3 city choices (e.g. Rishikesh / Pushkar / Manali), (3) after they pick a city, call lookup_hotel_availability. Never say a dry technical “inventory nahi hai” for an unclear place.\n` +
  `- **Sales tease OK, fake inventory NOT:** You may speak warmly about vibe (“premium / private / resort feel”) without dumping a full rate card. NEVER invent a room name, bed count, price, address, landmark, or travel time unless that exact text is in the latest lookup result or Product Knowledge. If the address field is empty, say you will check — never guess a circle, area, or minutes, and never say the location will come on WhatsApp.\n` +
  `- **Multi-property city (Hostel + Resort):** If the tool says multiple properties / asks which one — ask Hostel vs Resort (or named property). Do NOT pitch one property’s dorm rates as the whole city. After they pick Resort / premium / Suite, call lookup_hotel_availability **again** with hotel_name (e.g. "Resort" or full resort name) and room_type/room_name if they named a type. Speak only from that second result.`;

const S2S_RULES = [
  '- If the lookup_hotel_availability tool is available and they name a clear city and/or state, call it with ONLY what they said so far (progressive known: state → city → room_type → date); never empty fields.',
  '- **TOOL-FIRST (critical):** When you will call lookup_hotel_availability, invoke the tool **immediately with ZERO spoken audio first**. Never say the tool name, "(Call initiated: …)", "That means check-in…", or a weekday/month before the tool returns. Resolve relative dates silently into YYYY-MM-DD tool args.',
  '- **After lookup:** answer what they just asked, short, never silent. Location → property name and the address field only; if address is missing, say you will check — never guess a landmark, minutes, or a WhatsApp location. Room types → names only. Rupee rates only if they asked price, rate, budget, or discount.',
  '- **Once is enough (critical):** say a room list, property name, or check-in question one time. If you already said it, do not say it again in the next line. After they give a date, repeat that date once and ask which room — do not read the room list again.',
  '- **Haan / ji / bataiye is not a city:** that means they agreed to talk. Ask which city or state once and wait. Do not call lookup until they name one. Do not ask that question again.',
  '- **Brain + live:** Answer city existence only after live lookup. Product Knowledge = sales vibe/policies; live JSON = hai/nahi + rooms/prices. Never deny a city from Product Knowledge alone.',
  '- Every new filter (city / room / date) = a new lookup_hotel_availability call.',
  '- Do not invent/infer state when the caller only named a city.',
  '- Vague place (landmark/area/"pahad"/not a clear city): do NOT call lookup yet. Acknowledge → confirm nearest city or offer 2–3 city choices → then lookup. Never invent rates; never dump a technical inventory error.',
  '- Do not volunteer a destination city the caller has not named yet (except as short choices when clarifying a vague place).',
  '- After lookup_hotel_availability (or a LIVE LOOKUP SYSTEM note), speak from that result + Brain tone — do NOT invent "call later" or re-read the full room list; only clarify or ask which room/property.',
  '- If they ask the property/hostel name, private vs dorm, WhatsApp what to send, net price, facilities, smoking, or DJ/music — answer that first from the latest lookup or Product Knowledge. Do not ask name, phone, or advance on that turn.',
  '- **Commercial authority:** you have zero authority to discount, add a perk, upgrade a room, or approve late checkout or early check-in. Speak a concession only when Nexora returns one authorized offer. Do not choose, substitute, or combine benefits. If there is no authorized offer, promise nothing.',
  '- If they already gave a stay date this call, resolve it silently into the next lookup / capture — do not ask for the same date again.',
  '- If lookup_hotel_availability returns fallback_to_brain:true, never deny the city; never invent live beds/prices; offer retry/callback for rates.',
  '- **Late in the call:** before repeating rooms, rates, or a stay total, call lookup_hotel_availability again with the city and dates already agreed. Speak only from that fresh result — do not reuse an earlier list if a new lookup says a room is gone.',
  '- If a SYSTEM note already includes LIVE LOOKUP JSON for a city, speak from it this turn — do not contradict it from Brain memory.',
  '- For live hotel lookup, never audio-confirm dates before the tool — only after rates via `say` if needed.',
];

const END_CALL_RULES = [
  'If lookup_hotel_availability is available, call it for every clear city (and/or state) the caller names — progressive known: pass ONLY what they said so far (state → city → room_type → date), English city (मनाली→Manali, आगरा→Agra).',
  '**TOOL-FIRST (critical):** When calling lookup_hotel_availability, invoke the tool immediately with ZERO spoken audio first. Never say “That means check-in…”, never read back weekday/month before the tool returns. Resolve relative dates silently into YYYY-MM-DD args. Speak from tool say right after it returns — short, never silent.',
  '**Brain + live:** existence/rates from live lookup; sales vibe from Product Knowledge only if it does not contradict live. Never deny a city from Product Knowledge alone.',
  'Every new filter (city / room / date) = a new tool call. Never volunteer a destination city they did not name (except 2–3 short choices when clarifying a vague place).',
  'Vague place (landmark, area, “pahad”, “Taj ke paas”, not a clear city/state): do NOT call lookup yet. Salesperson style — acknowledge, map to nearest city or offer 2–3 city options, then lookup after they pick. Never invent rates; never say a dry “inventory nahi ho rahi” for an unclear place.',
  'Sales tease (vibe / premium feel) is OK; NEVER invent Suite, bed counts, prices, address, landmark, or minutes unless that exact text is in the latest lookup result. Missing address → say you will check.',
  'Multi-property city (Hostel + Resort): if the tool asks which property, ask — do NOT dump Hostel dorm rates as the whole city. After they pick Resort/premium/Suite, call lookup AGAIN with hotel_name (e.g. Resort) and room_type/room_name if named.',
  'If lookup_hotel_availability returns fallback_to_brain:true, never deny the city; still never invent live beds/prices; offer retry/callback for rates.',
  'If a SYSTEM note already has LIVE LOOKUP JSON for a city, speak from that JSON + Brain tone — do not say nahi hai from memory.',
  'Before capture_demo_lead for a stay, pass city and room_name when known — the server re-checks live inventory; if sold out, offer alternatives and do not say booking confirmed.',
  'After a stay is saved, do NOT end_call. Say room, dates, and that the payment link will go on WhatsApp, then wait until the caller says thank you, bye, or bas.',
];

function isStayCatalogAsk(text: string): boolean {
  return /\b(room|rooms|floor|floors|suite|suites|deluxe|standard|amenit(?:y|ies)|property|properties|hotel|hotels|hostel|resort|location|located|kahan|kahaan|kaunsa|kaunse|which\s+hotel|kitne\s+floor|particular\s+floor|city\s*(?:center|centre)|paas|nearby|availability|available|beach|beaches|sea\s*side|pahad|pahaad|hills?|hill\s*station|mountains?|samundar|jungle|trip|trek)\b|कमरे?|फ्लोर|होटल|हॉस्टल|रिज़?ॉर्ट|लोकेशन|कौन\s*स[ेा]|कहाँ|कितने\s*फ्लोर|उपलब्ध|पहाड़|बीच|समुंदर|समुद्र|हिल|जंगल|ट्रिप/i.test(
    text,
  );
}

/** Named stay city / "X mein hotel?" — must live-lookup every time, not brain alone. */
export function isCityHotelExistenceAsk(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (textMentionsKnownHotelCity(t)) return true;
  // Brand cue: "X mein Moustache hai?" — existence ask even without hotel/property word
  if (
    /(?:\b(?:moustache|mustache|mustach)\b|मस्टैच|मुस्टैच|मुस्टाच|मस्टाच).{0,30}(?:\bhai\b|है|\bkya\b|क्या|available|\bthere\b)/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(mein|me|in|at|par)\b.{0,40}\b(hotel|hostel|property|properties|stay|resort|branch)\b|\b(hotel|hostel|property|properties|stay|resort)\b.{0,40}\b(mein|me|in|at|hai\s*kya|available|kahan|kahaan|exact)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return /\b(hotel|hostel|property|stay).{0,24}(hai\s*kya|available|dekha|dekh\s*raha|dekh\s*rahi|exact)|होटल.{0,20}(है\s*क्या|कहाँ|उपलब्ध)|में\s*(है|नहीं)|exact\s*(hai|nahi)|एग्जैक्ट|exact/i.test(
    t,
  );
}

function buildCityHotelLookupNote(productName: string): string {
  return (
    `[SYSTEM: Caller named or asked about a clear city for ${productName}. ` +
    `You MUST check BOTH: (1) Product Knowledge for sales vibe/policies, (2) lookup_hotel_availability for existence + live rooms/prices. ` +
    `Call lookup_hotel_availability NOW with **city in English** (मनाली→Manali, आगरा→Agra, ऋषिकेश→Rishikesh). ` +
    `Every new city this call = a NEW tool call — never reuse a previous city answer. ` +
    `Speak after both sources: live JSON decides existence/rates; Brain may add warm sales context that does NOT contradict live. ` +
    `Do NOT say "nahi hai" / "property nahi" until ok:false WITHOUT fallback_to_brain. ` +
    `If fallback_to_brain:true, never deny the city; offer retry. ` +
    `If the place was vague (landmark/area/not a city), do NOT call yet — acknowledge, confirm nearest city or offer 2–3 choices, then lookup.]`
  );
}

function buildPrefetchedCityLookupNote(
  productName: string,
  city: string,
  compact: Record<string, unknown>,
): string {
  const payload = JSON.stringify(compact);
  return (
    `[SYSTEM: LIVE LOOKUP already completed for ${city} (${productName}). Result JSON: ${payload}. ` +
    `Answer NOW using BOTH: this live JSON + Product Knowledge. ` +
    `Existence / rooms / prices / "hai ya nahi" → ONLY from this JSON. ` +
    `Sales tone, vibe, policies → Product Knowledge OK if they do not contradict live. ` +
    `If ok:true → property EXISTS; never say nahi hai. Answer only what they asked: address only from the address field (if missing, say you will check — never guess), room names from rooms, rupee rates only if they asked price. ` +
    `If fallback_to_brain:true → never deny; say live check failed and offer retry. ` +
    `If ok:false without fallback → honest no live match + offer other cities. ` +
    `Do NOT invent Suite/rates. You may skip calling lookup again for ${city} this turn.]`
  );
}

function buildStayCatalogHelpFirstNote(productName: string): string {
  return (
    `[SYSTEM: Caller asked a product / catalog question about ${productName}. ` +
    `If they named a clear city (Hindi or English), you MUST call lookup_hotel_availability with English city first — every city, every time. ` +
    `If the place is vague (landmark/area/"pahad"/unclear), do NOT invent a city or rates — acknowledge, map to nearest city or offer 2–3 city choices, then lookup after they pick. ` +
    `Otherwise answer from Product Knowledge without inventing a destination city. ` +
    `Do NOT volunteer a destination city the caller has not named yet (except short clarify choices). ` +
    `Do NOT ask for name, phone, WhatsApp, or payment acknowledgment before answering. ` +
    `Do NOT deflect with "pehle details chahiye". Do NOT pitch booking / "details collect" this turn. ` +
    `One short useful answer from Brain; intake only after they clearly want to book.]`
  );
}

async function hotelTurnNote(input: PackTurnInput): Promise<string | null> {
  if (!input.answerFirst && isCityHotelExistenceAsk(input.text)) {
    const city = extractKnownHotelCityFromText(input.text);
    if (city && isNexoraHotelFactsConfigured()) {
      try {
        const live = await queryNexoraHotelFacts(city, { signal: AbortSignal.timeout(2_500) });
        return buildPrefetchedCityLookupNote(input.productName, city, compactHotelFactsForLlm(live));
      } catch {
        return buildCityHotelLookupNote(input.productName);
      }
    }
    return buildCityHotelLookupNote(input.productName);
  }
  if (isStayCatalogAsk(input.text)) return buildStayCatalogHelpFirstNote(input.productName);
  return null;
}

export const HOTEL_STAY_PACK: VerticalPack = {
  id: 'hotel_stay',
  label: 'Hotel live inventory',
  description: 'lookup_hotel_availability guidance + per-turn city prefetch (Nexora).',
  toolRules: TOOL_RULES,
  s2sRules: S2S_RULES,
  endCallRules: END_CALL_RULES,
  turnNote: hotelTurnNote,
};
