export type VoicePipeline = 'cascaded' | 'openai_realtime' | 'gemini_live';

export const DEFAULT_VOICE_PIPELINE: VoicePipeline = 'cascaded';
export const DEFAULT_REALTIME_VOICE = 'coral';

export type RealtimeVoiceGender = 'female' | 'male' | 'neutral';

export const REALTIME_VOICE_OPTIONS = [
  { value: 'coral', label: 'Coral', gender: 'female' as const, hint: 'Warm female — recommended' },
  { value: 'shimmer', label: 'Shimmer', gender: 'female' as const, hint: 'Soft female' },
  { value: 'marin', label: 'Marin', gender: 'female' as const, hint: 'Clear female (default OpenAI)' },
  { value: 'sage', label: 'Sage', gender: 'neutral' as const, hint: 'Calm, gender-neutral' },
  { value: 'alloy', label: 'Alloy', gender: 'neutral' as const, hint: 'Neutral' },
  { value: 'ash', label: 'Ash', gender: 'male' as const, hint: 'Male-leaning' },
  { value: 'ballad', label: 'Ballad', gender: 'male' as const, hint: 'Male-leaning' },
  { value: 'echo', label: 'Echo', gender: 'male' as const, hint: 'Male-leaning' },
  { value: 'verse', label: 'Verse', gender: 'male' as const, hint: 'Male-leaning' },
] as const;

/** Female OpenAI Realtime preset voices (US accent — not Indian). */
export const FEMALE_REALTIME_VOICES = REALTIME_VOICE_OPTIONS.filter(
  (v) => v.gender === 'female',
).map((v) => v.value);

export const DEFAULT_FEMALE_REALTIME_VOICE = 'coral';

export type RealtimeVoice = (typeof REALTIME_VOICE_OPTIONS)[number]['value'];

const REALTIME_VOICE_VALUES = new Set<string>(
  REALTIME_VOICE_OPTIONS.map((option) => option.value),
);

export function normalizeVoicePipeline(raw?: string | null): VoicePipeline {
  if (raw === 'openai_realtime') return 'openai_realtime';
  if (raw === 'gemini_live') return 'gemini_live';
  return 'cascaded';
}

export function isS2sPipeline(raw?: string | null): boolean {
  const pipeline = normalizeVoicePipeline(raw);
  return pipeline === 'openai_realtime' || pipeline === 'gemini_live';
}

export function isRealtimeVoice(voice?: string | null): voice is RealtimeVoice {
  return Boolean(voice && REALTIME_VOICE_VALUES.has(voice));
}

export function resolveRealtimeVoice(voice?: string | null): string {
  if (isRealtimeVoice(voice)) return voice;
  if (typeof voice === 'string' && voice.trim()) return voice.trim();
  return DEFAULT_REALTIME_VOICE;
}

export function isOpenaiRealtimePipeline(raw?: string | null): boolean {
  return normalizeVoicePipeline(raw) === 'openai_realtime';
}

export function isGeminiLivePipeline(raw?: string | null): boolean {
  return normalizeVoicePipeline(raw) === 'gemini_live';
}

export function isFemaleRealtimeVoice(voice?: string | null): boolean {
  const match = REALTIME_VOICE_OPTIONS.find((option) => option.value === voice);
  return match?.gender === 'female';
}

/** Extra instructions appended for Simulator OpenAI Realtime S2S only (not telephony). */
export function buildRealtimeS2sInstructionSupplement(voice?: string | null): string {
  const lines = [
    '\n\n## Realtime speech-to-speech (Simulator only)',
    '- You hear and speak audio directly — stay in sticky call language (Roman Hinglish when the call is Hinglish).',
    '- Hinglish only: everyday Hindi + English. Never Urdu words (ban: alvida, shukriya, mazeed, khuda hafiz, allah hafiz — say "bye" / "dhanyavaad" / "aur" / "zyada").',
    '- Not interested NOW but asks to call later → schedule_callback. Never say you will never call again unless explicit DNC.',
    '- Explicit DNC / do not call again → confirm once, then end_call. No pitch.',
    '- Use tools (capture_demo_lead, schedule_callback, end_call) when appropriate — never invent bookings.',
    '- **end_call:** speak goodbye in AUDIO first, then invoke end_call with empty args only — never put spoken words inside the tool call.',
    '- Answer from Product Knowledge first; soft close only on clear book intent — never early "booking start / details collect".',
  ];
  if (isFemaleRealtimeVoice(voice)) {
    lines.push(
      '- You are a **female** sales agent. First-person Hinglish MUST be feminine: karti hoon, chahti hoon, bol rehi hoon, karungi, kar sakti hoon. NEVER karta/chahta/chata hun, bol raha hoon, karunga.',
      '- Keep a warm, clear **feminine** speaking delivery in audio — never sound like a male voice.',
    );
  }
  return `${lines.join('\n')}\n`;
}
