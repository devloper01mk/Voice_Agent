export type GeminiLiveVoiceGender = 'female' | 'male' | 'neutral';

/** All 30 Gemini Live HD voices (Google Live API). */
export const GEMINI_LIVE_VOICE_OPTIONS = [
  { value: 'Achernar', label: 'Achernar', gender: 'female' as const, hint: 'Soft' },
  { value: 'Achird', label: 'Achird', gender: 'male' as const, hint: 'Friendly' },
  { value: 'Algenib', label: 'Algenib', gender: 'male' as const, hint: 'Gravelly' },
  { value: 'Algieba', label: 'Algieba', gender: 'male' as const, hint: 'Smooth' },
  { value: 'Alnilam', label: 'Alnilam', gender: 'male' as const, hint: 'Firm' },
  { value: 'Aoede', label: 'Aoede', gender: 'female' as const, hint: 'Breezy' },
  { value: 'Autonoe', label: 'Autonoe', gender: 'female' as const, hint: 'Bright' },
  { value: 'Callirrhoe', label: 'Callirrhoe', gender: 'female' as const, hint: 'Easy-going' },
  { value: 'Charon', label: 'Charon', gender: 'male' as const, hint: 'Informative' },
  { value: 'Despina', label: 'Despina', gender: 'female' as const, hint: 'Smooth' },
  { value: 'Enceladus', label: 'Enceladus', gender: 'male' as const, hint: 'Breathy' },
  { value: 'Erinome', label: 'Erinome', gender: 'female' as const, hint: 'Clear' },
  { value: 'Fenrir', label: 'Fenrir', gender: 'male' as const, hint: 'Excitable' },
  { value: 'Gacrux', label: 'Gacrux', gender: 'female' as const, hint: 'Mature' },
  { value: 'Iapetus', label: 'Iapetus', gender: 'male' as const, hint: 'Clear' },
  { value: 'Kore', label: 'Kore', gender: 'female' as const, hint: 'Firm — recommended' },
  { value: 'Laomedeia', label: 'Laomedeia', gender: 'female' as const, hint: 'Upbeat' },
  { value: 'Leda', label: 'Leda', gender: 'female' as const, hint: 'Youthful' },
  { value: 'Orus', label: 'Orus', gender: 'male' as const, hint: 'Firm' },
  { value: 'Pulcherrima', label: 'Pulcherrima', gender: 'female' as const, hint: 'Forward' },
  { value: 'Puck', label: 'Puck', gender: 'male' as const, hint: 'Upbeat (default)' },
  { value: 'Rasalgethi', label: 'Rasalgethi', gender: 'male' as const, hint: 'Informative' },
  { value: 'Sadachbia', label: 'Sadachbia', gender: 'male' as const, hint: 'Lively' },
  { value: 'Sadaltager', label: 'Sadaltager', gender: 'male' as const, hint: 'Knowledgeable' },
  { value: 'Schedar', label: 'Schedar', gender: 'male' as const, hint: 'Even' },
  { value: 'Sulafat', label: 'Sulafat', gender: 'female' as const, hint: 'Warm' },
  { value: 'Umbriel', label: 'Umbriel', gender: 'male' as const, hint: 'Easy-going' },
  { value: 'Vindemiatrix', label: 'Vindemiatrix', gender: 'female' as const, hint: 'Gentle' },
  { value: 'Zephyr', label: 'Zephyr', gender: 'female' as const, hint: 'Bright' },
  { value: 'Zubenelgenubi', label: 'Zubenelgenubi', gender: 'male' as const, hint: 'Casual' },
] as const;

export type GeminiLiveVoice = (typeof GEMINI_LIVE_VOICE_OPTIONS)[number]['value'];

export const DEFAULT_GEMINI_LIVE_VOICE: GeminiLiveVoice = 'Kore';

export const FEMALE_GEMINI_LIVE_VOICES = GEMINI_LIVE_VOICE_OPTIONS.filter(
  (v) => v.gender === 'female',
).map((v) => v.value);

/**
 * Live API models for the Gemini Developer API (API key).
 * Vertex / Agent Platform IDs (`gemini-live-…`) do NOT work with GEMINI_API_KEY —
 * selecting them used to close the phone session immediately.
 */
export const GEMINI_LIVE_MODEL_OPTIONS = [
  {
    value: 'gemini-2.5-flash-native-audio-preview-12-2025',
    label: 'Gemini 2.5 Flash Native Audio (Dec 2025)',
    hint: 'Recommended — Developer API',
  },
  {
    value: 'gemini-2.5-flash-native-audio-preview-09-2025',
    label: 'Gemini 2.5 Flash Native Audio (Sep 2025)',
    hint: 'Older preview',
  },
  {
    value: 'gemini-3.1-flash-live-preview',
    label: 'Gemini 3.1 Flash Live Preview',
    hint: 'Lower latency — pick a warm/mature voice (can sound brighter)',
  },
] as const;

export type GeminiLiveModel = (typeof GEMINI_LIVE_MODEL_OPTIONS)[number]['value'];

export const DEFAULT_GEMINI_LIVE_MODEL: GeminiLiveModel =
  'gemini-2.5-flash-native-audio-preview-12-2025';

/** Voices that tend to sound thinner / higher on Gemini 3.1 Live. */
export const GEMINI_31_BRIGHT_VOICES = new Set([
  'Zephyr',
  'Autonoe',
  'Leda',
  'Laomedeia',
  'Pulcherrima',
  'Aoede',
  'Puck',
  'Fenrir',
  'Sadachbia',
]);

/** Prefer these when Gemini 3.1 sounds too high-pitched. */
export const GEMINI_31_WARM_VOICE_HINTS = [
  'Gacrux',
  'Sulafat',
  'Achernar',
  'Kore',
  'Despina',
  'Vindemiatrix',
  'Charon',
] as const;

/** Map Vertex / legacy IDs → Developer API Live models. */
const GEMINI_LIVE_MODEL_ALIASES: Record<string, GeminiLiveModel> = {
  'gemini-2.5-flash-native-audio': 'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-live-2.5-flash-native-audio': 'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-live-2.5-flash-preview-native-audio': 'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-live-2.5-flash-preview-native-audio-09-2025':
    'gemini-2.5-flash-native-audio-preview-09-2025',
  'gemini-2.0-flash-exp': 'gemini-2.5-flash-native-audio-preview-12-2025',
};

export const GEMINI_LIVE_LANGUAGE_OPTIONS = [
  { value: 'hi-IN', label: 'Hindi (India)', hint: 'Recommended for Hinglish calls' },
  { value: 'en-IN', label: 'English (India)', hint: 'Indian English' },
  { value: 'mr-IN', label: 'Marathi (India)' },
  { value: 'ta-IN', label: 'Tamil (India)' },
  { value: 'te-IN', label: 'Telugu (India)' },
  { value: 'bn-BD', label: 'Bengali' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'auto', label: 'Auto-detect', hint: 'Model picks language' },
] as const;

export type GeminiLiveLanguageCode = (typeof GEMINI_LIVE_LANGUAGE_OPTIONS)[number]['value'];

export const DEFAULT_GEMINI_LIVE_LANGUAGE: GeminiLiveLanguageCode = 'hi-IN';

const GEMINI_VOICE_VALUES = new Set<string>(GEMINI_LIVE_VOICE_OPTIONS.map((o) => o.value));
const GEMINI_MODEL_VALUES = new Set<string>(GEMINI_LIVE_MODEL_OPTIONS.map((o) => o.value));
const GEMINI_LANGUAGE_VALUES = new Set<string>(GEMINI_LIVE_LANGUAGE_OPTIONS.map((o) => o.value));

export function isGeminiLiveVoice(voice?: string | null): voice is GeminiLiveVoice {
  return Boolean(voice && GEMINI_VOICE_VALUES.has(voice));
}

export function isGeminiLiveModel(model?: string | null): model is GeminiLiveModel {
  return Boolean(model && GEMINI_MODEL_VALUES.has(model));
}

export function isGemini31LiveModel(model?: string | null): boolean {
  return Boolean(model && /gemini-3(\.\d+)?/i.test(model));
}

export function resolveGeminiLiveVoice(voice?: string | null): string {
  if (isGeminiLiveVoice(voice)) return voice;
  if (typeof voice === 'string' && voice.trim()) return voice.trim();
  return DEFAULT_GEMINI_LIVE_VOICE;
}

export function resolveGeminiLiveModel(model?: string | null): string {
  const raw = typeof model === 'string' ? model.trim() : '';
  if (!raw) return DEFAULT_GEMINI_LIVE_MODEL;
  if (isGeminiLiveModel(raw)) return raw;
  const aliased = GEMINI_LIVE_MODEL_ALIASES[raw];
  if (aliased) return aliased;
  return DEFAULT_GEMINI_LIVE_MODEL;
}

/**
 * Phone Gemini model: use Agent Studio / API selection by default.
 * Set GEMINI_LIVE_FORCE_25_ON_PHONE=1 to force 2.5 native-audio on SIP.
 */
export function preferGeminiLiveModelForTelephony(model: string): string {
  if (process.env.GEMINI_LIVE_FORCE_25_ON_PHONE === '1' && isGemini31LiveModel(model)) {
    return DEFAULT_GEMINI_LIVE_MODEL;
  }
  return model;
}

/**
 * Gemini 3.x Live uses `thinkingLevel` (not thinkingBudget). Phone calls need
 * MINIMAL or replies feel 1–3s late after the caller stops.
 * Gemini 2.5 Live: thinkingBudget 0 disables thinking.
 */
export function geminiLiveThinkingConfig(model?: string | null):
  | { thinkingBudget: number }
  | { thinkingLevel: 'minimal' }
  | undefined {
  if (isGemini31LiveModel(model)) {
    return { thinkingLevel: 'minimal' };
  }
  return { thinkingBudget: 0 };
}

export function resolveGeminiLiveLanguageCode(code?: string | null): string {
  if (code === 'auto') return 'auto';
  if (typeof code === 'string' && GEMINI_LANGUAGE_VALUES.has(code)) return code;
  return DEFAULT_GEMINI_LIVE_LANGUAGE;
}

export function isFemaleGeminiLiveVoice(voice?: string | null): boolean {
  const match = GEMINI_LIVE_VOICE_OPTIONS.find((option) => option.value === voice);
  return match?.gender === 'female';
}

export function estimateGeminiLiveCostInr(model?: string | null): string {
  if (model?.includes('3.1')) return '₹4–8';
  if (model?.includes('2.0')) return '₹3–6';
  return '₹4–7';
}

/** Extra instructions for Gemini Live S2S (simulator + telephony). */
export function buildGeminiLiveS2sInstructionSupplement(
  voice?: string | null,
  model?: string | null,
): string {
  const lines = [
    '\n\n## Gemini Live speech-to-speech',
    '- You hear and speak audio directly — stay in sticky call language (Roman Hinglish when the call is Hinglish).',
    '- Hinglish only: everyday Hindi + English. Never Urdu words (ban: alvida, shukriya, mazeed, khuda hafiz, allah hafiz, inshaallah — say "bye" / "dhanyavaad" / "aur" / "zyada" / "phir milte hain").',
    '- On phone: keep replies short (1–2 sentences). Do not monologue.',
    '- Answer the latest caller ask only — do not append payment/advance or booking pitch unless they asked to book or pay.',
    '- **Skills + Brain:** Product Knowledge = facts; sales/support skills = how to talk. Answer from Brain first; soft close only on clear book intent.',
    '- If they say pehle batao / facilities pehle / booking mat dhakelo — answer only; no booking/intake pitch.',
    '- Sales order (any product): discover → features/value from Product Knowledge → quote only when asked → soft close only on clear buy/book/demo/visit intent. Never early "shall I book/arrange?" / "booking process start".',
    '- Frustrated/angry: acknowledge once, keep simple, no pitch; abusive after boundary → end_call.',
    '- Product questions (location, offerings, features, price): answer from Product Knowledge now — never withhold for name/phone.',
    '- If the lookup_hotel_availability tool is available and they name a clear city and/or state, call it every time with English values; city-only → city, state-only → state, both → both.',
    '- **Brain + live:** Answer city existence only after live lookup. Product Knowledge = sales vibe/policies; live JSON = hai/nahi + rooms/prices. Never deny a city from Product Knowledge alone.',
    '- Every different city = a new lookup_hotel_availability call.',
    '- Do not invent/infer state when the caller only named a city.',
    '- Vague place (landmark/area/"pahad"/not a clear city): do NOT call lookup yet. Acknowledge → confirm nearest city or offer 2–3 city choices → then lookup. Never invent rates; never dump a technical inventory error.',
    '- Do not volunteer a destination city the caller has not named yet (except as short choices when clarifying a vague place).',
    '- After lookup_hotel_availability (or a LIVE LOOKUP SYSTEM note), speak from that result + Brain tone — do NOT invent "call later" or re-read the full room list; only clarify or ask which room/property.',
    '- If lookup_hotel_availability returns fallback_to_brain:true, never deny the city; never invent live beds/prices; offer retry/callback for rates.',
    '- If a SYSTEM note already includes LIVE LOOKUP JSON for a city, speak from it this turn — do not contradict it from Brain memory.',
    '- After any other tool returns, speak right away from the tool result — do not re-plan a long answer.',
    '- Date corrections: confirm the corrected dates (month names) and stop; no second agenda in that turn.',
    '- Never say booking/slot is confirmed unless capture_demo_lead returned ok:true this call.',
    '- Lead memory: use known identity in the retention window; you may reference an open/upcoming booking if listed. Never volunteer past/used/completed bookings unless the caller clearly recalls prior talk ("pehle bhi", "last time", "maine book kiya tha").',
    '- After the caller pauses, answer immediately — no long thinking silence. Prefer starting speech within one short breath.',
    '- NEVER end_call for WhatsApp / send details / pricing / questions — answer and continue.',
    '- Not interested NOW but asks to call later → schedule_callback. Never say you will never call again unless explicit DNC.',
    '- Explicit DNC / do not call again → confirm once, then end_call. No pitch.',
    '- Use available tools (lookup_hotel_availability when present, capture_demo_lead, schedule_callback, end_call) — never invent bookings or live rates.',
    '- **end_call:** speak a short goodbye in AUDIO first, then invoke end_call with empty args only. Never put spoken words (Theek hai / Bye / Thik hai) inside the tool call.',
  ];
  if (isFemaleGeminiLiveVoice(voice)) {
    lines.push(
      '- You are a **female** sales agent. First-person Hinglish MUST be feminine: karti hoon, chahti hoon, bol rehi hoon, karungi, kar sakti hoon. NEVER karta/chahta/chata hun, bol raha hoon, karunga.',
      '- Keep a warm, clear **feminine** speaking delivery in audio.',
    );
  }
  if (isGemini31LiveModel(model)) {
    lines.push(
      '- **Voice tone (mandatory):** speak in a **lower, warmer mid register** — calm adult phone-agent voice.',
      '- Do **not** use a thin, squeaky, childish, or overly bright high pitch. Slightly slower and grounded.',
      '- Avoid excited “cartoon” energy; sound like a professional dealership advisor on a real call.',
    );
  } else if (model && /2\.5|native-audio/i.test(model)) {
    lines.push(
      '- **Latency:** the moment the caller finishes a sentence, speak — one short reply, then listen.',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Gemini Live re-scores the full system instruction each turn. Cap length on
 * phone so time-to-first-audio stays usable.
 */
export function compressTelephonyS2sInstructions(prompt: string, maxChars = 5500): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const head = Math.floor(maxChars * 0.65);
  const tail = Math.max(400, maxChars - head - 90);
  return `${trimmed.slice(0, head)}\n\n[...trimmed for phone S2S latency...]\n\n${trimmed.slice(-tail)}`;
}
