import * as google from '@livekit/agents-plugin-google';
import {
  ActivityHandling,
  EndSensitivity,
  Modality,
  StartSensitivity,
  ThinkingLevel,
} from '@google/genai';
import {
  DEFAULT_SPOKEN_TURN_MAX_TOKENS,
  geminiLiveThinkingConfig,
  isGemini31LiveModel,
  normalizeRealtimeS2sUserConfig,
  resolveGeminiLiveVoice,
  resolveLiveKitGeminiModel,
  type RealtimeS2sUserConfig,
} from '@vsa/shared';
import { applyGeminiRealtimePatches } from './gemini-realtime-patch.js';

applyGeminiRealtimePatches();

function mapGeminiLiveThinkingConfig(
  raw: ReturnType<typeof geminiLiveThinkingConfig>,
):
  | { thinkingBudget: number }
  | { thinkingLevel: ThinkingLevel }
  | undefined {
  if (!raw) return undefined;
  if ('thinkingBudget' in raw) return raw;
  if ('thinkingLevel' in raw) {
    const map: Record<string, ThinkingLevel> = {
      minimal: ThinkingLevel.MINIMAL,
      low: ThinkingLevel.LOW,
      medium: ThinkingLevel.MEDIUM,
      high: ThinkingLevel.HIGH,
    };
    return { thinkingLevel: map[raw.thinkingLevel] ?? ThinkingLevel.LOW };
  }
  return undefined;
}

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
  const requested = config.model || opts?.model?.trim() || 'gemini-3.8-live';
  let model = resolveLiveKitGeminiModel(requested);
  if (model !== requested) {
    console.warn(`[vsa] ${requested} cannot speak proactively on LiveKit (opener / check-ins) — using ${model}`);
  }

  // Optional override: GEMINI_LIVE_FORCE_25=1 forces older 2.5 native-audio
  if (process.env.GEMINI_LIVE_FORCE_25 === '1' && isGemini31LiveModel(model)) {
    const stable = 'gemini-2.5-flash-native-audio-preview-12-2025';
    console.warn(`[vsa] GEMINI_LIVE_FORCE_25=1 — remapping ${model} → ${stable}`);
    model = stable;
  }

  console.info(
    `[vsa] Gemini Live S2S: model=${model} voice=${voice}${language ? ` lang=${language}` : ''}${opts?.telephony ? ' (telephony)' : ''}`,
  );

  const thinkingConfig = mapGeminiLiveThinkingConfig(geminiLiveThinkingConfig(model));

  return new google.realtime.RealtimeModel({
    apiKey,
    model,
    voice,
    language,
    // Native-audio Live models only accept AUDIO (TEXT+AUDIO closes the session).
    modalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // 3.8-live: omit thinking; 3.8-extended: low; 3.1: minimal; 2.5: budget 0
    ...(thinkingConfig ? { thinkingConfig } : {}),
    maxOutputTokens:
      config.maxTokensMode === 'custom' ? config.maxTokensCustom : DEFAULT_SPOKEN_TURN_MAX_TOKENS,
    // Drop oldest audio once the window fills so a long call keeps tools and recent facts.
    contextWindowCompression: {
      triggerTokens: '80000',
      slidingWindow: { targetTokens: '40000' },
    },
    realtimeInputConfig: opts?.telephony
      ? {
          // Phone echo must not cut the sentence or look like the caller spoke.
          // A real reply still starts after the agent finishes and the line is quiet.
          activityHandling: ActivityHandling.NO_INTERRUPTION,
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
            // End the caller turn quickly. A long quiet wait was most of the gap before lookup.
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
            prefixPaddingMs: 200,
            silenceDurationMs: 350,
          },
        }
      : config.turnDetectionMode === 'normal'
        ? {
            automaticActivityDetection: {
              prefixPaddingMs: config.turnDetectionPrefixPaddingMs,
              silenceDurationMs: config.turnDetectionSilenceDurationMs,
            },
          }
        : undefined,
  });
}
