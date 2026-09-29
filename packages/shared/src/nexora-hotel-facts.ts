/**
 * Nexora intelligence facts/query — live property inventory (Hotel `known`, progressive).
 * Product-agnostic: no brand-specific skill copy. Policies come from API when present.
 */

export type NexoraHotelRoomSummary = {
  room_id: string;
  room_name: string;
  room_type?: string;
  available_beds: number;
  price_per_night: number;
  discount_pct: number;
};

/** Property-level facts from the live API (when the index has them). */
export type NexoraPropertyPolicies = {
  check_in?: string;
  check_out?: string;
  cancellation?: string;
  house_rules?: string;
  payment?: string;
  id_policy?: string;
  amenities?: string;
};

export type NexoraHotelFactsSummary = {
  ok: true;
  hotel_name: string;
  hotel_id?: string;
  property_type?: string;
  city?: string;
  state?: string;
  address?: string;
  discount_pct?: number;
  policies: NexoraPropertyPolicies;
  rooms: NexoraHotelRoomSummary[];
  /** Other matched properties in the same city (name + type). */
  other_properties?: { hotel_name: string; property_type?: string; hotel_id?: string }[];
  spoken_hint: string;
  /** Short line for forced TTS on live calls (1–2 sentences). */
  speak_now: string;
  latency_ms?: number;
};

export type NexoraHotelFactsError = {
  ok: false;
  error: string;
  hint?: string;
  /** Optional short line the agent should speak (honest empty-inventory). */
  say?: string;
  /**
   * Live inventory API/infra failed (network, HTTP, config).
   * Caller may answer from Product Knowledge — never invent live beds/prices.
   */
  fallback_to_brain?: boolean;
};

const MISSING_PLACE_ERROR = 'city or state is required';
/** Spoken only if the agent has not already asked. A second lookup reply is dropped in the voice guard. */
const MISSING_PLACE_SAY =
  'Kaunsi city ya state mein stay plan hai?';
const MISSING_PLACE_HINT =
  'No city or state was given. If you already asked which city or state, stay silent. Otherwise ask once and wait. Do not call lookup again until they name one.';

const BRAIN_FALLBACK_HINT =
  'Live inventory check failed (API). You may share Product Knowledge for cities/properties that ARE listed there. ' +
  'NEVER say a city has no property / "nahi hai" from Product Knowledge or memory — only after lookup_hotel_availability returns ok:false without fallback_to_brain. ' +
  'Do NOT invent live beds, prices, sold-out, or policies. One short useful line; offer to retry the live check or take a callback for exact rates.';

type RelatedRow = {
  identity?: Record<string, unknown>;
  facts?: Record<string, unknown>;
};

/** Fields requested from Nexora facts/query (keep in sync with live index schema). */
export const NEXORA_HOTEL_SELECT_FIELDS = [
  'room_id',
  'room_name',
  'room_type',
  'available_rooms_beds',
  'price_per_night',
  'Date',
  'discount',
  'hotel_id',
  'Address',
  'check_in',
  'check_out',
  'adress',
  
] as const;

function envUrl(): string {
  return (
    process.env.NEXORA_FACTS_QUERY_URL?.trim() ||
    process.env.NEXORA_HOTEL_FACTS_URL?.trim() ||
    ''
  );
}

function envToken(): string {
  return (
    process.env.NEXORA_FACTS_QUERY_TOKEN?.trim() ||
    process.env.NEXORA_INGEST_TOKEN?.trim() ||
    process.env.CALL_COMPLETED_WEBHOOK_TOKEN?.trim() ||
    ''
  );
}

export function isNexoraHotelFactsConfigured(): boolean {
  return Boolean(envUrl() && envToken());
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) {
    const parts = v.map((x) => asString(x)).filter(Boolean) as string[];
    if (parts.length) return parts.join('; ');
  }
  if (v && typeof v === 'object') {
    try {
      return JSON.stringify(v).slice(0, 400);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/,/g, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function firstString(bag: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const s = asString(bag[k]);
    if (s) return s;
  }
  const lower = new Map(Object.keys(bag).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (!real) continue;
    const s = asString(bag[real]);
    if (s) return s;
  }
  return undefined;
}

/**
 * Geographic / STT aliases only (not product skills). Maps regions → city tokens for match.city.
 * Devanagari: do not use \b — JS word boundaries only apply to [A-Za-z0-9_].
 * `cities[0]` is the English canonical name; `state` is English for match.state.
 */
const REGION_CITY_ALIASES: Array<{ match: RegExp; cities: string[]; state: string }> = [
  { match: /\bsikkim\b/i, cities: ['Pelling'], state: 'Sikkim' },
  { match: /\bpelling\b|पेलिंग/i, cities: ['Pelling'], state: 'Sikkim' },
  { match: /\bjaipur\b|जयपुर/i, cities: ['Jaipur'], state: 'Rajasthan' },
  { match: /\budaipur\b|उदयपुर/i, cities: ['Udaipur'], state: 'Rajasthan' },
  { match: /\bvaranasi\b|\bvarnasi\b|\bbanaras\b|\bbenaras\b|\bkashi\b|काशी|वाराणसी|बनारस/i, cities: ['Varanasi'], state: 'Uttar Pradesh' },
  { match: /\bdehradun\b|\bdehra\s*dun\b|देहरादून/i, cities: ['Dehradun'], state: 'Uttarakhand' },
  { match: /\bgoa\b|गो[ाअ]वा?/i, cities: ['Goa'], state: 'Goa' },
  { match: /\bmanali\b|मनाली|मनालि/i, cities: ['Manali'], state: 'Himachal Pradesh' },
  { match: /\brishikesh\b|\bhrishikesh\b|ऋषिकेश|रिशिकेश/i, cities: ['Rishikesh'], state: 'Uttarakhand' },
  { match: /\bmussoorie\b|\bmasuri\b|\bmussoori\b|\bmasoorie\b|मसूरी/i, cities: ['Mussoorie'], state: 'Uttarakhand' },
  { match: /\bagra\b|आगरा/i, cities: ['Agra'], state: 'Uttar Pradesh' },
  { match: /\bjodhpur\b|जोधपुर/i, cities: ['Jodhpur'], state: 'Rajasthan' },
  { match: /\bpushkar\b|पुष्कर/i, cities: ['Pushkar'], state: 'Rajasthan' },
  { match: /\bnaukuchiatal\b|\bnainital\b|नौकुचियाताल|नैनीताल|नैनिताल/i, cities: ['Naukuchiatal', 'Nainital'], state: 'Uttarakhand' },
  { match: /\bbhubaneswar\b|\bbhubaneshwar\b|भुवनेश्वर/i, cities: ['Bhubaneswar'], state: 'Odisha' },
  { match: /\bsiliguri\b|सिलीगुड़ी|सिलीगुडी/i, cities: ['Siliguri'], state: 'West Bengal' },
  { match: /\bdharamshala\b|\bdharamsala\b|धर्मशाला/i, cities: ['Dharamshala'], state: 'Himachal Pradesh' },
  { match: /\bkoksar\b|\bkoxsar\b|\bkhoksar\b|\bkhobsar\b|कोक्सर|खोक्सर|खोबसर/i, cities: ['Koksar'], state: 'Himachal Pradesh' },
  // Himachal
  { match: /\bshimla\b|\bsimla\b|शिमला|सिमला/i, cities: ['Shimla'], state: 'Himachal Pradesh' },
  { match: /\bkasol\b|कसोल|कसोल/i, cities: ['Kasol'], state: 'Himachal Pradesh' },
  { match: /\bjibhi\b|\bjibi\b|जीभी|जिभी/i, cities: ['Jibhi'], state: 'Himachal Pradesh' },
  { match: /\btirthan(?:\s*valley)?\b|तीर्थन|तिर्थन/i, cities: ['Tirthan Valley'], state: 'Himachal Pradesh' },
  { match: /\bshoja\b|शोजा/i, cities: ['Shoja'], state: 'Himachal Pradesh' },
  { match: /\bmc\s*leod\s*ganj\b|\bmcleodganj\b|\bmacleodganj\b|मैक्लोडगंज|मक्लोडगंज|मैकलोडगंज/i, cities: ['Mcleodganj'], state: 'Himachal Pradesh' },
  { match: /\bdharamkot\b|धर्मकोट/i, cities: ['Dharamkot'], state: 'Himachal Pradesh' },
  { match: /\bbir(?:\s*billing)?\b|बीर(?:\s*बिलिंग)?/i, cities: ['Bir'], state: 'Himachal Pradesh' },
  // Uttarakhand
  { match: /\bharidwar\b|\bhardwar\b|हरिद्वार|हरद्वार/i, cities: ['Haridwar'], state: 'Uttarakhand' },
  { match: /\bbhimtal\b|भीमताल/i, cities: ['Bhimtal'], state: 'Uttarakhand' },
  { match: /\bkausani\b|कौसानी/i, cities: ['Kausani'], state: 'Uttarakhand' },
  { match: /\balmora\b|अल्मोड़ा|अल्मोरा/i, cities: ['Almora'], state: 'Uttarakhand' },
  // Rajasthan
  { match: /\bmount\s*abu\b|\bmt\.?\s*abu\b|माउंट\s*आबू|माउण्ट\s*आबू/i, cities: ['Mount Abu'], state: 'Rajasthan' },
  // Kerala
  { match: /\bmunnar\b|मुन्नार/i, cities: ['Munnar'], state: 'Kerala' },
  { match: /\balleppey\b|\balappuzha\b|\balleppy\b|अलेप्पी|अलप्पुझा/i, cities: ['Alleppey'], state: 'Kerala' },
  // Odisha
  // "puri" is also Hinglish for "full" (puri details) — only match as a place.
  {
    match:
      /\bjagannath\s*puri\b|\bpuri\s*odisha\b|\bpuri\b(?=\s+(?:mein|me|main|jaana|jana|jaayenge|jayenge|ghumne|ghoomne|trip|beach|hotel|hostel|property|ki|ka|ke)\b)|पुरी(?=\s*(?:में|ओडिशा|जाना|घूम|होटल|बीच|की|का|के))|जगन्नाथ\s*पुरी/i,
    cities: ['Puri'],
    state: 'Odisha',
  },
  // Madhya Pradesh
  { match: /\bkhajuraho\b|खजुराहो/i, cities: ['Khajuraho'], state: 'Madhya Pradesh' },
  // Delhi
  { match: /\bdelhi\b|\bdilli\b|\bnew\s*delhi\b|दिल्ली|नई\s*दिल्ली/i, cities: ['Delhi'], state: 'Delhi' },
];

/** English state aliases (Hindi/STT → Nexora match.state). */
const STATE_ALIASES: Array<{ match: RegExp; state: string }> = [
  { match: /\buttarakhand\b|\buttaranchal\b|उत्तराखंड|उत्तराखण्ड|उत्तरांचल/i, state: 'Uttarakhand' },
  { match: /\bhimachal(?:\s+pradesh)?\b|\bhp\b|हिमाचल(?:\s*प्रदेश)?/i, state: 'Himachal Pradesh' },
  { match: /\brajasthan\b|राजस्थान/i, state: 'Rajasthan' },
  { match: /\buttar\s*pradesh\b|\bup\b|उत्तर\s*प्रदेश/i, state: 'Uttar Pradesh' },
  { match: /\bsikkim\b|सिक्किम/i, state: 'Sikkim' },
  { match: /\bgoa\b|गो[ाअ]वा?/i, state: 'Goa' },
  { match: /\bodisha\b|\borissa\b|ओडिशा|उड़ीसा/i, state: 'Odisha' },
  { match: /\bwest\s*bengal\b|\bbengal\b|पश्चिम\s*बंगाल|बंगाल/i, state: 'West Bengal' },
  { match: /\bkerala\b|केरल|केरला/i, state: 'Kerala' },
  { match: /\bmadhya\s*pradesh\b|\bmp\b|मध्य\s*प्रदेश/i, state: 'Madhya Pradesh' },
  { match: /\bdelhi\b|\bncr\b|दिल्ली/i, state: 'Delhi' },
];

const CITY_TO_STATE: Record<string, string> = Object.fromEntries(
  REGION_CITY_ALIASES.flatMap((a) => a.cities.map((c) => [c.toLowerCase(), a.state] as const)),
);

function isLatinCityToken(s: string): boolean {
  return /^[A-Za-z][A-Za-z .'-]*$/.test(s.trim());
}

/** True when utterance mentions a known property-city alias (Latin or Devanagari). */
export function textMentionsKnownHotelCity(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return REGION_CITY_ALIASES.some((a) => a.match.test(t));
}

/** First known city mentioned in caller text (English canonical), if any. */
export function extractKnownHotelCityFromText(raw: string): string | undefined {
  return extractKnownHotelCitiesFromText(raw)[0];
}

/** Every known city in the text, in mention order. English canonical names. */
export function extractKnownHotelCitiesFromText(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  const hits: { index: number; cities: string[] }[] = [];
  for (const alias of REGION_CITY_ALIASES) {
    const flags = alias.match.flags.replace('g', '');
    const found = new RegExp(alias.match.source, flags).exec(t);
    if (found && alias.cities.length) hits.push({ index: found.index, cities: alias.cities });
  }
  hits.sort((a, b) => a.index - b.index);
  const out: string[] = [];
  for (const hit of hits) {
    for (const city of hit.cities) {
      if (!out.some((x) => x.toLowerCase() === city.toLowerCase())) out.push(city);
    }
  }
  return out;
}

/**
 * Map Hindi/STT/branded city text → English canonical city for Nexora match.city.
 * Always prefer Latin script (e.g. मनाली → Manali).
 */
export function canonicalizeHotelCityForApi(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return '';
  for (const alias of REGION_CITY_ALIASES) {
    if (alias.match.test(name) && alias.cities[0]) {
      return alias.cities[0]!;
    }
  }
  const candidates = cityQueryCandidates(name);
  const latin = candidates.find(isLatinCityToken);
  if (latin) return latin;
  const englishOnly = name.match(/[A-Za-z][A-Za-z .'-]{1,40}/)?.[0]?.trim();
  return englishOnly || name;
}

/**
 * Map Hindi/STT state (or infer from English city) → English canonical state for Nexora match.state.
 */
export function canonicalizeHotelStateForApi(
  stateRaw?: string | null,
  cityEnglish?: string | null,
): string {
  const raw = (stateRaw ?? '').trim().replace(/\s+/g, ' ');
  if (raw) {
    for (const alias of STATE_ALIASES) {
      if (alias.match.test(raw)) return alias.state;
    }
    const latin = raw.match(/[A-Za-z][A-Za-z .'-]{1,40}/)?.[0]?.trim();
    if (latin) {
      const known = CITY_TO_STATE[latin.toLowerCase()];
      // If they passed a city name as "state", ignore — fall through to city lookup
      if (!known && /^[A-Za-z]/.test(latin)) {
        for (const alias of STATE_ALIASES) {
          if (alias.match.test(latin)) return alias.state;
        }
        // Title-case multi-word English state as-is when already Latin
        if (/\b(pradesh|bengal|nadu|khand)\b/i.test(latin) || STATE_ALIASES.some((a) => a.state.toLowerCase() === latin.toLowerCase())) {
          const exact = STATE_ALIASES.find((a) => a.state.toLowerCase() === latin.toLowerCase());
          return exact?.state ?? latin;
        }
      }
    }
  }
  const city = (cityEnglish ?? '').trim();
  if (city) {
    const fromCity = CITY_TO_STATE[city.toLowerCase()];
    if (fromCity) return fromCity;
    for (const alias of REGION_CITY_ALIASES) {
      if (alias.match.test(city)) return alias.state;
    }
  }
  return '';
}

/**
 * Resolve English city / state for Nexora match.
 * - City asked → city only (do NOT auto-fill state)
 * - State asked → state only
 * - Both asked → both
 */
export function resolveHotelMatchForApi(opts: {
  city?: string | null;
  state?: string | null;
  hotel_name?: string | null;
}): { city: string; state?: string } {
  const askedCity = String(opts.city?.trim() || opts.hotel_name?.trim() || '');
  const askedState = String(opts.state?.trim() || '');
  const city = askedCity ? canonicalizeHotelCityForApi(askedCity) || askedCity : '';
  // Only include state when the caller/tool explicitly provided it — never infer into match.
  const state = askedState ? canonicalizeHotelStateForApi(askedState) || askedState : '';
  if (city && state) return { city, state };
  if (city) return { city };
  if (state) return { city: '', state };
  return { city: '' };
}

/** Non-empty unique strings for Nexora match arrays (never send ""). */
export function toNexoraMatchArray(
  value?: string | string[] | null,
): string[] | undefined {
  const raw = Array.isArray(value) ? value : value != null ? [value] : [];
  const out: string[] = [];
  for (const item of raw) {
    const t = String(item ?? '').trim();
    if (!t) continue;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.length ? out : undefined;
}

/**
 * Build Nexora `match` object (legacy Room index).
 * Prefer {@link buildNexoraHotelKnown} for the live Hotel facts/query API.
 * Never includes empty strings.
 */
export function buildNexoraHotelMatch(opts: {
  city?: string | string[] | null;
  state?: string | string[] | null;
}): Record<string, string[]> {
  const match: Record<string, string[]> = {};
  const cities = toNexoraMatchArray(opts.city);
  const states = toNexoraMatchArray(opts.state);
  if (cities) match.city = cities;
  if (states) match.state = states;
  return match;
}

/** Progressive stay filters for Nexora Hotel `known` (Postman shape — always all keys). */
export type NexoraHotelKnown = {
  state?: string | null;
  /** One city or several. Sent as a string[] when any city is set. */
  city?: string | string[] | null;
  date?: string | null;
  /** One room name, several names, or a cart string ("A + 2x B + C"). */
  room_type?: string | string[] | null;
  price_per_night?: string | number | null;
};

/**
 * Payload sent to Nexora facts/query `known`.
 * `city` is "" or a non-empty string[]. `room_type` is "" or a non-empty string[].
 */
export type NexoraHotelKnownPayload = {
  state: string;
  city: string | string[];
  date: string;
  room_type: string | string[];
  price_per_night: string;
};

/**
 * Split spoken/tool room carts into distinct room type names for Nexora `known.room_type`.
 * Handles arrays, commas, "+", "and"/"aur", and quantity prefixes like "2x" / "do ".
 * Dedupes by normalized name (order preserved).
 *
 * @example
 * parseStayRoomTypeList('6 Bed Mixed Dorm + 2x 4 Bed Mixed Dorm + Female Dorm + 2x Private Double Room')
 * // → ['6 Bed Mixed Dorm', '4 Bed Mixed Dorm', 'Female Dorm', 'Private Double Room']
 */
export function parseStayRoomTypeList(
  input?: string | string[] | null,
): string[] {
  if (input == null) return [];
  const rawParts: string[] = [];
  const pushChunks = (s: string) => {
    const t = s.trim();
    if (!t) return;
    for (const chunk of t.split(/\s*(?:\+|\/|,|;|\band\b|\baur\b)\s*/i)) {
      const c = chunk.trim();
      if (c) rawParts.push(c);
    }
  };
  if (Array.isArray(input)) {
    for (const item of input) pushChunks(String(item ?? ''));
  } else {
    pushChunks(String(input));
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of rawParts) {
    // Strip qty only: "2x …", "2 x …", "do/teen/ek …" — never strip leading digits of "6 Bed…"
    const cleaned = part
      .replace(/^\d+\s*[x×]\s*/i, '')
      .replace(
        /^(?:do|teen|ek|one|two|three)\s+(?=(?:\d+\s*bed|private|female|mixed|dorm|suite|deluxe))/i,
        '',
      )
      .trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/**
 * Build Nexora Hotel `known` object matching the live Postman / curl contract:
 * always includes state, city, date, room_type, price_per_night.
 * `city` is "" when unknown, otherwise a non-empty string[] (one or many).
 * `room_type` is "" when unknown, otherwise a non-empty string[] of exact room names.
 */
export function buildNexoraHotelKnown(opts: NexoraHotelKnown): NexoraHotelKnownPayload {
  const norm = (value?: string | number | null): string => {
    if (value == null) return '';
    return String(value).trim();
  };
  const rooms = parseStayRoomTypeList(opts.room_type);
  const cities = toNexoraMatchArray(opts.city);
  return {
    state: norm(opts.state),
    city: cities ?? '',
    date: norm(opts.date),
    room_type: rooms.length === 0 ? '' : rooms,
    price_per_night: norm(opts.price_per_night),
  };
}

/** True when at least one known filter is non-empty. */
export function hasNexoraHotelKnownFilter(known: NexoraHotelKnownPayload): boolean {
  return Object.values(known).some((v) => {
    if (Array.isArray(v)) return v.some((x) => Boolean(String(x ?? '').trim()));
    return Boolean(String(v ?? '').trim());
  });
}

/** Ordered unique city candidates for Nexora match.city — English canonical first. */
export function cityQueryCandidates(raw: string): string[] {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return [];
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim().replace(/\s+/g, ' ');
    if (!t) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  // Alias English cities first so API always races Latin names
  for (const alias of REGION_CITY_ALIASES) {
    if (alias.match.test(name)) {
      for (const c of alias.cities) push(c);
    }
  }

  push(name);

  // "Brand City" → also try remainder + last token (no brand hardcode)
  const multi = name.match(/^(\S+)\s+(.+)$/);
  if (multi?.[2]) {
    push(multi[2]);
    const last = multi[2].split(/\s+/).pop();
    if (last) push(last);
  }

  // Stable: Latin tokens before Devanagari / mixed
  out.sort((a, b) => Number(isLatinCityToken(b)) - Number(isLatinCityToken(a)));
  return out;
}

/** @deprecated use cityQueryCandidates */
export function hotelNameQueryCandidates(raw: string): string[] {
  return cityQueryCandidates(raw);
}

function modeNumber(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0]!;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v < best)) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** True when the row has a real live rate (browse mode often omits price). */
export function roomHasLiveRate(room: Pick<NexoraHotelRoomSummary, 'price_per_night'>): boolean {
  return Number.isFinite(room.price_per_night) && room.price_per_night > 0;
}

function collectRoomsFromFactBags(
  bags: Record<string, unknown>[],
): NexoraHotelRoomSummary[] {
  type Acc = {
    room_id: string;
    room_name: string;
    room_type?: string;
    beds: number[];
    prices: number[];
    discounts: number[];
  };
  const byId = new Map<string, Acc>();

  for (const facts of bags) {
    const roomName =
      asString(facts.room_name) ||
      asString(facts.room_type) ||
      asString(facts.Room_Type) ||
      asString(facts['Room Type']) ||
      asString(facts.name);
    if (!roomName) continue;
    const roomId =
      asString(facts.room_id) ||
      asString(facts.Room_ID) ||
      `type:${normalizeStayRoomKey(roomName)}`;
    // Nexora browse/availability packs may use price / available instead of *_per_night / beds.
    const beds =
      asNumber(facts.available_rooms_beds) ??
      asNumber(facts.available) ??
      asNumber(facts.available_beds) ??
      asNumber(facts.free) ??
      asNumber(facts.beds);
    const price =
      asNumber(facts.price_per_night) ??
      asNumber(facts.price) ??
      asNumber(facts.Price) ??
      asNumber(facts.rate);
    const discount =
      asNumber(facts.discount) ??
      asNumber(facts['Discount (%)']) ??
      asNumber(facts.discount_pct) ??
      asNumber(facts.Discount);
    const roomType = asString(facts.room_type);

    let acc = byId.get(roomId);
    if (!acc) {
      acc = { room_id: roomId, room_name: roomName, room_type: roomType, beds: [], prices: [], discounts: [] };
      byId.set(roomId, acc);
    } else {
      if (!acc.room_type && roomType) acc.room_type = roomType;
      if (roomName.length > acc.room_name.length) acc.room_name = roomName;
    }
    if (beds != null) acc.beds.push(beds);
    if (price != null) acc.prices.push(price);
    if (discount != null) acc.discounts.push(discount);
  }

  return [...byId.values()]
    .map((acc): NexoraHotelRoomSummary | null => {
      const price = modeNumber(acc.prices);
      // Browse mode (city-only): room names without beds/prices — still surface the list.
      const beds = acc.beds.length
        ? Math.max(...acc.beds)
        : 1;
      const discount = modeNumber(acc.discounts) ?? 0;
      if (!acc.room_name.trim()) return null;
      return {
        room_id: acc.room_id,
        room_name: acc.room_name,
        ...(acc.room_type ? { room_type: acc.room_type } : {}),
        available_beds: beds,
        // 0 = listed in browse mode, live rate unknown — do not invent a price.
        price_per_night: price ?? 0,
        discount_pct: discount,
      };
    })
    .filter((r): r is NexoraHotelRoomSummary => r != null)
    .sort((a, b) => {
      // Priced rooms first (asc), then browse-only names.
      const ap = roomHasLiveRate(a) ? a.price_per_night : Number.POSITIVE_INFINITY;
      const bp = roomHasLiveRate(b) ? b.price_per_night : Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
      return a.room_name.localeCompare(b.room_name);
    });
}

function collectRoomsFromRelated(related: RelatedRow[]): NexoraHotelRoomSummary[] {
  return collectRoomsFromFactBags(
    related.map((row) => ({ ...(row.identity ?? {}), ...(row.facts ?? {}) })),
  );
}

/** Rooms from related rows, or Hotel identity/facts when related is empty. */
function collectRoomsFromMatchRow(row: Record<string, unknown>): NexoraHotelRoomSummary[] {
  const relatedRows = Array.isArray(row.related) ? (row.related as RelatedRow[]) : [];
  const fromRelated = collectRoomsFromRelated(relatedRows);
  if (fromRelated.length) return fromRelated;
  const identity = (row.identity ?? {}) as Record<string, unknown>;
  const facts = (row.facts ?? {}) as Record<string, unknown>;
  return collectRoomsFromFactBags([{ ...identity, ...facts }]);
}

function extractPolicies(
  identity: Record<string, unknown>,
  chosenFacts: Record<string, unknown> | undefined,
  related?: RelatedRow[],
): NexoraPropertyPolicies {
  const fromRelated: Record<string, unknown> = {};
  if (related?.length) {
    const first = related[0]!;
    Object.assign(fromRelated, first.identity ?? {}, first.facts ?? {});
  }
  // Related room rows often hold check_in/out; hotel facts may be empty.
  const bag = { ...fromRelated, ...(chosenFacts ?? {}), ...identity };
  const check_in = firstString(bag, [
    'Check-in',
    'check_in',
    'checkin_time',
    'checkin',
    'Check_In',
    'check_in_time',
  ]);
  const check_out = firstString(bag, [
    'Check-out',
    'check_out',
    'checkout_time',
    'checkout',
    'Check_Out',
    'check_out_time',
  ]);
  const cancellation = firstString(bag, [
    'cancellation',
    'cancellation_policy',
    'cancel_policy',
    'Cancellation',
  ]);
  const house_rules = firstString(bag, ['house_rules', 'house_rule', 'rules', 'House_Rules']);
  const payment = firstString(bag, [
    'payment',
    'payment_policy',
    'advance',
    'advance_pct',
    'deposit',
    'Payment',
  ]);
  const id_policy = firstString(bag, ['id_policy', 'id_proof', 'ID_Policy', 'documents']);
  const amenities = firstString(bag, ['amenities', 'facilities', 'Amenities', 'Facilities']);
  const policies: NexoraPropertyPolicies = {};
  if (check_in) policies.check_in = check_in;
  if (check_out) policies.check_out = check_out;
  if (cancellation) policies.cancellation = cancellation;
  if (house_rules) policies.house_rules = house_rules;
  if (payment) policies.payment = payment;
  if (id_policy) policies.id_policy = id_policy;
  if (amenities) policies.amenities = amenities;
  return policies;
}

function policyHintBits(policies: NexoraPropertyPolicies): string {
  const bits: string[] = [];
  if (policies.check_in || policies.check_out) {
    bits.push(
      `Check-in/out: ${[policies.check_in, policies.check_out].filter(Boolean).join(' / ')}`,
    );
  }
  if (policies.cancellation) bits.push(`Cancel: ${policies.cancellation.slice(0, 120)}`);
  if (policies.payment) bits.push(`Payment: ${policies.payment.slice(0, 100)}`);
  if (policies.house_rules) bits.push(`Rules: ${policies.house_rules.slice(0, 100)}`);
  if (policies.id_policy) bits.push(`ID: ${policies.id_policy.slice(0, 80)}`);
  if (!bits.length) {
    return ' Policy fields not in live payload — use Product Knowledge only for cancel/check-in/rules if listed there; never invent.';
  }
  return ` ${bits.join('. ')}. Prefer these live policy fields over Product Knowledge when answering.`;
}

/** Optional hints when Nexora returns multiple properties in one city. */
export type NexoraMatchPrefer = {
  /** e.g. "Moustache Rishikesh Resort" or "Resort" */
  hotel?: string;
  /** e.g. "Suite" → prefer property that has Premium Suite */
  room?: string;
  /**
   * Multi-room carts (e.g. Female Dorm + Premium Suite across Hostel + Resort).
   * When set with 2+ names, inventory is merged from every match that covers a wanted room.
   */
  rooms?: string[];
};

function identityPreferBoost(
  identity: Record<string, unknown>,
  rooms: NexoraHotelRoomSummary[],
  prefer?: NexoraMatchPrefer,
): number {
  if (!prefer) return 0;
  let boost = 0;
  const hotelHint = normalizeStayRoomKey(prefer.hotel ?? '');
  const roomHint = normalizeStayRoomKey(prefer.room ?? '');
  const name = normalizeStayRoomKey(asString(identity.hotel_name) ?? '');
  const ptype = normalizeStayRoomKey(asString(identity.property_type) ?? '');
  const bag = `${name} ${ptype}`.trim();

  if (hotelHint) {
    if (ptype && (ptype === hotelHint || hotelHint.includes(ptype) || ptype.includes(hotelHint))) {
      boost += 1000;
    }
    for (const token of ['resort', 'hostel', 'hotel', 'cafe', 'homestay', 'villa']) {
      if (hotelHint.includes(token) && bag.includes(token)) {
        boost += 1000;
        break;
      }
    }
    if (name && (name.includes(hotelHint) || hotelHint.includes(name))) {
      boost += 200;
    }
  }

  if (roomHint && prefer.room && matchStayRoom(rooms, prefer.room)) {
    boost += 500;
  }
  return boost;
}

/** Collapse noisy related[] rows (same room_id many times with drifting prices). */
export function summarizeNexoraHotelFactsPayload(
  payload: unknown,
  prefer?: NexoraMatchPrefer,
): NexoraHotelFactsSummary | NexoraHotelFactsError {
  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      error: 'Empty hotel facts response',
      hint: BRAIN_FALLBACK_HINT,
      fallback_to_brain: true,
    };
  }
  const root = payload as Record<string, unknown>;
  const matches = Array.isArray(root.matches) ? root.matches : [];
  if (!matches.length) {
    return {
      ok: false,
      error: 'No hotel match',
      hint:
        'Nexora returned no_rows_matched for this city. Tell the caller honestly that live inventory for this city is not showing right now — do NOT invent hotel names, do NOT claim properties exist from Product Knowledge. Offer to try another city or take a callback for confirmation.',
      say:
        'Is naam se live city match nahi mila. Kaunsi city ke around dekhna hai — jaise Rishikesh, Pushkar, ya Manali? Bataiye, main check karti hoon.',
    };
  }

  // Prefer usable inventory; when caller named a property/room, boost that match
  // (avoids Hostel default when they asked Resort + Suite).
  type ScoredMatch = {
    row: Record<string, unknown>;
    rooms: NexoraHotelRoomSummary[];
    score: number;
    hasPreferredRoom: boolean;
  };
  const wantedPreferRooms = parseStayRoomTypeList(
    prefer?.rooms?.length ? prefer.rooms : prefer?.room,
  );
  const primaryRoomHint = wantedPreferRooms[0] ?? prefer?.room;
  const scoredMatches: ScoredMatch[] = [];
  for (const m of matches) {
    const row = m as Record<string, unknown>;
    const scored = collectRoomsFromMatchRow(row);
    const identity = (row.identity ?? {}) as Record<string, unknown>;
    const hasPreferredRoom = Boolean(
      primaryRoomHint && matchStayRoom(scored, primaryRoomHint),
    );
    scoredMatches.push({
      row,
      rooms: scored,
      score:
        scored.length +
        identityPreferBoost(
          identity,
          scored,
          prefer
            ? { ...prefer, room: primaryRoomHint ?? prefer.room }
            : undefined,
        ),
      hasPreferredRoom,
    });
  }

  let chosen: Record<string, unknown> = matches[0] as Record<string, unknown>;
  let chosenRooms: NexoraHotelRoomSummary[] = scoredMatches[0]?.rooms ?? [];
  let crossPropertyCart = false;

  // Multi-room cart spanning Hostel + Resort: merge rooms from covering matches
  // (Postman returns both; single-property pick used to drop Suite when prefer=Female Dorm).
  if (wantedPreferRooms.length > 1) {
    const allOnOne = scoredMatches.find((s) =>
      wantedPreferRooms.every((w) => Boolean(matchStayRoom(s.rooms, w))),
    );
    if (allOnOne) {
      chosen = allOnOne.row;
      chosenRooms = allOnOne.rooms;
    } else {
      const merged: NexoraHotelRoomSummary[] = [];
      const usedRows: Record<string, unknown>[] = [];
      let covered = true;
      for (const w of wantedPreferRooms) {
        const cover = scoredMatches.find((s) => matchStayRoom(s.rooms, w));
        const room = cover ? matchStayRoom(cover.rooms, w) : undefined;
        if (!cover || !room) {
          covered = false;
          break;
        }
        if (!merged.some((r) => r.room_id === room.room_id)) merged.push(room);
        if (!usedRows.includes(cover.row)) usedRows.push(cover.row);
      }
      if (covered && merged.length === wantedPreferRooms.length) {
        crossPropertyCart = true;
        chosen = usedRows[0] ?? chosen;
        chosenRooms = merged;
      } else {
        // Fall through to single-room prefer lock on first hint
        const roomLocked = primaryRoomHint
          ? scoredMatches.filter((s) =>
              Boolean(matchStayRoom(s.rooms, primaryRoomHint)),
            )
          : [];
        const pool = roomLocked.length ? roomLocked : scoredMatches;
        let bestScore = -1;
        for (const s of pool) {
          if (s.score > bestScore) {
            bestScore = s.score;
            chosen = s.row;
            chosenRooms = s.rooms;
          }
        }
      }
    }
  } else {
    // Hard lock: if any match has the requested room type, never pick a property without it.
    const roomLocked = primaryRoomHint
      ? scoredMatches.filter((s) => s.hasPreferredRoom)
      : [];
    const pool = roomLocked.length ? roomLocked : scoredMatches;
    let bestScore = -1;
    for (const s of pool) {
      if (s.score > bestScore) {
        bestScore = s.score;
        chosen = s.row;
        chosenRooms = s.rooms;
      }
    }
    if (bestScore < 0 && pool[0]) {
      chosen = pool[0].row;
      chosenRooms = pool[0].rooms;
    }
  }

  const identity = (chosen.identity ?? {}) as Record<string, unknown>;
  const chosenFacts = chosen.facts as Record<string, unknown> | undefined;
  const related = Array.isArray(chosen.related) ? (chosen.related as RelatedRow[]) : [];
  const rooms = chosenRooms;
  const address =
    firstString(identity, ['Address', 'address']) ||
    (chosenFacts ? firstString(chosenFacts, ['Address', 'address']) : undefined) ||
    firstString(
      related[0] ? { ...(related[0].identity ?? {}), ...(related[0].facts ?? {}) } : {},
      ['Address', 'address'],
    );
  const policies = extractPolicies(identity, chosenFacts, related);

  if (!rooms.length) {
    return {
      ok: false,
      error: 'Hotel matched but no room inventory rows',
      hint: 'Say inventory is not loading and offer to check again or take a callback.',
    };
  }

  const hotelName = asString(identity.hotel_name) || 'the property';
  const propertyType = (() => {
    if (!crossPropertyCart) return asString(identity.property_type);
    const types = scoredMatches
      .filter((s) =>
        wantedPreferRooms.some((w) => Boolean(matchStayRoom(s.rooms, w))),
      )
      .map((s) => asString((s.row.identity as Record<string, unknown> | undefined)?.property_type))
      .filter((t): t is string => Boolean(t))
      .filter((t, i, arr) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
    return types.length > 1 ? types.join(' + ') : types[0] ?? asString(identity.property_type);
  })();
  const city = asString(identity.city);
  const discountPct = rooms.find((r) => r.discount_pct > 0)?.discount_pct ?? rooms[0]?.discount_pct;
  const browseOnly = rooms.length > 0 && !rooms.some((r) => roomHasLiveRate(r));
  const available = rooms.filter((r) => r.available_beds > 0);
  const soldOut = rooms.filter((r) => r.available_beds <= 0 && roomHasLiveRate(r));
  const lines = available.slice(0, 4).map((r) =>
    roomHasLiveRate(r)
      ? `${r.room_name} ₹${r.price_per_night} (~${r.available_beds})`
      : r.room_name,
  );
  const soldBit = soldOut.length ? ` Sold out: ${soldOut.map((r) => r.room_name).join(', ')}.` : '';
  const discountBit =
    !browseOnly && discountPct != null && discountPct > 0
      ? ` Discount ceiling ${discountPct}% is internal — do not speak a discount until they ask, and never open with this ceiling.`
      : '';
  const addrBit = address
    ? ` Address: ${address}.`
    : ' No address in this result — if they ask where it is, say you will check. Do not guess a landmark, area, or travel time.';
  const policyBit = policyHintBits(policies);

  const chosenHotelId = asString(identity.hotel_id);
  const mergedHotelIds = new Set<string>();
  if (crossPropertyCart) {
    for (const s of scoredMatches) {
      if (!wantedPreferRooms.some((w) => Boolean(matchStayRoom(s.rooms, w)))) continue;
      const hid = asString(
        (s.row.identity as Record<string, unknown> | undefined)?.hotel_id,
      );
      if (hid) mergedHotelIds.add(hid);
    }
  }
  const other_properties = matches
    .filter((m) => m !== chosen)
    .map((m) => {
      const row = m as Record<string, unknown>;
      const id = (row.identity ?? {}) as Record<string, unknown>;
      const name = asString(id.hotel_name);
      if (!name) return null;
      const hid = asString(id.hotel_id);
      // Skip duplicate stubs of the same hotel / empty inventory siblings
      if (chosenHotelId && hid && hid === chosenHotelId) return null;
      if (hid && mergedHotelIds.has(hid)) return null;
      if (!hid && name.toLowerCase() === hotelName.toLowerCase()) return null;
      const rel = Array.isArray(row.related) ? (row.related as RelatedRow[]) : [];
      if (!collectRoomsFromRelated(rel).length) return null;
      return {
        hotel_name: name,
        property_type: asString(id.property_type),
        hotel_id: hid,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p != null);

  const extraHotels =
    other_properties.length > 0
      ? ` Also matched ${other_properties.length} other hotel(s) in this city — ask which property if unclear.`
      : '';

  const place = city ? `${city}` : hotelName;
  const typeBit = propertyType ? ` (${propertyType})` : '';
  const roomNames = available.slice(0, 3).map((r) => r.room_name).join(', ');
  const nameBits = available.slice(0, 4).map((r) => r.room_name).join(', ');
  const checkSpeak =
    policies.check_in || policies.check_out
      ? ` Check-in ${policies.check_in ?? '—'}, check-out ${policies.check_out ?? '—'}.`
      : '';

  // When caller already named property/room (prefer), speak that inventory.
  // When multiple properties and no prefer — ask which one; do NOT dump Hostel rates.
  const preferLocked = Boolean(
    prefer?.hotel || prefer?.room || (prefer?.rooms && prefer.rooms.length > 0) || crossPropertyCart,
  );
  let speak_now: string;
  if (other_properties.length > 0 && !preferLocked) {
    const types = [propertyType, ...other_properties.map((p) => p.property_type)]
      .filter((t): t is string => Boolean(t))
      .filter((t, i, arr) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)
      .slice(0, 3);
    const typeList = types.length ? types.join(' aur ') : 'alag properties';
    speak_now = `${place} mein ${other_properties.length + 1} properties hain — ${typeList}. Kaunsi dekhni hai — phir main uske live rooms bataungi?`;
  } else if (!available.length) {
    speak_now = `${place}${typeBit} pe listed types abhi full dikh rahe hain. Doosri date ya property try karein?`;
  } else if (browseOnly) {
    speak_now = `${place}${typeBit} mein rooms: ${nameBits}. Check-in date bataiye — main live options check karti hoon.`;
  } else if (crossPropertyCart) {
    speak_now = `${place} (${propertyType ?? 'multi'}): ${roomNames}.${checkSpeak} Ye dono live available hain.`;
  } else {
    // Rates mean this is a follow-up lookup (a date was given). Do not script the
    // room menu again — the first browse line already listed names.
    speak_now = `${place}${typeBit}.${checkSpeak} Date note ho gayi. Kaunsa room chahiye?`;
  }

  const base = {
    hotel_name: hotelName,
    hotel_id: asString(identity.hotel_id),
    property_type: propertyType,
    city,
    state: asString(identity.state),
    address,
    discount_pct: browseOnly ? undefined : discountPct,
    policies,
    rooms,
    other_properties: other_properties.length ? other_properties : undefined,
    speak_now,
    latency_ms: asNumber(root.latency_ms),
  };

  if (!available.length) {
    return {
      ok: true,
      ...base,
      spoken_hint: `${hotelName}${city ? ` (${city})` : ''}: all listed types show 0 free right now.${soldBit}${addrBit}${policyBit} Offer another date/property. Do not invent rooms.`,
    };
  }

  if (browseOnly) {
    return {
      ok: true,
      ...base,
      spoken_hint: `${hotelName}${city ? ` (${city})` : ''} BROWSE (no live rates yet): ${lines.join('; ')}.${addrBit}${extraHotels}${policyBit} Speak room names only — do NOT invent prices/beds. Ask check-in date, then call lookup again with date.`,
    };
  }

  return {
    ok: true,
    ...base,
    spoken_hint: `${hotelName}${city ? ` (${city})` : ''} available: ${lines.join('; ')}.${soldBit}${discountBit}${addrBit}${extraHotels}${policyBit} Ask room type if needed. 1–2 short sentences from this payload only for live facts.`,
  };
}

/** Slim payload for Gemini/OpenAI tool results — huge JSON delays first audio. */
export function compactHotelFactsForLlm(
  result: NexoraHotelFactsSummary | NexoraHotelFactsError,
): Record<string, unknown> {
  if (!result.ok) {
    const fallback = result.fallback_to_brain === true;
    const missingPlace = result.error === MISSING_PLACE_ERROR;
    return {
      ok: false,
      error: result.error,
      fallback_to_brain: fallback,
      say: fallback
        ? BRAIN_FALLBACK_HINT
        : (result.say ??
          result.hint ??
          'Ask exact city/property. Do not invent hotel names. Do not say sold out.'),
      ...(fallback
        ? {
            rule:
              'FALLBACK: Live API failed. Share Product Knowledge only for cities/properties that ARE listed. ' +
              'NEVER deny a city ("properties nahi hai") from brain/memory. Never invent exact prices, bed counts, sold-out, or policies. ' +
              'Useful answer first — offer retry/callback for live rates, do not only push callback.',
          }
        : {
            rule: missingPlace
              ? MISSING_PLACE_HINT
              : 'Live API returned no match for this city. Do NOT invent hotel names. Do NOT claim properties exist from Product Knowledge. Offer another city or callback.',
          }),
    };
  }
  const multiProperty = Boolean(result.other_properties?.length);
  const browseOnly =
    result.rooms.length > 0 && !result.rooms.some((r) => roomHasLiveRate(r));
  const open = result.rooms
    .filter((r) => r.available_beds > 0)
    .slice(0, 4)
    .map((r) =>
      roomHasLiveRate(r)
        ? {
            name: r.room_name,
            price: r.price_per_night,
            free: r.available_beds,
          }
        : {
            name: r.room_name,
            ...(r.room_type ? { type: r.room_type } : {}),
          },
    );
  const policies: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.policies)) {
    if (typeof v === 'string' && v.trim()) policies[k] = v.length > 220 ? `${v.slice(0, 220)}…` : v;
  }
  // Multi-property city with no property lock: hide room rows so the model asks
  // which property first instead of pitching Hostel dorms / inventing Suite.
  const hideRoomsUntilPropertyPick =
    multiProperty &&
    /kaunsi (property|dekhni)/i.test(result.speak_now || result.spoken_hint || '');
  return {
    ok: true,
    hotel: result.hotel_name,
    city: result.city,
    address: result.address,
    discount_pct: browseOnly ? undefined : result.discount_pct,
    ...(browseOnly ? { browse: true, rates: 'unknown — ask date then re-call lookup' } : {}),
    ...(hideRoomsUntilPropertyPick ? {} : { rooms: open }),
    ...(result.other_properties?.length
      ? {
          other_properties: result.other_properties.map((p) => ({
            name: p.hotel_name,
            type: p.property_type,
          })),
        }
      : {}),
    ...(Object.keys(policies).length ? { policies } : {}),
    say: result.speak_now || result.spoken_hint,
    rule: hideRoomsUntilPropertyPick
      ? 'MULTI-PROPERTY: Ask which property (Hostel vs Resort etc). Do NOT invent Suite/premium room names or prices. Do NOT dump one property\'s dorm rates as the whole city. After they pick, call lookup_hotel_availability again with hotel_name (e.g. Resort) and optional room_name.'
      : browseOnly
        ? 'BROWSE: Room names only — no live prices/beds. Speak names from rooms[]. Do NOT invent rates. Ask check-in date, then call lookup_hotel_availability AGAIN with date IMMEDIATELY (no spoken date confirmation before the tool).'
        : 'SPEAK ONLY WHAT THEY ASKED, ONCE. Location → hotel name and the address field only; if address is missing, say you will check — never guess a landmark, area, minutes, or a WhatsApp location. Rooms → names only, no rupee amounts. If `say` does not list room names, do not read them again. Price, rate, budget, or discount → then use rooms[].price. Do not speak discount_pct until the discount ladder, and never open with that ceiling. Do NOT invent prices or room types. Do NOT say call later. Do NOT re-confirm a check-in date you already repeated. If they want Resort/Suite/premium and this payload is Hostel-only, re-call lookup with hotel_name + room_name.',
  };
}

async function fetchNexoraHotelFactsOnce(opts: {
  city?: string | string[] | null;
  state?: string | string[] | null;
  date?: string | null;
  room_type?: string | string[] | null;
  price_per_night?: string | number | null;
  limit?: number;
  signal?: AbortSignal;
  prefer?: NexoraMatchPrefer;
  /** Booking confirm: do not send known.room_type at all. */
  omitRoomType?: boolean;
}): Promise<NexoraHotelFactsSummary | NexoraHotelFactsError> {
  const url = envUrl();
  const token = envToken();
  if (!url || !token) {
    return {
      ok: false,
      error: 'Nexora hotel facts is not configured',
      hint: BRAIN_FALLBACK_HINT,
      fallback_to_brain: true,
    };
  }

  const stateToken = toNexoraMatchArray(opts.state)?.[0];
  const roomsFromOpts = parseStayRoomTypeList(opts.room_type);
  const roomsFromPrefer = parseStayRoomTypeList(opts.prefer?.room);
  const roomTypes = roomsFromOpts.length ? roomsFromOpts : roomsFromPrefer;
  const known = buildNexoraHotelKnown({
    state: stateToken,
    city: opts.city,
    date: opts.date,
    room_type: roomTypes.length ? roomTypes : undefined,
    price_per_night: opts.price_per_night,
  });
  if (opts.omitRoomType) delete (known as { room_type?: string | string[] }).room_type;
  if (!hasNexoraHotelKnownFilter(known)) {
    return {
      ok: false,
      error: MISSING_PLACE_ERROR,
      hint: MISSING_PLACE_HINT,
      say: MISSING_PLACE_SAY,
    };
  }

  const limit = Math.min(100, Math.max(1, opts.limit ?? 40));

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nexora-Ingest-Token': token,
      },
      body: JSON.stringify({
        v: 1,
        // Progressive Hotel index: only send fields the caller has named so far.
        entity_type: 'Hotel',
        known,
        select: [],
        include: { operator_context: true, related: true },
        limit,
      }),
      signal: opts.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    return {
      ok: false,
      error: `Hotel facts request failed: ${message}`,
      hint: BRAIN_FALLBACK_HINT,
      fallback_to_brain: true,
    };
  }

  if (!res.ok) {
    let details: unknown;
    try {
      details = await res.json();
    } catch {
      details = await res.text().catch(() => undefined);
    }
    return {
      ok: false,
      error: `Hotel facts HTTP ${res.status}`,
      hint:
        typeof details === 'string' && details.trim()
          ? `${BRAIN_FALLBACK_HINT} (${details.trim().slice(0, 120)})`
          : BRAIN_FALLBACK_HINT,
      fallback_to_brain: true,
    };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return {
      ok: false,
      error: 'Invalid JSON from hotel facts API',
      hint: BRAIN_FALLBACK_HINT,
      fallback_to_brain: true,
    };
  }
  return summarizeNexoraHotelFactsPayload(payload, opts.prefer);
}

/**
 * @param hotelOrCity — city ("Jaipur") or branded name; empty allowed when opts.state is set (state-only).
 * State is sent ONLY when opts.state is explicitly provided — never auto-inferred into known.
 * Progressive: pass only filters the caller has named (city/state/date/room_type/price).
 */
export async function queryNexoraHotelFacts(
  hotelOrCity: string,
  opts?: {
    limit?: number;
    signal?: AbortSignal;
    state?: string;
    date?: string;
    room_type?: string | string[];
    price_per_night?: string | number;
    prefer?: NexoraMatchPrefer;
  },
): Promise<NexoraHotelFactsSummary | NexoraHotelFactsError> {
  const name = hotelOrCity.trim();
  const explicitState = opts?.state?.trim() || '';
  if (!name && !explicitState) {
    return {
      ok: false,
      error: MISSING_PLACE_ERROR,
      hint: MISSING_PLACE_HINT,
      say: MISSING_PLACE_SAY,
    };
  }

  const resolved = resolveHotelMatchForApi({
    city: name || undefined,
    state: explicitState || undefined,
  });
  const primary = resolved.city || name;
  const primarySignal = opts?.signal ?? AbortSignal.timeout(1_800);
  const roomTypes =
    parseStayRoomTypeList(opts?.room_type).length > 0
      ? parseStayRoomTypeList(opts?.room_type)
      : parseStayRoomTypeList(opts?.prefer?.room);
  const knownExtras = {
    ...(opts?.date?.trim() ? { date: opts.date.trim() } : {}),
    ...(roomTypes.length ? { room_type: roomTypes } : {}),
    ...(opts?.price_per_night != null && String(opts.price_per_night).trim()
      ? { price_per_night: opts.price_per_night }
      : {}),
  };
  const primaryResult = await fetchNexoraHotelFactsOnce({
    city: primary || undefined,
    state: resolved.state,
    signal: primarySignal,
    limit: opts?.limit ?? 40,
    prefer: opts?.prefer,
    ...knownExtras,
  });
  if (primaryResult.ok) {
    if (
      (primary && primary.toLowerCase() !== name.toLowerCase()) ||
      resolved.state
    ) {
      primaryResult.spoken_hint =
        `Resolved "${name || explicitState}" →` +
        (primary ? ` city ${primaryResult.city ?? primary}` : '') +
        (resolved.state ? ` state ${resolved.state}` : '') +
        ` (${primaryResult.hotel_name}). ` +
        primaryResult.spoken_hint;
    }
    return primaryResult;
  }

  // State-only: no city alias race
  if (!primary) return primaryResult;

  const candidates = cityQueryCandidates(name)
    .filter((c) => c.length > 0 && c.toLowerCase() !== primary.toLowerCase())
    .slice(0, 2);
  if (!candidates.length) return primaryResult;

  const raceList = candidates;
  const raceOpts = {
    state: resolved.state,
    signal: opts?.signal ?? AbortSignal.timeout(1_800),
    limit: opts?.limit ?? 40,
    prefer: opts?.prefer,
    ...knownExtras,
  };

  // Race candidates — return the first successful match (phone latency).
  type Attempt = { candidate: string; result: NexoraHotelFactsSummary | NexoraHotelFactsError };
  const attempts = await new Promise<Attempt[]>((resolve) => {
    const collected: Attempt[] = [];
    let remaining = raceList.length;
    let settledOk = false;
    if (!raceList.length) {
      resolve([]);
      return;
    }
    for (const candidate of raceList) {
      void fetchNexoraHotelFactsOnce({ city: candidate, ...raceOpts }).then((result) => {
        collected.push({ candidate, result });
        remaining -= 1;
        if (result.ok && !settledOk) {
          settledOk = true;
          resolve(collected);
          return;
        }
        if (remaining === 0) resolve(collected);
      });
    }
  });

  for (const { candidate, result } of attempts) {
    if (result.ok) {
      if (candidate.toLowerCase() !== name.toLowerCase()) {
        result.spoken_hint =
          `Resolved "${name}" → city ${result.city ?? candidate} (${result.hotel_name}). ` +
          result.spoken_hint;
      }
      return result;
    }
  }

  const hardFail = attempts.find(
    (r) => !r.result.ok && !/no hotel match/i.test(r.result.error),
  );
  if (hardFail && !hardFail.result.ok) return hardFail.result;

  const lastError = attempts.find((a) => !a.result.ok)?.result as NexoraHotelFactsError | undefined;
  return {
    ok: false,
    error: lastError?.error ?? `No hotel match for city "${name}"`,
    hint:
      `Tried cities: ${[primary, ...candidates].join(' | ')}. CITY mismatch, not sold-out. ` +
      `Ask exact city. Do NOT say unavailable.`,
  };
}

export type StayInventoryGateResult =
  | {
      ok: true;
      inventory_verified: boolean;
      city?: string;
      hotel_name?: string;
      room?: { name: string; free: number; price: number };
    }
  | {
      ok: false;
      error: string;
      hint: string;
      inventory_stale?: boolean;
      city?: string;
      hotel_name?: string;
      alternatives?: { name: string; free: number; price: number }[];
    };

const STAY_ROOM_NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

function normalizeStayRoomKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => STAY_ROOM_NUMBER_WORDS[word] ?? word)
    .join(' ');
}

/** Match a spoken/typed room against live inventory rows. */
export function matchStayRoom(
  rooms: NexoraHotelRoomSummary[],
  roomName: string,
): NexoraHotelRoomSummary | undefined {
  const key = normalizeStayRoomKey(roomName);
  if (!key) return undefined;
  const exact = rooms.find((r) => normalizeStayRoomKey(r.room_name) === key);
  if (exact) return exact;
  const byName = rooms.find((r) => {
    const n = normalizeStayRoomKey(r.room_name);
    return n.includes(key) || key.includes(n);
  });
  if (byName) return byName;
  // Token overlap: "Suite" ↔ "Premium Suite", "Double" ↔ "Private Double Room"
  const keyTokens = key.split(/\s+/).filter((t) => t.length > 2);
  if (keyTokens.length) {
    const byTokens = rooms.find((r) => {
      const n = normalizeStayRoomKey(r.room_name);
      return keyTokens.every((t) => n.includes(t));
    });
    if (byTokens) return byTokens;
  }
  return rooms.find((r) => {
    const t = normalizeStayRoomKey(r.room_type ?? '');
    return t && (t.includes(key) || key.includes(t));
  });
}

/**
 * Resolve city/property query for a pre-booking inventory check.
 * Prefers explicit city, then hotel_name, then a light parse of notes.
 */
export function resolveStayInventoryQuery(opts: {
  city?: string;
  hotel_name?: string;
  notes?: string;
}): string {
  const city = opts.city?.trim();
  if (city) return city;
  const hotel = opts.hotel_name?.trim();
  if (hotel) return hotel;
  const notes = opts.notes?.trim() ?? '';
  if (!notes) return '';
  const labeled = notes.match(
    /\b(?:city|location|property|hotel)\s*[:\-]\s*([A-Za-z][A-Za-z\s.'-]{1,40})/i,
  );
  if (labeled?.[1]) return labeled[1].trim();
  // Short note that looks like a place name (e.g. "Jaipur Deluxe")
  const firstToken = notes.split(/[|,;/]+/)[0]?.trim() ?? '';
  if (firstToken && firstToken.length <= 40 && /^[A-Za-z][A-Za-z\s.'-]+$/.test(firstToken)) {
    return firstToken.split(/\s+/).slice(0, 3).join(' ');
  }
  return '';
}

/**
 * Cities for a booking confirm. Scans city, hotel name, and notes so
 * Mussoorie + Rishikesh become ["Mussoorie","Rishikesh"], not the first only.
 */
export function stayInventoryCities(opts: {
  city?: string;
  hotel_name?: string;
  notes?: string;
}): string[] {
  const out: string[] = [];
  const push = (city: string) => {
    const t = city.trim();
    if (!t) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const blob of [opts.city, opts.hotel_name, opts.notes]) {
    for (const city of extractKnownHotelCitiesFromText(blob ?? '')) push(city);
  }
  if (out.length) return out;
  const fallback = resolveStayInventoryQuery(opts);
  if (!fallback) return [];
  for (const part of fallback.split(/\s*(?:,|\/|;|\+|\band\b|\baur\b)\s*/i)) {
    const canon = canonicalizeHotelCityForApi(part) || part.trim();
    push(canon);
  }
  return out;
}

function openRoomsPayload(rooms: NexoraHotelRoomSummary[]) {
  return rooms
    .filter((r) => r.available_beds > 0)
    .slice(0, 5)
    .map((r) => ({
      name: r.room_name,
      free: r.available_beds,
      price: r.price_per_night,
    }));
}

/** Pure gate over an already-fetched facts payload (unit-testable). */
export function evaluateStayInventoryForBooking(
  result: NexoraHotelFactsSummary | NexoraHotelFactsError,
  opts?: { room_name?: string | string[] },
): StayInventoryGateResult {
  if (!result.ok) {
    if (result.fallback_to_brain) {
      // Live API down — do not invent sold-out; allow save without verification.
      return { ok: true, inventory_verified: false };
    }
    return {
      ok: false,
      error: result.error,
      hint:
        result.hint ??
        'Ask the exact city/property, then retry capture_demo_lead with city set. Do NOT say the booking is confirmed.',
    };
  }

  const alternatives = openRoomsPayload(result.rooms).filter((a) => a.price > 0);
  const wantedRooms = parseStayRoomTypeList(opts?.room_name);
  const browseOnly =
    result.rooms.length > 0 && !result.rooms.some((r) => roomHasLiveRate(r));

  if (browseOnly) {
    return {
      ok: false,
      error: 'Live rates not available yet (browse-only inventory)',
      inventory_stale: true,
      city: result.city,
      hotel_name: result.hotel_name,
      alternatives: [],
      hint:
        'Do NOT confirm booking. Live prices/beds are missing — ask check-in date, call lookup_hotel_availability with date, then retry capture_demo_lead. Speak room names only; never invent rates.',
    };
  }

  if (wantedRooms.length > 0) {
    const matched: NexoraHotelRoomSummary[] = [];
    for (const roomWanted of wantedRooms) {
      const match = matchStayRoom(result.rooms, roomWanted);
      if (!match) {
        return {
          ok: false,
          error: `Room "${roomWanted}" not found in live inventory`,
          inventory_stale: true,
          city: result.city,
          hotel_name: result.hotel_name,
          alternatives,
          hint: alternatives.length
            ? `Do NOT confirm booking. That room type is not listed live at ${result.hotel_name}${result.property_type ? ` (${result.property_type})` : ''}. Offer only: ${alternatives
                .map((a) => `${a.name} (~${a.free}, ₹${a.price})`)
                .join('; ')}. If they wanted Resort/Suite/premium, retry lookup_hotel_availability + capture_demo_lead with hotel_name (e.g. Resort) and the exact listed room_name — never invent Suite.`
            : `Do NOT confirm booking. No free rooms at ${result.hotel_name} right now. Offer another date/property.`,
        };
      }
      if (match.available_beds <= 0) {
        return {
          ok: false,
          error: `Room "${match.room_name}" just sold out`,
          inventory_stale: true,
          city: result.city,
          hotel_name: result.hotel_name,
          alternatives,
          hint: alternatives.length
            ? `Do NOT confirm booking. ${match.room_name} is full now. Offer: ${alternatives
                .map((a) => `${a.name} (~${a.free}, ₹${a.price})`)
                .join('; ')}. Get a new choice, then retry capture_demo_lead.`
            : `Do NOT confirm booking. ${match.room_name} and other listed types are full. Offer another date/property.`,
        };
      }
      if (!roomHasLiveRate(match)) {
        return {
          ok: false,
          error: `Room "${match.room_name}" has no live rate yet`,
          inventory_stale: true,
          city: result.city,
          hotel_name: result.hotel_name,
          alternatives,
          hint:
            'Do NOT confirm booking. Ask check-in date, re-call lookup_hotel_availability with date for live price, then retry capture_demo_lead.',
        };
      }
      matched.push(match);
    }
    const primary = matched[0]!;
    return {
      ok: true,
      inventory_verified: true,
      city: result.city,
      hotel_name: result.hotel_name,
      room: {
        name:
          matched.length === 1
            ? primary.room_name
            : matched.map((m) => m.room_name).join(', '),
        free: Math.min(...matched.map((m) => m.available_beds)),
        price: matched.reduce((sum, m) => sum + m.price_per_night, 0),
      },
    };
  }

  if (!alternatives.length) {
    return {
      ok: false,
      error: 'Property inventory is full right now',
      inventory_stale: true,
      city: result.city,
      hotel_name: result.hotel_name,
      alternatives: [],
      hint: `Do NOT confirm booking. ${result.hotel_name}${result.city ? ` (${result.city})` : ''} shows 0 free beds live. Offer another date/property, then retry after they pick.`,
    };
  }

  return {
    ok: true,
    inventory_verified: true,
    city: result.city,
    hotel_name: result.hotel_name,
  };
}

/**
 * Fresh Nexora facts/query before saving a stay booking.
 * Blocks save when live inventory shows sold-out / missing room.
 * Soft-allows when the live API is down (fallback_to_brain) so we never invent sold-out.
 */
/** Pull YYYY-MM-DD from preferred_time / booking slot text for live inventory. */
export function stayInventoryDateFromPreferredTime(
  preferred?: string | null,
): string | undefined {
  const t = preferred?.trim();
  if (!t) return undefined;
  const iso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return iso?.[1];
}

export async function assertLiveStayInventoryForBooking(opts: {
  city?: string;
  hotel_name?: string;
  room_name?: string | string[];
  room_type?: string | string[];
  /** Explicit stay date (YYYY-MM-DD). Prefer this when known. */
  date?: string;
  /** Booking slot from capture_demo_lead — used when `date` is omitted. */
  preferred_time?: string;
  notes?: string;
  signal?: AbortSignal;
}): Promise<StayInventoryGateResult> {
  if (!isNexoraHotelFactsConfigured()) {
    return { ok: true, inventory_verified: false };
  }

  const cities = stayInventoryCities(opts);
  if (!cities.length) {
    return {
      ok: false,
      error: 'city is required before booking',
      hint:
        'Before capture_demo_lead, pass city (and room_name if they picked a type). ' +
        'Do NOT say booking confirmed. Ask city/room, then retry.',
    };
  }

  const roomTypes = (() => {
    const fromType = parseStayRoomTypeList(opts.room_type);
    if (fromType.length) return fromType;
    return parseStayRoomTypeList(opts.room_name);
  })();
  const date =
    opts.date?.trim() ||
    stayInventoryDateFromPreferredTime(opts.preferred_time) ||
    undefined;
  // Confirm with city + date only. Room names are matched on the response,
  // never sent as known.room_type. prefer.rooms is local merge, not the HTTP body.
  const result = await fetchNexoraHotelFactsOnce({
    city: cities,
    signal: opts.signal ?? AbortSignal.timeout(2_500),
    omitRoomType: true,
    ...(date ? { date } : {}),
    prefer:
      roomTypes.length > 1
        ? { rooms: roomTypes }
        : cities.length === 1 && opts.hotel_name?.trim()
          ? { hotel: opts.hotel_name.trim() }
          : undefined,
  });
  return evaluateStayInventoryForBooking(result, {
    room_name: roomTypes.length ? roomTypes : undefined,
  });
}
