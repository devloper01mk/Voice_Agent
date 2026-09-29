import {
  DEFAULT_GEMINI_LIVE_LANGUAGE,
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_GEMINI_LIVE_VOICE,
  estimateGeminiLiveCostInr,
  resolveGeminiLiveLanguageCode,
  resolveGeminiLiveModel,
  resolveGeminiLiveVoice,
} from './gemini-live-config.js';
import type { VoicePipeline } from './voice-pipeline.js';

/** Sole S2S provider after Cascade / OpenAI Realtime removal. */
export type S2sProvider = 'gemini';

/** Simulator 2.0 → Force S2S session preset id (legacy metadata). */
export const SIMULATOR_FORCE_S2S_PRESET_ID = 'simulator_force_s2s' as const;

export type RealtimeS2sPresetId = typeof SIMULATOR_FORCE_S2S_PRESET_ID;

export type RealtimeS2sNoiseReduction = 'far_field' | 'near_field' | 'off';
export type RealtimeS2sTurnMode = 'normal' | 'semantic';
export type RealtimeS2sEagerness = 'auto' | 'low' | 'medium' | 'high';
export type RealtimeS2sMaxTokensMode = 'unlimited' | 'custom';

/** User-editable Gemini Live S2S settings. */
export interface RealtimeS2sUserConfig {
  provider: S2sProvider;
  model: string;
  /** Gemini Live BCP-47 language (e.g. hi-IN). */
  languageCode: string;
  /** @deprecated Unused for Gemini — kept for DB compatibility. */
  transcriptionModel: string;
  maxTokensMode: RealtimeS2sMaxTokensMode;
  maxTokensCustom: number;
  voice: string;
  noiseReduction: RealtimeS2sNoiseReduction;
  turnDetectionMode: RealtimeS2sTurnMode;
  turnDetectionThreshold: number;
  turnDetectionPrefixPaddingMs: number;
  turnDetectionSilenceDurationMs: number;
  turnDetectionEagerness: RealtimeS2sEagerness;
  idleTimeoutEnabled: boolean;
}

export interface RealtimeS2sTurnDetectionConfig {
  label: string;
  type: 'server_vad' | 'semantic_vad';
  threshold?: number;
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
  eagerness?: RealtimeS2sEagerness;
}

/** Serializable session config published to Simulator UI on call start. */
export interface RealtimeS2sSessionConfig {
  source: 'simulator_force_s2s' | 'studio_default';
  presetId?: RealtimeS2sPresetId;
  provider: S2sProvider;
  pipeline: 'gemini_live';
  model: string;
  languageCode?: string;
  transcriptionModel: string;
  maxResponseOutputTokens: 'unlimited' | number;
  voice: string;
  noiseReduction?: RealtimeS2sNoiseReduction;
  turnDetection: RealtimeS2sTurnDetectionConfig;
  idleTimeout: boolean;
  modalities: readonly ['text', 'audio'];
  estimatedCostInrPerMin?: string;
}

/** @deprecated OpenAI Realtime models — unused after removal. */
export const REALTIME_S2S_MODEL_OPTIONS = [] as const;

/** @deprecated */
export const REALTIME_S2S_TRANSCRIPTION_OPTIONS = [
  { value: 'gpt-realtime-whisper', label: 'GPT Realtime Whisper', hint: 'Realtime path' },
  { value: 'gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe', hint: 'Cheapest' },
  { value: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe', hint: 'Higher quality' },
  { value: 'whisper-1', label: 'Whisper-1', hint: 'Classic' },
] as const;

export const REALTIME_S2S_NOISE_REDUCTION_OPTIONS = [
  { value: 'far_field', label: 'Far field' },
  { value: 'near_field', label: 'Near field' },
  { value: 'off', label: 'Off' },
] as const;

export const REALTIME_S2S_TURN_MODE_OPTIONS = [
  { value: 'normal', label: 'Normal', hint: 'Server VAD — threshold + silence' },
  { value: 'semantic', label: 'Semantic', hint: 'Semantic VAD — eagerness' },
] as const;

export const REALTIME_S2S_EAGERNESS_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

export const REALTIME_S2S_TRANSCRIPTION_PROMPT =
  'Indian sales call in Hindi English Hinglish code-mix. Automotive, pricing, demo, callback.';

const LEGACY_TRANSCRIPTION = 'gpt-realtime-whisper';

export const SIMULATOR_FORCE_S2S_REALTIME = {
  model: DEFAULT_GEMINI_LIVE_MODEL,
  transcriptionModel: LEGACY_TRANSCRIPTION,
  maxTokensMode: 'unlimited' as const,
  maxTokensCustom: 800,
  voice: DEFAULT_GEMINI_LIVE_VOICE,
  noiseReduction: 'off' as const,
  turnDetectionMode: 'normal' as const,
  turnDetectionThreshold: 0.5,
  turnDetectionPrefixPaddingMs: 100,
  turnDetectionSilenceDurationMs: 200,
  turnDetectionEagerness: 'medium' as const,
  idleTimeoutEnabled: false,
  estimatedCostInrPerMin: estimateGeminiLiveCostInr(DEFAULT_GEMINI_LIVE_MODEL),
} as const;

export function resolveS2sProvider(
  _raw?: Partial<RealtimeS2sUserConfig> | null,
  _pipeline?: VoicePipeline | null,
): S2sProvider {
  return 'gemini';
}

export function defaultGeminiLiveS2sUserConfig(): RealtimeS2sUserConfig {
  return {
    provider: 'gemini',
    model: DEFAULT_GEMINI_LIVE_MODEL,
    languageCode: DEFAULT_GEMINI_LIVE_LANGUAGE,
    transcriptionModel: LEGACY_TRANSCRIPTION,
    maxTokensMode: 'unlimited',
    maxTokensCustom: SIMULATOR_FORCE_S2S_REALTIME.maxTokensCustom,
    voice: DEFAULT_GEMINI_LIVE_VOICE,
    noiseReduction: 'off',
    turnDetectionMode: 'normal',
    turnDetectionThreshold: 0.5,
    turnDetectionPrefixPaddingMs: 100,
    turnDetectionSilenceDurationMs: 200,
    turnDetectionEagerness: 'medium',
    idleTimeoutEnabled: false,
  };
}

export function defaultRealtimeS2sUserConfig(_provider: S2sProvider = 'gemini'): RealtimeS2sUserConfig {
  return defaultGeminiLiveS2sUserConfig();
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeRealtimeS2sUserConfig(
  raw?: Partial<RealtimeS2sUserConfig> | null,
  _pipeline?: VoicePipeline | null,
): RealtimeS2sUserConfig {
  const defaults = defaultGeminiLiveS2sUserConfig();
  const model =
    typeof raw?.model === 'string' ? resolveGeminiLiveModel(raw.model) : defaults.model;
  const voice = resolveGeminiLiveVoice(raw?.voice ?? defaults.voice);

  return {
    provider: 'gemini',
    model,
    languageCode: resolveGeminiLiveLanguageCode(raw?.languageCode ?? defaults.languageCode),
    transcriptionModel: defaults.transcriptionModel,
    maxTokensMode: raw?.maxTokensMode === 'custom' ? 'custom' : 'unlimited',
    maxTokensCustom: clampNumber(raw?.maxTokensCustom, 64, 16_384, defaults.maxTokensCustom),
    voice,
    noiseReduction:
      raw?.noiseReduction === 'near_field' ||
      raw?.noiseReduction === 'far_field' ||
      raw?.noiseReduction === 'off'
        ? raw.noiseReduction
        : defaults.noiseReduction,
    turnDetectionMode: raw?.turnDetectionMode === 'semantic' ? 'semantic' : 'normal',
    turnDetectionThreshold: clampNumber(raw?.turnDetectionThreshold, 0, 1, defaults.turnDetectionThreshold),
    turnDetectionPrefixPaddingMs: clampNumber(
      raw?.turnDetectionPrefixPaddingMs,
      0,
      2000,
      defaults.turnDetectionPrefixPaddingMs,
    ),
    turnDetectionSilenceDurationMs: clampNumber(
      raw?.turnDetectionSilenceDurationMs,
      0,
      3000,
      defaults.turnDetectionSilenceDurationMs,
    ),
    turnDetectionEagerness:
      raw?.turnDetectionEagerness === 'auto' ||
      raw?.turnDetectionEagerness === 'low' ||
      raw?.turnDetectionEagerness === 'high'
        ? raw.turnDetectionEagerness
        : defaults.turnDetectionEagerness,
    idleTimeoutEnabled: Boolean(raw?.idleTimeoutEnabled),
  };
}

export function isRealtimeS2sPresetId(raw?: string | null): raw is RealtimeS2sPresetId {
  return raw === SIMULATOR_FORCE_S2S_PRESET_ID;
}

export function estimateRealtimeS2sCostInr(config: RealtimeS2sUserConfig): string {
  return estimateGeminiLiveCostInr(config.model);
}

export function realtimeS2sUserConfigToSessionConfig(
  config: RealtimeS2sUserConfig,
  source: RealtimeS2sSessionConfig['source'] = 'simulator_force_s2s',
  _pipeline?: VoicePipeline | null,
): RealtimeS2sSessionConfig {
  const turnDetection: RealtimeS2sTurnDetectionConfig =
    config.turnDetectionMode === 'semantic'
      ? {
          label: 'Semantic',
          type: 'semantic_vad',
          eagerness: config.turnDetectionEagerness,
        }
      : {
          label: 'Normal',
          type: 'server_vad',
          threshold: config.turnDetectionThreshold,
          prefixPaddingMs: config.turnDetectionPrefixPaddingMs,
          silenceDurationMs: config.turnDetectionSilenceDurationMs,
        };

  return {
    source,
    presetId: source === 'simulator_force_s2s' ? SIMULATOR_FORCE_S2S_PRESET_ID : undefined,
    provider: 'gemini',
    pipeline: 'gemini_live',
    model: config.model,
    languageCode: config.languageCode,
    transcriptionModel: config.transcriptionModel,
    maxResponseOutputTokens:
      config.maxTokensMode === 'custom' ? config.maxTokensCustom : 'unlimited',
    voice: config.voice,
    noiseReduction: config.noiseReduction,
    turnDetection,
    idleTimeout: config.idleTimeoutEnabled,
    modalities: ['text', 'audio'],
    estimatedCostInrPerMin: estimateRealtimeS2sCostInr(config),
  };
}

function buildStudioDefaultConfig(voice: string): RealtimeS2sSessionConfig {
  return realtimeS2sUserConfigToSessionConfig(
    normalizeRealtimeS2sUserConfig({ voice }),
    'studio_default',
  );
}

/** @deprecated Use realtimeS2sUserConfigToSessionConfig with explicit user config. */
export function buildRealtimeS2sSessionConfig(
  voice?: string | null,
  presetId?: string | null,
  userConfig?: Partial<RealtimeS2sUserConfig> | null,
): RealtimeS2sSessionConfig {
  if (userConfig) {
    return realtimeS2sUserConfigToSessionConfig(
      normalizeRealtimeS2sUserConfig({ ...userConfig, voice: voice ?? userConfig.voice }),
    );
  }
  const resolvedVoice = resolveGeminiLiveVoice(voice ?? DEFAULT_GEMINI_LIVE_VOICE);
  if (isRealtimeS2sPresetId(presetId)) {
    return realtimeS2sUserConfigToSessionConfig(
      normalizeRealtimeS2sUserConfig({ voice: resolvedVoice }),
    );
  }
  return buildStudioDefaultConfig(resolvedVoice);
}
