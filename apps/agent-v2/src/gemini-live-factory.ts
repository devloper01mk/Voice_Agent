import * as google from '@livekit/agents-plugin-google';
import { Modality, ThinkingLevel } from '@google/genai';
import {
  geminiLiveThinkingConfig,
  isGemini31LiveModel,
  normalizeRealtimeS2sUserConfig,
  resolveGeminiLiveVoice,
  type RealtimeS2sUserConfig,
} from '@vsa/shared';

export function createGeminiLiveModel(opts?: {
  voice?: string | null;
  model?: string | null;
  s2sConfig?: Partial<RealtimeS2sUserConfig> | null;
  /** SIP/PSTN: prefer a Live model that supports generateReply (opener + tool speak). */
  telephony?: boolean;
}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY (or GOOGLE_API_KEY) is required for Simulator 2.0 gemini_live voice pipeline',
    );
  }

  const config = opts?.s2sConfig
    ? normalizeRealtimeS2sUserConfig({ ...opts.s2sConfig, provider: 'gemini' }, 'gemini_live')
    : normalizeRealtimeS2sUserConfig({ provider: 'gemini' }, 'gemini_live');
  const voice = resolveGeminiLiveVoice(config.voice ?? opts?.voice);
  const language =
    config.languageCode && config.languageCode !== 'auto' ? config.languageCode : undefined;
  let model = config.model || opts?.model?.trim() || 'gemini-2.5-flash-native-audio-preview-12-2025';

  // Use Agent Studio / API selected model as-is (including gemini-3.1-flash-live-preview).
  // Optional override only if explicitly forced off: GEMINI_LIVE_FORCE_25=1
  if (process.env.GEMINI_LIVE_FORCE_25 === '1' && isGemini31LiveModel(model)) {
    const stable = 'gemini-2.5-flash-native-audio-preview-12-2025';
    console.warn(`[vsa] GEMINI_LIVE_FORCE_25=1 — remapping ${model} → ${stable}`);
    model = stable;
  }

  console.info(
    `[vsa] Gemini Live S2S: model=${model} voice=${voice}${language ? ` lang=${language}` : ''}${opts?.telephony ? ' (telephony)' : ''}`,
  );

  const rawThinking = geminiLiveThinkingConfig(model);
  const thinkingConfig =
    rawThinking && 'thinkingLevel' in rawThinking
      ? { thinkingLevel: ThinkingLevel.MINIMAL }
      : rawThinking;

  return new google.realtime.RealtimeModel({
    apiKey,
    model,
    voice,
    language,
    // Native-audio Live models only accept AUDIO (TEXT+AUDIO closes the session).
    modalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // Gemini 3.x wants thinkingLevel; 2.5 uses thinkingBudget.
    thinkingConfig,
    maxOutputTokens:
      config.maxTokensMode === 'custom'
        ? config.maxTokensCustom
        : // Enough for a complete multi-sentence Hinglish reply (220/512 were cutting speech).
          1100,
    realtimeInputConfig:
      config.turnDetectionMode === 'normal'
        ? {
            automaticActivityDetection: {
              prefixPaddingMs: config.turnDetectionPrefixPaddingMs,
              silenceDurationMs: config.turnDetectionSilenceDurationMs,
            },
          }
        : undefined,
  });
}
