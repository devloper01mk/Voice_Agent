export const CARTESIA_API_VERSION = '2024-06-10';

/** Fallback when agent Studio model and CARTESIA_MODEL_ID are unset. */
export const DEFAULT_CARTESIA_TTS_MODEL = 'sonic-3.6';

export const CARTESIA_TTS_MODELS = [
  { id: 'sonic-3.6', label: 'Sonic 3.6 (recommended)' },
  { id: 'sonic-3.5', label: 'Sonic 3.5' },
  { id: 'sonic-3', label: 'Sonic 3' },
  { id: 'sonic-turbo', label: 'Sonic Turbo (fastest)' },
  { id: 'sonic-2', label: 'Sonic 2' },
] as const;

/** Cartesia TTS output_format.sample_rate enum. */
export const CARTESIA_SAMPLE_RATES = [
  { id: 8000, label: '8000 Hz' },
  { id: 16000, label: '16000 Hz' },
  { id: 22050, label: '22050 Hz' },
  { id: 24000, label: '24000 Hz (default / low latency)' },
  { id: 44100, label: '44100 Hz (CD quality)' },
  { id: 48000, label: '48000 Hz (highest)' },
] as const;

export const CARTESIA_SAMPLE_RATE_IDS = CARTESIA_SAMPLE_RATES.map((r) => r.id);

/** Primary emotions first, then full Cartesia generation_config.emotion list. */
export const CARTESIA_EMOTIONS = [
  { id: '', label: 'Neutral (auto from transcript)' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'calm', label: 'Calm' },
  { id: 'content', label: 'Content' },
  { id: 'happy', label: 'Happy' },
  { id: 'sad', label: 'Sad' },
  { id: 'angry', label: 'Angry' },
  { id: 'scared', label: 'Scared' },
  { id: 'excited', label: 'Excited' },
  { id: 'enthusiastic', label: 'Enthusiastic' },
  { id: 'elated', label: 'Elated' },
  { id: 'euphoric', label: 'Euphoric' },
  { id: 'triumphant', label: 'Triumphant' },
  { id: 'amazed', label: 'Amazed' },
  { id: 'surprised', label: 'Surprised' },
  { id: 'flirtatious', label: 'Flirtatious' },
  { id: 'curious', label: 'Curious' },
  { id: 'peaceful', label: 'Peaceful' },
  { id: 'serene', label: 'Serene' },
  { id: 'grateful', label: 'Grateful' },
  { id: 'affectionate', label: 'Affectionate' },
  { id: 'trust', label: 'Trust' },
  { id: 'sympathetic', label: 'Sympathetic' },
  { id: 'anticipation', label: 'Anticipation' },
  { id: 'mysterious', label: 'Mysterious' },
  { id: 'mad', label: 'Mad' },
  { id: 'outraged', label: 'Outraged' },
  { id: 'frustrated', label: 'Frustrated' },
  { id: 'agitated', label: 'Agitated' },
  { id: 'threatened', label: 'Threatened' },
  { id: 'disgusted', label: 'Disgusted' },
  { id: 'contempt', label: 'Contempt' },
  { id: 'envious', label: 'Envious' },
  { id: 'sarcastic', label: 'Sarcastic' },
  { id: 'ironic', label: 'Ironic' },
  { id: 'dejected', label: 'Dejected' },
  { id: 'melancholic', label: 'Melancholic' },
  { id: 'disappointed', label: 'Disappointed' },
  { id: 'hurt', label: 'Hurt' },
  { id: 'guilty', label: 'Guilty' },
  { id: 'bored', label: 'Bored' },
  { id: 'tired', label: 'Tired' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'nostalgic', label: 'Nostalgic' },
  { id: 'wistful', label: 'Wistful' },
  { id: 'apologetic', label: 'Apologetic' },
  { id: 'hesitant', label: 'Hesitant' },
  { id: 'insecure', label: 'Insecure' },
  { id: 'confused', label: 'Confused' },
  { id: 'resigned', label: 'Resigned' },
  { id: 'anxious', label: 'Anxious' },
  { id: 'panicked', label: 'Panicked' },
  { id: 'alarmed', label: 'Alarmed' },
  { id: 'proud', label: 'Proud' },
  { id: 'confident', label: 'Confident' },
  { id: 'distant', label: 'Distant' },
  { id: 'skeptical', label: 'Skeptical' },
  { id: 'contemplative', label: 'Contemplative' },
  { id: 'determined', label: 'Determined' },
] as const;

export function isValidCartesiaSampleRate(value: number): boolean {
  return (CARTESIA_SAMPLE_RATE_IDS as readonly number[]).includes(value);
}

/** Empty / neutral → omit from Cartesia generation_config. */
export function normalizeCartesiaEmotion(raw?: string | null): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === 'neutral') return undefined;
  return trimmed;
}

export const CARTESIA_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'ar', label: 'Arabic' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'sv', label: 'Swedish' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ms', label: 'Malay' },
  { code: 'fil', label: 'Filipino' },
  { code: 'ta', label: 'Tamil' },
] as const;

export interface CartesiaVoiceOption {
  id: string;
  name: string;
  description: string;
  language: string;
  gender: string;
  isPublic: boolean;
}

export function isIndianFemaleVoice(v: Pick<CartesiaVoiceOption, 'name' | 'description' | 'language' | 'gender'>): boolean {
  if (!/feminine|female/i.test(v.gender)) return false;
  const text = `${v.name} ${v.description}`.toLowerCase();
  return (
    v.language === 'hi' ||
    /\bindian\b|\bindia\b|hinglish|\bhindi\b|\bdesi\b/.test(text)
  );
}

/** Default: Arushi — Hinglish, feminine, Indian accent (Cartesia). */
export const DEFAULT_INDIAN_FEMALE_VOICE_ID = '95d51f79-c397-46f9-b49a-23763d3eaa2d';

function cartesiaHeaders(apiKey: string) {
  return {
    'X-API-Key': apiKey,
    'Cartesia-Version': CARTESIA_API_VERSION,
  };
}

export async function fetchCartesiaVoices(
  apiKey: string,
  language?: string,
): Promise<CartesiaVoiceOption[]> {
  const all: CartesiaVoiceOption[] = [];
  let startingAfter: string | undefined;
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ limit: '100', is_public: 'true' });
    if (language) params.set('language', language);
    if (startingAfter) params.set('starting_after', startingAfter);

    const res = await fetch(`https://api.cartesia.ai/voices?${params}`, {
      headers: cartesiaHeaders(apiKey),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Cartesia voices API failed: ${detail}`);
    }

    const batch = (await res.json()) as Array<{
      id: string;
      name: string;
      description?: string;
      language?: string;
      gender?: string;
      is_public?: boolean;
      is_archived?: boolean;
    }>;

    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const v of batch) {
      if (v.is_archived) continue;
      all.push({
        id: v.id,
        name: v.name,
        description: v.description ?? '',
        language: v.language ?? 'en',
        gender: v.gender ?? 'neutral',
        isPublic: v.is_public ?? true,
      });
    }

    if (batch.length < 100) break;
    startingAfter = batch[batch.length - 1]?.id;
    if (!startingAfter) break;
  }

  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/** Feminine voices with Indian / Hindi / Hinglish accent (Cartesia hi + en catalogs). */
export async function fetchIndianFemaleVoices(apiKey: string): Promise<CartesiaVoiceOption[]> {
  const [hiVoices, enVoices] = await Promise.all([
    fetchCartesiaVoices(apiKey, 'hi'),
    fetchCartesiaVoices(apiKey, 'en'),
  ]);
  const byId = new Map<string, CartesiaVoiceOption>();
  for (const voice of [...hiVoices, ...enVoices]) {
    if (isIndianFemaleVoice(voice)) byId.set(voice.id, voice);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
