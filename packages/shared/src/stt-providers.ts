import type { SpeakLanguage } from './skills-types.js';
import type { SttProvider } from './skills-types.js';

export const DEFAULT_STT_PROVIDER: SttProvider = 'azure';
export const DEFAULT_OPENAI_STT_MODEL = 'gpt-4o-mini-transcribe';
export const DEFAULT_SARVAM_STT_MODEL = 'saaras:v3';
export const DEFAULT_GOOGLE_STT_MODEL = 'chirp_3';
export const DEFAULT_GOOGLE_SPEECH_LOCATION = 'asia-south1';

export const OPENAI_STT_MODEL_OPTIONS = [
  {
    value: 'gpt-4o-mini-transcribe',
    label: 'GPT-4o mini Transcribe',
    hint: 'Fast and cost-efficient streaming transcription — recommended for live calls.',
    tag: 'Recommended',
    tagTone: 'green' as const,
  },
  {
    value: 'gpt-4o-transcribe',
    label: 'GPT-4o Transcribe',
    hint: 'Higher-quality streaming transcription for noisier or accented speech.',
    tag: 'Quality',
    tagTone: 'blue' as const,
  },
  {
    value: 'whisper-1',
    label: 'Whisper-1',
    hint: 'Classic Whisper model via OpenAI realtime transcription.',
    tag: 'Classic',
    tagTone: 'gray' as const,
  },
  {
    value: 'gpt-realtime-whisper',
    label: 'GPT Realtime Whisper',
    hint: 'LiveKit default realtime Whisper path — uses local VAD for turn commits.',
    tag: 'Realtime',
    tagTone: 'gray' as const,
  },
] as const;

export const SARVAM_STT_MODEL_OPTIONS = [
  {
    value: 'saaras:v3',
    label: 'Saaras v3',
    hint: 'Indian languages + English, code-mix (Hinglish), streaming — recommended.',
    tag: 'Recommended',
    tagTone: 'green' as const,
  },
  {
    value: 'saaras:v4',
    label: 'Saaras v4',
    hint: 'Latest Saaras with improved expressiveness and 44-language support.',
    tag: 'Latest',
    tagTone: 'blue' as const,
  },
] as const;

export const GOOGLE_STT_MODEL_OPTIONS = [
  {
    value: 'chirp_3',
    label: 'Chirp 3',
    hint: 'Latest Google STT — multilingual en/hi, strong on phone audio — recommended.',
    tag: 'Recommended',
    tagTone: 'green' as const,
  },
  {
    value: 'chirp_2',
    label: 'Chirp 2',
    hint: 'Previous-gen Chirp model with broad language support.',
    tag: 'Stable',
    tagTone: 'blue' as const,
  },
  {
    value: 'long',
    label: 'Long',
    hint: 'Optimized for longer utterances and dictation-style speech.',
    tag: 'Long-form',
    tagTone: 'gray' as const,
  },
  {
    value: 'telephony',
    label: 'Telephony',
    hint: 'Tuned for narrow-band phone audio (8 kHz uplink). Use when call quality is poor.',
    tag: 'Phone',
    tagTone: 'gray' as const,
  },
] as const;

export type OpenAiSttModel = (typeof OPENAI_STT_MODEL_OPTIONS)[number]['value'];
export type SarvamSttModel = (typeof SARVAM_STT_MODEL_OPTIONS)[number]['value'];
export type GoogleSttModel = (typeof GOOGLE_STT_MODEL_OPTIONS)[number]['value'];

const OPENAI_STT_MODEL_VALUES = new Set<string>(
  OPENAI_STT_MODEL_OPTIONS.map((option) => option.value),
);

const SARVAM_STT_MODEL_VALUES = new Set<string>(
  SARVAM_STT_MODEL_OPTIONS.map((option) => option.value),
);

const GOOGLE_STT_MODEL_VALUES = new Set<string>(
  GOOGLE_STT_MODEL_OPTIONS.map((option) => option.value),
);

function parseSpeakLanguages(raw?: string | null): SpeakLanguage[] {
  if (!raw?.trim()) return ['en', 'hi', 'hinglish'];
  const langs = raw.split(',').map((s) => s.trim().toLowerCase());
  const valid = langs.filter(
    (l): l is SpeakLanguage => l === 'en' || l === 'hi' || l === 'hinglish',
  );
  return valid.length ? valid : ['en', 'hi', 'hinglish'];
}

export function normalizeSttProvider(raw?: string | null): SttProvider {
  if (raw === 'openai') return 'openai';
  if (raw === 'sarvam') return 'sarvam';
  if (raw === 'google') return 'google';
  return 'azure';
}

export function isOpenAiSttModel(model?: string | null): model is OpenAiSttModel {
  return Boolean(model && OPENAI_STT_MODEL_VALUES.has(model));
}

export function isSarvamSttModel(model?: string | null): model is SarvamSttModel {
  return Boolean(model && SARVAM_STT_MODEL_VALUES.has(model));
}

export function isGoogleSttModel(model?: string | null): model is GoogleSttModel {
  return Boolean(model && GOOGLE_STT_MODEL_VALUES.has(model));
}

export function defaultSttModel(provider: SttProvider): string {
  if (provider === 'openai') return DEFAULT_OPENAI_STT_MODEL;
  if (provider === 'sarvam') return DEFAULT_SARVAM_STT_MODEL;
  if (provider === 'google') return DEFAULT_GOOGLE_STT_MODEL;
  return '';
}

export function resolveSttModel(
  provider: SttProvider,
  model?: string | null,
): string {
  if (provider === 'azure') {
    return '';
  }
  if (provider === 'sarvam') {
    if (isSarvamSttModel(model)) return model;
    return DEFAULT_SARVAM_STT_MODEL;
  }
  if (provider === 'google') {
    if (isGoogleSttModel(model)) return model;
    return DEFAULT_GOOGLE_STT_MODEL;
  }
  if (isOpenAiSttModel(model)) {
    return model;
  }
  return DEFAULT_OPENAI_STT_MODEL;
}

/** BCP-47 language for Sarvam STT WS. Use unknown for mixed Hinglish agents. */
export function sarvamSttLanguageCode(languages: SpeakLanguage[] | string): string {
  const parsed =
    typeof languages === 'string' ? parseSpeakLanguages(languages) : languages;
  if (parsed.includes('hinglish') || (parsed.includes('en') && parsed.includes('hi'))) {
    return 'unknown';
  }
  if (parsed.includes('hi')) return 'hi-IN';
  return 'en-IN';
}

/** Sarvam output mode — codemix for Hinglish sales agents. */
export function sarvamSttMode(languages: SpeakLanguage[] | string): 'codemix' | 'transcribe' {
  const parsed =
    typeof languages === 'string' ? parseSpeakLanguages(languages) : languages;
  if (parsed.includes('hinglish') || (parsed.includes('en') && parsed.includes('hi'))) {
    return 'codemix';
  }
  return 'transcribe';
}

/** Map agent speak languages to a primary OpenAI STT language code. */
export function openAiSttLanguage(languages: SpeakLanguage[]): string {
  if (languages.includes('en') && !languages.includes('hi') && !languages.includes('hinglish')) {
    return 'en';
  }
  if (languages.includes('hi') && !languages.includes('en') && !languages.includes('hinglish')) {
    return 'hi';
  }
  // Mixed / Hinglish agents: prefer English code; enable detectLanguage in the factory.
  return 'en';
}

export function openAiSttDetectLanguage(languages: SpeakLanguage[]): boolean {
  const unique = new Set(languages);
  return unique.size > 1 || languages.includes('hinglish');
}

/** BCP-47 language codes for Google Cloud Speech v2. */
export function googleSttLanguageCodes(languages: SpeakLanguage[] | string): string[] {
  const parsed =
    typeof languages === 'string' ? parseSpeakLanguages(languages) : languages;
  const codes = new Set<string>();
  for (const lang of parsed) {
    if (lang === 'en' || lang === 'hinglish') codes.add('en-IN');
    if (lang === 'hi' || lang === 'hinglish') codes.add('hi-IN');
  }
  return codes.size ? [...codes] : ['en-IN', 'hi-IN'];
}

export function resolveGoogleSpeechLocation(raw?: string | null): string {
  const value =
    raw?.trim() ||
    process.env.GOOGLE_SPEECH_LOCATION?.trim() ||
    DEFAULT_GOOGLE_SPEECH_LOCATION;
  return value || DEFAULT_GOOGLE_SPEECH_LOCATION;
}

export function resolveGoogleCloudProjectId(raw?: string | null): string {
  const value =
    raw?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCP_PROJECT_ID?.trim() ||
    '';
  return value;
}

export function buildGoogleRecognizerPath(
  projectId: string,
  location: string,
): string {
  return `projects/${projectId}/locations/${location}/recognizers/_`;
}
