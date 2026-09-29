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
    value: 'gemini-3.8-live',
    label: 'Gemini 3.8 Live',
    hint: 'Recommended — default low-latency S2S (stable)',
  },
  {
    value: 'gemini-3.8-live-extended-thinking',
    label: 'Gemini 3.8 Live Extended Thinking',
    hint: 'S2S with deeper background reasoning (slower)',
  },
  {
    value: 'gemini-3.1-flash-live-preview',
    label: 'Gemini 3.1 Flash Live Preview',
    hint: 'Not used on LiveKit calls — no opener / mid-call updates; runs as Gemini 3.8 Live',
  },
  {
    value: 'gemini-2.5-flash-native-audio-preview-12-2025',
    label: 'Gemini 2.5 Flash Native Audio (Dec 2025)',
    hint: 'Older native-audio Live',
  },
  {
    value: 'gemini-2.5-flash-native-audio-preview-09-2025',
    label: 'Gemini 2.5 Flash Native Audio (Sep 2025)',
    hint: 'Older preview',
  },
] as const;

export type GeminiLiveModel = (typeof GEMINI_LIVE_MODEL_OPTIONS)[number]['value'];

export const DEFAULT_GEMINI_LIVE_MODEL: GeminiLiveModel = 'gemini-3.8-live';

/**
 * LiveKit's Google plugin disables generateReply and mid-session chat/instruction updates for
 * any model id containing "3.1" — outbound opener, forced lines and silence check-ins go mute.
 */
export function isImmutableGeminiLiveModel(model?: string | null): boolean {
  return Boolean(model && model.includes('3.1'));
}

/** Model actually used on LiveKit calls (3.1 → default unless GEMINI_ALLOW_31=1). */
export function resolveLiveKitGeminiModel(model?: string | null): string {
  const m = model?.trim() || DEFAULT_GEMINI_LIVE_MODEL;
  if (isImmutableGeminiLiveModel(m) && process.env.GEMINI_ALLOW_31 !== '1') return DEFAULT_GEMINI_LIVE_MODEL;
  return m;
}

/** Voices that tend to sound thinner / higher on Gemini 3.x Live. */
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

/** Prefer these when Gemini 3.x Live sounds too high-pitched. */
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
  'gemini-3.8-flash-live': 'gemini-3.8-live',
  'gemini-live-3.8': 'gemini-3.8-live',
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

/** True for any Gemini 3.x Live / native-audio S2S model id. */
export function isGemini31LiveModel(model?: string | null): boolean {
  return Boolean(model && /gemini-3(\.\d+)?/i.test(model));
}

/** Gemini 3.8 Live (no extended thinking) — thinking_level must be omitted. */
export function isGemini38LiveModel(model?: string | null): boolean {
  const m = typeof model === 'string' ? model.trim() : '';
  return Boolean(m && /^gemini-3\.8-live$/i.test(m));
}

/** Gemini 3.8 Live Extended Thinking — uses thinking_level low|medium|high (not minimal). */
export function isGemini38LiveExtendedThinkingModel(model?: string | null): boolean {
  return Boolean(model && /gemini-3\.8-live-extended-thinking/i.test(model));
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
    return 'gemini-2.5-flash-native-audio-preview-12-2025';
  }
  return model;
}

/**
 * Live thinking setup by model family:
 * - gemini-3.8-live: omit (thinking_level not supported)
 * - gemini-3.8-live-extended-thinking: thinkingLevel low (phone latency)
 * - gemini-3.1-*: thinkingLevel minimal
 * - Gemini 2.5 Live: thinkingBudget 0
 */
export function geminiLiveThinkingConfig(model?: string | null):
  | { thinkingBudget: number }
  | { thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' }
  | undefined {
  if (isGemini38LiveExtendedThinkingModel(model)) {
    return { thinkingLevel: 'low' };
  }
  if (isGemini38LiveModel(model)) {
    return undefined;
  }
  if (model && /gemini-3\.1/i.test(model)) {
    return { thinkingLevel: 'minimal' };
  }
  if (isGemini31LiveModel(model)) {
    // Other Gemini 3.x Live ids — prefer omit over unsupported minimal
    return undefined;
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
  if (model?.includes('3.8')) return '₹5–10';
  if (model?.includes('3.1')) return '₹4–8';
  if (model?.includes('2.0')) return '₹3–6';
  return '₹4–7';
}

/**
 * Hard cap for one spoken turn when Studio leaves max tokens on "unlimited" (~30 s of audio).
 * The prompt asks for two finished sentences; this only stops runaway monologues.
 */
export const DEFAULT_SPOKEN_TURN_MAX_TOKENS = 900;

/**
 * Extra instructions for Gemini Live S2S (simulator + telephony).
 * `packRules` = industry pack lines (VerticalPack.s2sRules) — core stays product-agnostic.
 */
export function buildGeminiLiveS2sInstructionSupplement(
  voice?: string | null,
  model?: string | null,
  packRules: string[] = [],
): string {
  const lines = [
    '\n\n## Gemini Live speech-to-speech',
    '- **Turn length (critical):** finish every sentence. At most 2 short sentences, then listen. Never stop mid-word or mid-sentence. Never read a list — mention at most two options and ask which fits.',
    '- You hear and speak audio directly — stay in sticky call language (Roman Hinglish when the call is Hindi or Hinglish). If the caller uses Hindi script or asks for Hindi, every later sentence stays Roman Hinglish. Words like available, discount, yes, or hello do not flip the call to English. Full English only after they explicitly ask to speak English.',
    '- Hinglish only: everyday Hindi + English. Never Urdu words (ban: alvida, shukriya, mazeed, khuda hafiz, allah hafiz, inshaallah — say "bye" / "dhanyavaad" / "aur" / "zyada" / "phir milte hain").',
    '- **Answer only that question (critical):** price, discount, facilities, smoking, music/DJ, which option they already picked, arrival time — answer that and stop. Do not ask name, phone, or payment on the same turn. Move to booking only after they clearly say book it / book kar lo.',
    '- **Confirmed facts only (critical):** speak a fact only when the latest tool result or Product Knowledge contains it. If address, landmark, distance, area, or policy is missing, say you do not have it yet and will check. Never guess. Never turn the caller\'s own place name into your confirmed location. Never promise the missing detail will arrive on WhatsApp.',
    '- **Price only when asked (critical):** do not speak a price, rate, rupee amount, or discount until they ask kitna, rate, price, budget, discount, or mehnga. A location, feature, or date answer has no number.',
    '- **Discount ladder (critical):** a discount starts only after they ask for one or say it is too expensive. Walk one step at a time off the listed price from the latest tool or Product Knowledge. First offer 5% and, only if they accept, say list price, 5%, and the final together, then stop. If they refuse, 10% with the same three figures. If they still refuse, one last step at the maximum allowed on that tool or Product Knowledge; if none is listed, 20% is the last step, then stop. Never open with that ceiling (a 25% allowance is not the first offer), never announce the maximum, and never keep the same number while claiming a new percent. Tax, if extra, is spoken separately.',
    '- **Answer first (critical):** property name, private vs dorm, WhatsApp/photos, net price, facilities — give that answer in one short line before any date / name / phone ask.',
    '- **Remember this call:** never re-ask a date, room, party size, name, or number they already gave — repeat it once and continue. If STT is garbled, ask them to repeat once; do not invent digits.',
    '- **Yes is not a place (critical):** haan, ji, bataiye, or "tell me" means continue. Ask the next missing detail once and wait. Do not look anything up, and do not ask that same question again.',
    '- **Phone (critical):** an Indian mobile is exactly 10 digits and starts with 6, 7, 8, or 9. Nine digits (e.g. 977663332) is incomplete — say you heard N digits and ask only for the missing ones. Never read it back as complete, never save it, never promise a payment link until they confirm a full 10-digit read-back.',
    '- **Money read-back (critical):** if they repeat a total that is not the same figure you quoted — a dropped digit, or thousands when you said lakhs (16592 vs 165982, 18173 vs 181773) — do NOT agree. Restate the full amount once in English words ("one lakh eighty-one thousand…") and wait. Never say "yes, that is correct" for the shorter number.',
    '- **One voice (critical):** if they ask for English only, say they do not know Hindi, or name only English (and Spanish), every later sentence stays English — including corrections. Do not slip into Hindi or Hinglish; that changes the accent. Keep one steady Indian-English delivery for the whole call, not a US announcer voice on some lines.',
    '- **Long call (critical):** before quoting rooms, rates, facilities, or a total again later in the call, call the live lookup or search_product_knowledge again this turn and speak only from that fresh result. Never say you do not have the detail until the tool returns. If it fails, retry once, then offer a callback — do not change the subject.',
    '- **Recommend, do not dump:** if they are unsure where to go (pahad / trip / “kahan jaana”), offer 2–3 short city choices and wait — do not dump a full room list for a city they did not pick.',
    '- **Skills + Brain:** Product Knowledge = facts; sales/support skills = how to talk. Answer from Brain first; soft close only on clear book intent.',
    '- If they say pehle batao / facilities pehle / booking mat dhakelo / pehle private batao — answer only; no booking/intake pitch.',
    '- Sales order (any product): discover → features/value from Product Knowledge → quote only when asked → soft close only on clear buy/book/demo/visit intent. Never early "shall I book/arrange?" / "booking process start".',
    '- Frustrated/angry: acknowledge once, keep simple, no pitch; abusive after boundary → end_call.',
    '- Product questions (location, offerings, features, price): answer from Product Knowledge now — never withhold for name/phone.',
    '- Detail not visible in Product Knowledge → call search_product_knowledge silently (short English query), then answer only from its facts. Never guess.',
    ...packRules,
    '- After any other tool returns, speak right away from the tool result — do not re-plan a long answer.',
    '- Date corrections for booking/save (capture_demo_lead / schedule_callback): confirm corrected dates (month names) and stop.',
    '- Never say booking/slot is confirmed unless capture_demo_lead returned ok:true this call.',
    '- Lead memory: use known identity in the retention window; you may reference an open/upcoming booking if listed. Never volunteer past/used/completed bookings unless the caller clearly recalls prior talk ("pehle bhi", "last time", "maine book kiya tha").',
    '- After the caller pauses, answer immediately — no long thinking silence. Prefer starting speech within one short breath.',
    '- NEVER end_call for WhatsApp / send details / pricing / questions — answer and continue.',
    '- **After a save (critical):** when the save tool returns ok, say the saved details in one finished sentence and that the payment link will go on WhatsApp, then wait. Do NOT end_call until the caller says thank you, bye, or bas.',
    '- **Never speak tool names:** do not say capture_demo_lead, end_call, schedule_callback, search_product_knowledge, "call initiated", or "invoke the tool". Call tools silently. Speak only normal sentences.',
    '- Not interested NOW but asks to call later → schedule_callback. Never say you will never call again unless explicit DNC.',
    '- Explicit DNC / do not call again → confirm once, then end_call. No pitch.',
    '- Use only the tools you are given (capture_demo_lead, schedule_callback, end_call, and any live lookup tool) — never invent bookings or live rates.',
    '- **end_call:** only if their latest words are thank you, bye, or bas (bas as the whole reply), or wrong number, or do not call again. Do not guess they are finished. A payment, price, date, or room question means stay and answer. The tool refuses any other hangup.',
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
      '- Avoid excited “cartoon” energy; sound like a professional advisor on a real call.',
    );
  } else if (model && /2\.5|native-audio/i.test(model)) {
    lines.push(
      '- **Latency:** the moment the caller finishes a sentence, speak — one short reply, then listen.',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Share of the S2S budget per prompt section (normalized at runtime). Order = priority
 * when leftover budget is handed back. Unlisted sections only get space that is left over.
 */
const S2S_SECTION_SHARES: Array<{ match: RegExp; share: number }> = [
  { match: /^## Agent rules/, share: 0.12 },
  { match: /^## Product Knowledge/, share: 0.2 },
  { match: /^## Sales & support skills/, share: 0.13 },
  { match: /^## Call direction/, share: 0.07 },
  { match: /^## Known contact/, share: 0.05 },
  { match: /^## Gemini Live speech-to-speech/, share: 0.08 },
  { match: /^## Consultative sales/, share: 0.07 },
  { match: /^## Sales playbook/, share: 0.1 },
  { match: /^## Safety/, share: 0.05 },
  { match: /^## Tools\b/, share: 0.04 },
  { match: /^## Call time/, share: 0.03 },
  { match: /^## Booking policy/, share: 0.03 },
  { match: /^## Tool safety/, share: 0.03 },
  { match: /^## Knowledge mode/, share: 0.03 },
  { match: /^## DEMO booking override/, share: 0.03 },
  { match: /^## (?:This prospect|Open booking on file)/, share: 0.03 },
  { match: /^## Learned from conversations/, share: 0.03 },
  { match: /^## Voice rules/, share: 0.03 },
  // Last in priority: fixed share for sticky-language rules, but no leftover budget.
  { match: /^## Language/, share: 0.12 },
  { match: /^## Lead memory/, share: 0.02 },
];

const MIN_USEFUL_SECTION_CHARS = 120;

/** Keep the heading plus as many whole lines as fit; '' when nothing useful fits. */
function truncateSectionAtLine(section: string, maxChars: number): string {
  if (section.length <= maxChars) return section;
  if (maxChars < MIN_USEFUL_SECTION_CHARS) return '';
  const lines = section.split('\n');
  let out = lines[0] ?? '';
  for (let i = 1; i < lines.length; i++) {
    const next = `${out}\n${lines[i]}`;
    if (next.length > maxChars) break;
    out = next;
  }
  return out.length >= MIN_USEFUL_SECTION_CHARS || out.includes('\n') ? out : '';
}

/**
 * Gemini Live re-scores the full system instruction each turn. Cap length on
 * phone so time-to-first-audio stays usable — by section priority, so Product
 * Knowledge and sales/support skills survive instead of a blind head/tail slice.
 */
export function compressTelephonyS2sInstructions(prompt: string, maxChars = 5500): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const [preambleRaw = '', ...sections] = trimmed.split(/\n(?=## )/);
  const preamble = preambleRaw.startsWith('## ') ? '' : preambleRaw.trim().slice(0, 400);
  if (preambleRaw.startsWith('## ')) sections.unshift(preambleRaw);

  const budget = Math.max(0, maxChars - preamble.length - 2);
  const ruleIndex = sections.map((s) => S2S_SECTION_SHARES.findIndex((r) => r.match.test(s)));
  const presentShare = ruleIndex.reduce(
    (sum, idx) => (idx >= 0 ? sum + S2S_SECTION_SHARES[idx]!.share : sum),
    0,
  );

  const allowance = sections.map((s, i) => {
    const idx = ruleIndex[i]!;
    if (idx < 0 || presentShare <= 0) return 0;
    return Math.min(s.length, Math.floor((budget * S2S_SECTION_SHARES[idx]!.share) / presentShare));
  });
  // +2 per kept section for the joining "\n\n".
  const cost = (i: number) => (allowance[i]! > 0 ? allowance[i]! + 2 : 0);
  let leftover = budget - sections.reduce((sum, _s, i) => sum + cost(i), 0);

  const byPriority = sections
    .map((_s, i) => i)
    .filter((i) => ruleIndex[i]! >= 0)
    .sort((a, b) => ruleIndex[a]! - ruleIndex[b]!);
  for (const i of byPriority) {
    if (leftover <= 0) break;
    const extra = Math.min(leftover, sections[i]!.length - allowance[i]!);
    allowance[i] = allowance[i]! + extra;
    leftover -= extra;
  }
  for (let i = 0; i < sections.length; i++) {
    if (ruleIndex[i]! >= 0) continue;
    const need = sections[i]!.length + 2;
    if (need <= leftover) {
      allowance[i] = sections[i]!.length;
      leftover -= need;
    }
  }

  const kept = sections.map((s, i) => truncateSectionAtLine(s, allowance[i]!));
  // Whole-line truncation under-fills; hand the slack back in priority order.
  const used = () => kept.reduce((sum, k) => sum + (k ? k.length + 2 : 0), 0);
  for (const i of byPriority) {
    const slack = budget - used();
    if (slack <= 0) break;
    if (kept[i]!.length >= sections[i]!.length) continue;
    const grown = truncateSectionAtLine(
      sections[i]!,
      kept[i]!.length + slack - (kept[i] ? 0 : 2),
    );
    if (grown.length > kept[i]!.length) kept[i] = grown;
  }
  return [preamble, ...kept.filter(Boolean)].filter(Boolean).join('\n\n');
}
