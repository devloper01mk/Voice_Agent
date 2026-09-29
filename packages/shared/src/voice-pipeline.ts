/** Sole voice pipeline — Cascade and OpenAI Realtime were removed. */
export type VoicePipeline = 'gemini_live';

export const DEFAULT_VOICE_PIPELINE: VoicePipeline = 'gemini_live';

/** Default Gemini Live voice when none is set. */
export const DEFAULT_REALTIME_VOICE = 'Kore';

export type RealtimeVoice = string;

/** Always Gemini Live. Legacy `cascaded` / `openai_realtime` values normalize here. */
export function normalizeVoicePipeline(_raw?: string | null): VoicePipeline {
  return 'gemini_live';
}

export function isS2sPipeline(_raw?: string | null): boolean {
  return true;
}

export function resolveRealtimeVoice(voice?: string | null): string {
  if (typeof voice === 'string' && voice.trim()) return voice.trim();
  return DEFAULT_REALTIME_VOICE;
}

export function isGeminiLivePipeline(_raw?: string | null): boolean {
  return true;
}
